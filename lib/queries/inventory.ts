import "server-only";
import { sql } from "@/lib/db";
import type { InventoryActivity, InventoryItem, StockAdjustment } from "@/lib/types";

/** How far back the inventory screen totals waste and count differences. */
export const ACTIVITY_LOOKBACK_DAYS = 7;

interface InventoryItemRow {
  id: number;
  name: string;
  unit: string;
  current_stock: string | number;
  low_stock_threshold: string | number;
}

function rowToInventoryItem(row: InventoryItemRow): InventoryItem {
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    // postgres.js returns `numeric` columns as strings to avoid silent
    // float precision loss -- cast explicitly at the boundary instead of
    // letting a stringly-typed number leak into the rest of the app.
    currentStock: Number(row.current_stock),
    lowStockThreshold: Number(row.low_stock_threshold),
  };
}

export async function getInventoryItems(): Promise<InventoryItem[]> {
  const rows = await sql<InventoryItemRow[]>`
    select id, name, unit, current_stock, low_stock_threshold
    from inventory_items
    order by name
  `;
  return rows.map(rowToInventoryItem);
}

export async function getLowStockItems(): Promise<InventoryItem[]> {
  const rows = await sql<InventoryItemRow[]>`
    select id, name, unit, current_stock, low_stock_threshold
    from inventory_items
    where current_stock <= low_stock_threshold
    order by name
  `;
  return rows.map(rowToInventoryItem);
}

export async function createInventoryItem(input: {
  name: string;
  unit: string;
  lowStockThreshold: number;
}): Promise<InventoryItem> {
  const [row] = await sql<InventoryItemRow[]>`
    insert into inventory_items (name, unit, low_stock_threshold)
    values (${input.name}, ${input.unit}, ${input.lowStockThreshold})
    returning id, name, unit, current_stock, low_stock_threshold
  `;
  return rowToInventoryItem(row);
}

/** Logs a restock event and bumps current_stock in the same transaction,
 * so the stock_entries audit trail and the live stock level can never
 * drift apart from a partial failure. */
export async function addStock(inventoryItemId: number, quantityAdded: number): Promise<void> {
  if (quantityAdded <= 0) {
    throw new Error("quantityAdded must be positive");
  }
  await sql.begin(async (tx) => {
    await tx`
      insert into stock_entries (inventory_item_id, quantity_added)
      values (${inventoryItemId}, ${quantityAdded})
    `;
    await tx`
      update inventory_items
      set current_stock = current_stock + ${quantityAdded}
      where id = ${inventoryItemId}
    `;
  });
}

/** A request the caller can fix, as opposed to a server fault. */
export class StockAdjustmentError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404
  ) {
    super(message);
  }
}

export type StockAdjustmentInput =
  | { kind: "waste"; inventoryItemId: number; quantity: number; reason: string; note?: string }
  | { kind: "count"; inventoryItemId: number; countedStock: number; reason?: string; note?: string };

/**
 * Records waste or a physical count and applies it to current_stock in one
 * transaction. The row is locked first so a sale landing at the same moment
 * can't slip between reading the expected stock and writing the new one.
 *
 * A count replaces the stock level, but the entry keeps what the system
 * expected, so the difference stays reviewable instead of disappearing.
 */
