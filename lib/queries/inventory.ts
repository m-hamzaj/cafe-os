import "server-only";
import { sql } from "@/lib/db";
import type { InventoryItem } from "@/lib/types";

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
