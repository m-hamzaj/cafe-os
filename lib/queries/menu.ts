import "server-only";
import { sql } from "@/lib/db";
import type { MenuItem } from "@/lib/types";

interface MenuItemRow {
  id: number;
  name: string;
  category: string;
  price_cents: number;
  is_available: boolean;
}

function rowToMenuItem(row: MenuItemRow): MenuItem {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    priceCents: row.price_cents,
    isAvailable: row.is_available,
  };
}

export async function getMenuItems(): Promise<MenuItem[]> {
  const rows = await sql<MenuItemRow[]>`
    select id, name, category, price_cents, is_available
    from menu_items
    order by category, name
  `;
  return rows.map(rowToMenuItem);
}

export async function getAvailableMenuItems(): Promise<MenuItem[]> {
  const rows = await sql<MenuItemRow[]>`
    select id, name, category, price_cents, is_available
    from menu_items
    where is_available
    order by category, name
  `;
  return rows.map(rowToMenuItem);
}

export async function createMenuItem(input: {
  name: string;
  category: string;
  priceCents: number;
}): Promise<MenuItem> {
  const [row] = await sql<MenuItemRow[]>`
    insert into menu_items (name, category, price_cents)
    values (${input.name}, ${input.category}, ${input.priceCents})
    returning id, name, category, price_cents, is_available
  `;
  return rowToMenuItem(row);
}

export async function updateMenuItem(
  id: number,
  input: { name: string; category: string; priceCents: number; isAvailable: boolean }
): Promise<MenuItem> {
  const [row] = await sql<MenuItemRow[]>`
    update menu_items
    set name = ${input.name},
        category = ${input.category},
        price_cents = ${input.priceCents},
        is_available = ${input.isAvailable}
    where id = ${id}
    returning id, name, category, price_cents, is_available
  `;
  return rowToMenuItem(row);
}

export async function setMenuItemRecipe(
  menuItemId: number,
  lines: Array<{ inventoryItemId: number; quantityUsed: number }>
): Promise<void> {
  // Replace-the-whole-recipe semantics: simpler and less error-prone for
  // a small menu-editing UI than diffing individual recipe line changes.
  await sql.begin(async (tx) => {
    await tx`delete from recipe_lines where menu_item_id = ${menuItemId}`;
    for (const line of lines) {
      await tx`
        insert into recipe_lines (menu_item_id, inventory_item_id, quantity_used)
        values (${menuItemId}, ${line.inventoryItemId}, ${line.quantityUsed})
      `;
    }
  });
}

interface RecipeLineRow {
  inventory_item_id: number;
  inventory_item_name: string;
  quantity_used: string | number;
}

export async function getMenuItemRecipe(
  menuItemId: number
): Promise<Array<{ inventoryItemId: number; inventoryItemName: string; quantityUsed: number }>> {
  const rows = await sql<RecipeLineRow[]>`
    select r.inventory_item_id, i.name as inventory_item_name, r.quantity_used
    from recipe_lines r
    join inventory_items i on i.id = r.inventory_item_id
    where r.menu_item_id = ${menuItemId}
  `;
  return rows.map((r) => ({
    inventoryItemId: r.inventory_item_id,
    inventoryItemName: r.inventory_item_name,
    quantityUsed: Number(r.quantity_used),
  }));
}