export async function recordStockAdjustment(
  input: StockAdjustmentInput,
  staffId: number
): Promise<{ item: InventoryItem; adjustment: StockAdjustment }> {
  const adjustmentId = await sql.begin(async (tx): Promise<number> => {
    const [current] = await tx`
      select current_stock from inventory_items where id = ${input.inventoryItemId} for update
    `;
    if (!current) {
      throw new StockAdjustmentError("That ingredient no longer exists.", 404);
    }

    if (input.kind === "waste") {
      const [row] = await tx`
        insert into stock_adjustments
          (inventory_item_id, kind, quantity_change, expected_stock, reason, note, staff_id)
        values (
          ${input.inventoryItemId}, 'waste', ${-input.quantity}, ${current.current_stock},
          ${input.reason}, ${input.note ?? null}, ${staffId}
        )
        returning id
      `;
      await tx`
        update inventory_items set current_stock = current_stock - ${input.quantity}
        where id = ${input.inventoryItemId}
      `;
      return row.id;
    } else {
      // The difference is worked out in Postgres's exact numeric, not as a
      // JavaScript float, so a matching count never shows a 0.0000001 gap.
      const [{ difference }] = await tx`
        select ${input.countedStock}::numeric - ${current.current_stock}::numeric as difference
      `;
      const matches = Number(difference) === 0;
      if (!matches && !input.reason) {
        throw new StockAdjustmentError("Pick a reason for the difference.", 400);
      }
      const [row] = await tx`
        insert into stock_adjustments
          (inventory_item_id, kind, quantity_change, expected_stock, counted_stock, reason, note, staff_id)
        values (
          ${input.inventoryItemId}, 'count', ${difference}, ${current.current_stock}, ${input.countedStock},
          ${matches ? null : input.reason!}, ${input.note ?? null}, ${staffId}
        )
        returning id
      `;
      await tx`
        update inventory_items set current_stock = ${input.countedStock}
        where id = ${input.inventoryItemId}
      `;
      return row.id;
    }
  });

  const [itemRow] = await sql<InventoryItemRow[]>`
    select id, name, unit, current_stock, low_stock_threshold
    from inventory_items where id = ${input.inventoryItemId}
  `;
  const [adjustmentRow] = await sql<StockAdjustmentRow[]>`
    ${adjustmentSelect()} where a.id = ${adjustmentId}
  `;
  return { item: rowToInventoryItem(itemRow), adjustment: rowToStockAdjustment(adjustmentRow) };
}

interface StockAdjustmentRow {
  id: number;
  inventory_item_id: number;
  inventory_item_name: string;
  unit: string;
  kind: "waste" | "count";
  quantity_change: string | number;
  expected_stock: string | number;
  counted_stock: string | number | null;
  reason: string | null;
  note: string | null;
  staff_name: string | null;
  created_at: Date;
}

function adjustmentSelect() {
  return sql`
    select a.id, a.inventory_item_id, i.name as inventory_item_name, i.unit, a.kind,
           a.quantity_change, a.expected_stock, a.counted_stock, a.reason, a.note,
           s.name as staff_name, a.created_at
    from stock_adjustments a
    join inventory_items i on i.id = a.inventory_item_id
    left join staff s on s.id = a.staff_id
  `;
}

function rowToStockAdjustment(row: StockAdjustmentRow): StockAdjustment {
  return {
    id: row.id,
    inventoryItemId: row.inventory_item_id,
    inventoryItemName: row.inventory_item_name,
    unit: row.unit,
    kind: row.kind,
    quantityChange: Number(row.quantity_change),
    expectedStock: Number(row.expected_stock),
    countedStock: row.counted_stock === null ? null : Number(row.counted_stock),
    reason: row.reason,
    note: row.note,
    staffName: row.staff_name,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function getRecentStockAdjustments(limit = 30): Promise<StockAdjustment[]> {
  const rows = await sql<StockAdjustmentRow[]>`
    ${adjustmentSelect()} order by a.created_at desc, a.id desc limit ${limit}
  `;
  return rows.map(rowToStockAdjustment);
}

/** Waste and count differences per ingredient over the last
 * ACTIVITY_LOOKBACK_DAYS, plus how long since each was last counted. */
export async function getInventoryActivity(): Promise<Record<number, InventoryActivity>> {
  const rows = await sql`
    select i.id,
           coalesce(-sum(a.quantity_change) filter (
             where a.kind = 'waste' and a.created_at >= now() - (${ACTIVITY_LOOKBACK_DAYS} || ' days')::interval
           ), 0) as wasted,
           coalesce(sum(a.quantity_change) filter (
             where a.kind = 'count' and a.created_at >= now() - (${ACTIVITY_LOOKBACK_DAYS} || ' days')::interval
           ), 0) as count_variance,
           floor(extract(epoch from now() - max(a.created_at) filter (where a.kind = 'count')) / 86400)::integer
             as days_since_count
    from inventory_items i
    left join stock_adjustments a on a.inventory_item_id = i.id
    group by i.id
  `;
  const result: Record<number, InventoryActivity> = {};
  for (const r of rows) {
    result[r.id] = {
      wasted: Number(r.wasted),
      countVariance: Number(r.count_variance),
      daysSinceCount: r.days_since_count,
    };
  }
  return result;
}
