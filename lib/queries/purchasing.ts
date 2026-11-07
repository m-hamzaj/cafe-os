import "server-only";
import { sql } from "@/lib/db";
import type { PurchaseOrder, PurchaseOrderLine, PurchaseOrderStatus } from "@/lib/types";

/** A request the caller can fix, as opposed to a server fault. */
export class PurchaseOrderError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409
  ) {
    super(message);
  }
}

const toNumberOrNull = (v: string | number | null) => (v === null ? null : Number(v));

/** Open orders first, then the most recent received or cancelled ones. */
export async function getPurchaseOrders(closedLimit = 20): Promise<PurchaseOrder[]> {
  const orders = await sql`
    (select * from purchase_orders where status = 'open')
    union all
    (select * from purchase_orders where status <> 'open' order by closed_at desc nulls last, id desc limit ${closedLimit})
  `;
  return hydrate(orders.map((o) => o.id));
}

export async function getPurchaseOrder(id: number): Promise<PurchaseOrder | null> {
  const [order] = await hydrate([id]);
  return order ?? null;
}

async function hydrate(ids: number[]): Promise<PurchaseOrder[]> {
  if (ids.length === 0) return [];
  const [orders, lines] = await Promise.all([
    sql`
      select p.*, c.name as created_by_name, x.name as closed_by_name
      from purchase_orders p
      left join staff c on c.id = p.created_by
      left join staff x on x.id = p.closed_by
      where p.id = any(${ids})
      order by (p.status = 'open') desc, coalesce(p.closed_at, p.created_at) desc, p.id desc
    `,
    sql`
      select l.*, i.name as inventory_item_name, i.unit
      from purchase_order_lines l
      join inventory_items i on i.id = l.inventory_item_id
      where l.purchase_order_id = any(${ids})
      order by i.name
    `,
  ]);
  return orders.map((o) => ({
    id: o.id,
    supplier: o.supplier,
    status: o.status as PurchaseOrderStatus,
    note: o.note,
    createdBy: o.created_by_name,
    createdAt: new Date(o.created_at).toISOString(),
    closedBy: o.closed_by_name,
    closedAt: o.closed_at ? new Date(o.closed_at).toISOString() : null,
    lines: lines
      .filter((l) => l.purchase_order_id === o.id)
      .map(
        (l): PurchaseOrderLine => ({
          id: l.id,
          inventoryItemId: l.inventory_item_id,
          inventoryItemName: l.inventory_item_name,
          unit: l.unit,
          quantityOrdered: Number(l.quantity_ordered),
          unitCostCents: toNumberOrNull(l.unit_cost_cents),
          quantityReceived: toNumberOrNull(l.quantity_received),
          receiveNote: l.receive_note,
        })
      ),
  }));
}

export async function createPurchaseOrder(
  input: {
    supplier: string;
    note?: string;
    lines: Array<{ inventoryItemId: number; quantity: number; unitCostCents?: number | null }>;
  },
  staffId: number
): Promise<PurchaseOrder> {
  const id = await sql.begin(async (tx): Promise<number> => {
    const ids = input.lines.map((l) => l.inventoryItemId);
    const [{ found }] = await tx`select count(*)::integer as found from inventory_items where id = any(${ids})`;
    if (found !== ids.length) {
      throw new PurchaseOrderError("An ingredient on this order no longer exists.", 400);
    }
    const [order] = await tx`
      insert into purchase_orders (supplier, note, created_by)
      values (${input.supplier}, ${input.note ?? null}, ${staffId})
      returning id
    `;
    for (const line of input.lines) {
      await tx`
        insert into purchase_order_lines (purchase_order_id, inventory_item_id, quantity_ordered, unit_cost_cents)
        values (${order.id}, ${line.inventoryItemId}, ${line.quantity}, ${line.unitCostCents ?? null})
      `;
    }
    return order.id;
  });
  return (await getPurchaseOrder(id))!;
}

/**
 * Records what actually arrived and adds it to stock, in one transaction.
 * Every line must be answered, even with zero, so a missing item is a
 * recorded shortfall rather than a silent gap. Each received line becomes a
 * stock_entries row linked back to the order, and a price paid becomes the
 * ingredient's cost from now on. The order is closed even if some lines came
 * up short; a later delivery is a new order.
 */
export async function receivePurchaseOrder(
  orderId: number,
  received: Array<{ lineId: number; quantityReceived: number; unitCostCents: number | null; note?: string }>,
  staffId: number
): Promise<PurchaseOrder> {
  await sql.begin(async (tx) => {
    const [order] = await tx`select status from purchase_orders where id = ${orderId} for update`;
    if (!order) throw new PurchaseOrderError("That purchase order doesn't exist.", 404);
    if (order.status !== "open") {
      throw new PurchaseOrderError(`This order was already ${order.status}.`, 409);
    }

    const lines = await tx`select id, inventory_item_id from purchase_order_lines where purchase_order_id = ${orderId}`;
    const byId = new Map(received.map((r) => [r.lineId, r]));
    if (lines.length !== received.length || lines.some((l) => !byId.has(l.id))) {
      throw new PurchaseOrderError("Enter what arrived for every line on the order.", 400);
    }

    for (const line of lines) {
      const r = byId.get(line.id)!;
      await tx`
        update purchase_order_lines
        set quantity_received = ${r.quantityReceived},
            unit_cost_cents = ${r.unitCostCents},
            receive_note = ${r.note ?? null}
        where id = ${line.id}
      `;
      if (r.quantityReceived > 0) {
        await tx`
          insert into stock_entries (inventory_item_id, quantity_added, purchase_order_line_id)
          values (${line.inventory_item_id}, ${r.quantityReceived}, ${line.id})
        `;
        await tx`
          update inventory_items
          set current_stock = current_stock + ${r.quantityReceived},
              unit_cost_cents = coalesce(${r.unitCostCents}::numeric, unit_cost_cents)
          where id = ${line.inventory_item_id}
        `;
      }
    }

    await tx`
      update purchase_orders set status = 'received', closed_by = ${staffId}, closed_at = now()
      where id = ${orderId}
    `;
  });
  return (await getPurchaseOrder(orderId))!;
}

/** Cancels an open order. Stock is untouched, since nothing arrived. */
export async function cancelPurchaseOrder(orderId: number, staffId: number): Promise<PurchaseOrder> {
  const [row] = await sql`
    update purchase_orders set status = 'cancelled', closed_by = ${staffId}, closed_at = now()
    where id = ${orderId} and status = 'open'
    returning id
  `;
  if (!row) {
    const [existing] = await sql`select status from purchase_orders where id = ${orderId}`;
    if (!existing) throw new PurchaseOrderError("That purchase order doesn't exist.", 404);
    throw new PurchaseOrderError(`This order was already ${existing.status}.`, 409);
  }
  return (await getPurchaseOrder(orderId))!;
}

/** How much of each ingredient is on open orders, by ingredient id. */
export async function getOnOrder(): Promise<Record<number, number>> {
  const rows = await sql`
    select l.inventory_item_id, sum(l.quantity_ordered) as on_order
    from purchase_order_lines l
    join purchase_orders p on p.id = l.purchase_order_id
    where p.status = 'open'
    group by l.inventory_item_id
  `;
  return Object.fromEntries(rows.map((r) => [r.inventory_item_id, Number(r.on_order)]));
}
