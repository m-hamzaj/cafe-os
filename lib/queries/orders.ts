import "server-only";
import { sql } from "@/lib/db";
import { CAFE_TIMEZONE } from "@/lib/time";
import { ingredientCostCents } from "@/lib/costs";
import type { OrderLineInput, OrderWithLines, PaymentMethod } from "@/lib/types";

/**
 * Creates and immediately closes a paid order: inserts the order, its
 * lines (at the menu item's *current* price plus any chosen options,
 * captured at sale time so a later price change never rewrites a historical
 * total), and decrements inventory per recipe_lines plus each chosen
 * option's adjustments -- all in one transaction.
 *
 * Deliberately never blocks checkout on an inventory shortfall: a real
 * cafe counter can't refuse to serve a customer because the stock count
 * is off. Stock is allowed to go negative; the inventory/insights views
 * surface that as an urgent restock signal instead. For the same reason an
 * option marked out of stock is still accepted here: the counter stops
 * offering it, but a line already in someone's cart can still be paid for.
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
        select name, price_cents from menu_items where id = ${line.menuItemId}
      `;
      if (!menuItem) {
        throw new Error(`Menu item ${line.menuItemId} does not exist.`);
      }

      const groups = await tx`
        select id, name, is_required, allows_multiple
        from menu_option_groups
        where menu_item_id = ${line.menuItemId}
      `;
      const options = await tx`
        select o.id, o.group_id, o.name, o.price_delta_cents
        from menu_options o
        join menu_option_groups g on g.id = o.group_id
        where g.menu_item_id = ${line.menuItemId}
        order by g.sort_order, g.id, o.sort_order, o.id
      `;

      const selectedIds = new Set(line.optionIds);
      const selected = options.filter((o) => selectedIds.has(o.id));
      if (selected.length !== selectedIds.size) {
        throw new Error(`An option chosen for ${menuItem.name} is no longer on the menu.`);
      }
      for (const group of groups) {
        const chosenCount = selected.filter((o) => o.group_id === group.id).length;
        if (group.is_required && chosenCount === 0) {
          throw new Error(`${menuItem.name} needs a choice for ${group.name}.`);
        }
        if (!group.allows_multiple && chosenCount > 1) {
          throw new Error(`${menuItem.name} can only have one choice for ${group.name}.`);
        }
      }

      const optionsTotal = selected.reduce((sum, o) => sum + Number(o.price_delta_cents), 0);
      // A discount option can't push a line below free.
      const unitPriceCents = Math.max(0, Number(menuItem.price_cents) + optionsTotal);
      totalCents += unitPriceCents * line.quantity;

      // What one unit consumes: the recipe, adjusted by the chosen options.
      const usedPerUnit = new Map<number, number>();
      const recipeLines = await tx`
        select inventory_item_id, quantity_used
        from recipe_lines
        where menu_item_id = ${line.menuItemId}
      `;
      for (const recipeLine of recipeLines) {
        usedPerUnit.set(recipeLine.inventory_item_id, Number(recipeLine.quantity_used));
      }
      if (selected.length > 0) {
        const adjustments = await tx`
          select inventory_item_id, quantity_delta
          from option_recipe_adjustments
          where option_id = any(${selected.map((o) => o.id)})
        `;
        for (const adjustment of adjustments) {
          const current = usedPerUnit.get(adjustment.inventory_item_id) ?? 0;
          usedPerUnit.set(adjustment.inventory_item_id, current + Number(adjustment.quantity_delta));
        }
      }

      // The ingredient cost of one unit, at today's ingredient costs, kept on
      // the line so later price changes don't rewrite this sale's margin.
      const costRows =
        usedPerUnit.size === 0
          ? []
          : await tx`
              select id, unit_cost_cents from inventory_items where id = any(${[...usedPerUnit.keys()]})
            `;
      const costById = new Map<number, number | null>(
        costRows.map((r) => [r.id, r.unit_cost_cents === null ? null : Number(r.unit_cost_cents)])
      );
      const unitCostCents = ingredientCostCents(usedPerUnit, costById);

      const [orderLine] = await tx`
        insert into order_lines (order_id, menu_item_id, quantity, unit_price_cents, unit_cost_cents)
        values (${orderId}, ${line.menuItemId}, ${line.quantity}, ${unitPriceCents}, ${unitCostCents})
        returning id
      `;

      for (const option of selected) {
        const group = groups.find((g) => g.id === option.group_id)!;
        await tx`
          insert into order_line_options (order_line_id, option_id, group_name, option_name, price_delta_cents)
          values (${orderLine.id}, ${option.id}, ${group.name}, ${option.name}, ${option.price_delta_cents})
        `;
      }

      // Scaled by how many were ordered. Floored at zero so an adjustment
      // larger than the recipe can't add stock by selling something.
      for (const [inventoryItemId, perUnit] of usedPerUnit) {
        const totalUsed = Math.max(0, perUnit) * line.quantity;
        if (totalUsed === 0) continue;
        await tx`
          update inventory_items
          set current_stock = current_stock - ${totalUsed}
          where id = ${inventoryItemId}
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
    select ol.id, ol.order_id, ol.menu_item_id, m.name as menu_item_name, ol.quantity, ol.unit_price_cents
    from order_lines ol
    join menu_items m on m.id = ol.menu_item_id
    where ol.order_id = any(${orderIds})
  `;
  const lineOptionRows = await sql`
    select olo.order_line_id, olo.option_name
    from order_line_options olo
    join order_lines ol on ol.id = olo.order_line_id
    where ol.order_id = any(${orderIds})
    order by olo.id
  `;

  return orderRows.map((o) => {
    const lines = lineRows
      .filter((l) => l.order_id === o.id)
      .map((l) => ({
        menuItemId: l.menu_item_id,
        menuItemName: l.menu_item_name,
        quantity: l.quantity,
        unitPriceCents: l.unit_price_cents,
        optionNames: lineOptionRows.filter((p) => p.order_line_id === l.id).map((p) => p.option_name),
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
