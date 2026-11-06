import "server-only";
import { sql } from "@/lib/db";
import type { MenuItem, MenuOptionGroup } from "@/lib/types";

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

/** Option groups for the given menu items, keyed by menu item id. */
export async function getOptionGroups(menuItemIds: number[]): Promise<Map<number, MenuOptionGroup[]>> {
  const result = new Map<number, MenuOptionGroup[]>();
  if (menuItemIds.length === 0) return result;

  const groupRows = await sql`
    select id, menu_item_id, name, is_required, allows_multiple
    from menu_option_groups
    where menu_item_id = any(${menuItemIds})
    order by sort_order, id
  `;
  const groupIds = groupRows.map((g) => g.id);
  if (groupIds.length === 0) return result;

  const optionRows = await sql`
    select id, group_id, name, price_delta_cents, is_available
    from menu_options
    where group_id = any(${groupIds})
    order by sort_order, id
  `;
  const optionIds = optionRows.map((o) => o.id);
  const adjustmentRows =
    optionIds.length === 0
      ? []
      : await sql`
          select option_id, inventory_item_id, quantity_delta
          from option_recipe_adjustments
          where option_id = any(${optionIds})
          order by inventory_item_id
        `;

  for (const g of groupRows) {
    const groups = result.get(g.menu_item_id) ?? [];
    groups.push({
      id: g.id,
      name: g.name,
      isRequired: g.is_required,
      allowsMultiple: g.allows_multiple,
      options: optionRows
        .filter((o) => o.group_id === g.id)
        .map((o) => ({
          id: o.id,
          name: o.name,
          priceDeltaCents: o.price_delta_cents,
          isAvailable: o.is_available,
          adjustments: adjustmentRows
            .filter((a) => a.option_id === o.id)
            .map((a) => ({
              inventoryItemId: a.inventory_item_id,
              quantityDelta: Number(a.quantity_delta),
            })),
        })),
    });
    result.set(g.menu_item_id, groups);
  }
  return result;
}

export interface OptionGroupInput {
  id?: number;
  name: string;
  isRequired: boolean;
  allowsMultiple: boolean;
  options: Array<{
    id?: number;
    name: string;
    priceDeltaCents: number;
    /** Omitted to keep the option's current stock status. */
    isAvailable?: boolean;
    adjustments: Array<{ inventoryItemId: number; quantityDelta: number }>;
  }>;
}

/**
 * Saves a menu item's whole option setup. Unlike setMenuItemRecipe this
 * updates rows in place rather than replacing them: order_line_options
 * points at menu_options, and the stock runway follows that link, so
 * re-creating options on every save would drop their usage from recent
 * history.
 */
export async function setMenuItemOptions(menuItemId: number, groups: OptionGroupInput[]): Promise<void> {
  await sql.begin(async (tx) => {
    const existingGroups = await tx`select id from menu_option_groups where menu_item_id = ${menuItemId}`;
    const existingGroupIds = new Set<number>(existingGroups.map((g) => g.id));
    const keptGroupIds = new Set(groups.flatMap((g) => (g.id ? [g.id] : [])));

    for (const id of existingGroupIds) {
      if (!keptGroupIds.has(id)) await tx`delete from menu_option_groups where id = ${id}`;
    }

    for (const [groupIndex, group] of groups.entries()) {
      let groupId: number;
      if (group.id) {
        if (!existingGroupIds.has(group.id)) {
          throw new Error(`Option group ${group.id} does not belong to this menu item.`);
        }
        groupId = group.id;
        await tx`
          update menu_option_groups
          set name = ${group.name},
              is_required = ${group.isRequired},
              allows_multiple = ${group.allowsMultiple},
              sort_order = ${groupIndex}
          where id = ${groupId}
        `;
      } else {
        const [row] = await tx`
          insert into menu_option_groups (menu_item_id, name, is_required, allows_multiple, sort_order)
          values (${menuItemId}, ${group.name}, ${group.isRequired}, ${group.allowsMultiple}, ${groupIndex})
          returning id
        `;
        groupId = row.id;
      }

      const existingOptions = await tx`select id from menu_options where group_id = ${groupId}`;
      const existingOptionIds = new Set<number>(existingOptions.map((o) => o.id));
      const keptOptionIds = new Set(group.options.flatMap((o) => (o.id ? [o.id] : [])));

      for (const id of existingOptionIds) {
        if (!keptOptionIds.has(id)) await tx`delete from menu_options where id = ${id}`;
      }

      for (const [optionIndex, option] of group.options.entries()) {
        let optionId: number;
        if (option.id) {
          if (!existingOptionIds.has(option.id)) {
            throw new Error(`Option ${option.id} does not belong to this option group.`);
          }
          optionId = option.id;
          await tx`
            update menu_options
            set name = ${option.name},
                price_delta_cents = ${option.priceDeltaCents},
                is_available = coalesce(${option.isAvailable ?? null}::boolean, is_available),
                sort_order = ${optionIndex}
            where id = ${optionId}
          `;
        } else {
          const [row] = await tx`
            insert into menu_options (group_id, name, price_delta_cents, is_available, sort_order)
            values (${groupId}, ${option.name}, ${option.priceDeltaCents}, ${option.isAvailable ?? true}, ${optionIndex})
            returning id
          `;
          optionId = row.id;
        }

        await tx`delete from option_recipe_adjustments where option_id = ${optionId}`;
        for (const adjustment of option.adjustments) {
          await tx`
            insert into option_recipe_adjustments (option_id, inventory_item_id, quantity_delta)
            values (${optionId}, ${adjustment.inventoryItemId}, ${adjustment.quantityDelta})
          `;
        }
      }
    }
  });
}

/**
 * Flips an option's stock status and returns the ids it changed, which is
 * empty when the option no longer exists. With acrossMenu it also flips the
 * same option on every other menu item, including ones hidden from the counter.
 * "Same" means the same option name in a group of the same name, ignoring
 * case, so Milk/Oat doesn't catch a Toppings/Oat.
 */
export async function setOptionAvailability(
  optionId: number,
  isAvailable: boolean,
  acrossMenu: boolean
): Promise<number[]> {
  const rows = acrossMenu
    ? await sql`
        update menu_options target
        set is_available = ${isAvailable}
        from menu_option_groups target_group, menu_options source, menu_option_groups source_group
        where source.id = ${optionId}
          and source_group.id = source.group_id
          and target_group.id = target.group_id
          and lower(target.name) = lower(source.name)
          and lower(target_group.name) = lower(source_group.name)
        returning target.id
      `
    : await sql`
        update menu_options set is_available = ${isAvailable} where id = ${optionId} returning id
      `;
  return rows.map((r) => r.id);
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
