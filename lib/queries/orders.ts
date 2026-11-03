import "server-only";
import { sql } from "@/lib/db";
import { CAFE_TIMEZONE } from "@/lib/time";
import type { OrderLineInput, OrderWithLines, PaymentMethod } from "@/lib/types";

/**
 * Creates and immediately closes a paid order: inserts the order, its
 * lines (at the menu item's *current* price, captured at sale time so a
 * later price change never rewrites a historical total), and decrements
 * inventory per recipe_lines -- all in one transaction.
 *
 * Deliberately never blocks checkout on an inventory shortfall: a real
 * cafe counter can't refuse to serve a customer because the stock count
 * is off. Stock is allowed to go negative; the inventory/insights views
 * surface that as an urgent restock signal instead.
 */
export async function createPaidOrder(input: {
  lines: OrderLineInput[];
  paymentMethod: PaymentMethod;
  staffId: number;
}): Promise<{ orderId: number; totalCents: number }> {
  if (input.lines.length === 0) {
    throw new Error("An order needs at least one line.");
  }

  return sql.begin(async (tx) => {
    const [order] = await tx`
      insert into orders (status, payment_method, staff_id, closed_at)
      values ('paid', ${input.paymentMethod}, ${input.staffId}, now())
      returning id
    `;
    const orderId: number = order.id;

    let totalCents = 0;

    for (const line of input.lines) {
      const [menuItem] = await tx`
        select price_cents from menu_items where id = ${line.menuItemId}
      `;
      if (!menuItem) {
        throw new Error(`Menu item ${line.menuItemId} does not exist.`);
      }
      const unitPriceCents: number = menuItem.price_cents;
      totalCents += unitPriceCents * line.quantity;

      await tx`
        insert into order_lines (order_id, menu_item_id, quantity, unit_price_cents)
        values (${orderId}, ${line.menuItemId}, ${line.quantity}, ${unitPriceCents})
      `;

      // Decrement every ingredient this menu item's recipe consumes,
      // scaled by how many were ordered.
      const recipeLines = await tx`
        select inventory_item_id, quantity_used
        from recipe_lines
        where menu_item_id = ${line.menuItemId}
      `;
      for (const recipeLine of recipeLines) {
        const totalUsed = Number(recipeLine.quantity_used) * line.quantity;
        await tx`
          update inventory_items
          set current_stock = current_stock - ${totalUsed}
          where id = ${recipeLine.inventory_item_id}
        `;
      }
    }

    return { orderId, totalCents };
  });
}

export async function getOrderHistory(params: {
  from?: Date;
  to?: Date;
}): Promise<OrderWithLines[]> {
  const to = params.to ?? new Date();

  // When no explicit `from` is given, "today" is resolved in Postgres
  // against the cafe's fixed timezone -- not Date.setHours(0,0,0,0),
  // which would silently use whatever timezone the Node process happens
  // to be running in (see lib/time.ts).
  const orderRows = await sql`
    select id, status, payment_method, created_at, closed_at
    from orders
    where status = 'paid'
      and created_at >= coalesce(
        ${params.from ?? null}::timestamptz,
        date_trunc('day', now() AT TIME ZONE ${CAFE_TIMEZONE}) AT TIME ZONE ${CAFE_TIMEZONE}
      )
      and created_at <= ${to}
    order by created_at desc
  `;

  if (orderRows.length === 0) return [];

  const orderIds = orderRows.map((r) => r.id);
  const lineRows = await sql`
    select ol.order_id, ol.menu_item_id, m.name as menu_item_name, ol.quantity, ol.unit_price_cents
    from order_lines ol
    join menu_items m on m.id = ol.menu_item_id
    where ol.order_id = any(${orderIds})
  `;

  return orderRows.map((o) => {
    const lines = lineRows
      .filter((l) => l.order_id === o.id)
      .map((l) => ({
        menuItemId: l.menu_item_id,
        menuItemName: l.menu_item_name,
        quantity: l.quantity,
        unitPriceCents: l.unit_price_cents,
      }));
    const totalCents = lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
    return {
      id: o.id,
      status: o.status,
      paymentMethod: o.payment_method,
      totalCents,
      createdAt: o.created_at,
      closedAt: o.closed_at,
      lines,
    } satisfies OrderWithLines;
  });
}
