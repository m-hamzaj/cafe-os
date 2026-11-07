import "server-only";
import { sql } from "@/lib/db";
import type { CostSummary } from "@/lib/types";

export const COST_LOOKBACK_DAYS = 7;

/**
 * Cost of goods sold and related figures over the last COST_LOOKBACK_DAYS.
 *
 * COGS here is the ingredient cost recorded on each sale when it was sold
 * (recipe plus options), not beginning inventory + purchases − ending
 * inventory: cafe-os has no inventory valuation from before costs existed.
 * Sales, waste and counts without a recorded cost are counted separately
 * instead of being estimated.
 */
export async function getCostSummary(): Promise<CostSummary> {
  const [[sales], [adjustments], [stock]] = await Promise.all([
    sql`
      select coalesce(sum(ol.quantity * ol.unit_price_cents), 0) as sales_cents,
             coalesce(sum(ol.quantity * ol.unit_price_cents) filter (where ol.unit_cost_cents is not null), 0)
               as costed_sales_cents,
             coalesce(sum(ol.quantity * ol.unit_cost_cents), 0) as cogs_cents,
             count(*) filter (where ol.unit_cost_cents is null)::integer as uncosted_lines
      from order_lines ol
      join orders o on o.id = ol.order_id
      where o.status = 'paid' and o.created_at >= now() - (${COST_LOOKBACK_DAYS} || ' days')::interval
    `,
    sql`
      select coalesce(sum(-a.quantity_change * a.unit_cost_cents) filter (where a.kind = 'waste'), 0)
               as waste_cost_cents,
             count(*) filter (where a.kind = 'waste' and a.unit_cost_cents is null)::integer
               as uncosted_waste,
             coalesce(sum(a.quantity_change * a.unit_cost_cents) filter (where a.kind = 'count'), 0)
               as count_difference_cents,
             count(*) filter (where a.kind = 'count' and a.quantity_change <> 0 and a.unit_cost_cents is null)::integer
               as uncosted_counts
      from stock_adjustments a
      where a.created_at >= now() - (${COST_LOOKBACK_DAYS} || ' days')::interval
    `,
    sql`
      select coalesce(sum(greatest(current_stock, 0) * unit_cost_cents), 0) as stock_value_cents,
             count(*) filter (where unit_cost_cents is null)::integer as ingredients_without_cost
      from inventory_items
    `,
  ]);

  return {
    days: COST_LOOKBACK_DAYS,
    salesCents: Number(sales.sales_cents),
    costedSalesCents: Number(sales.costed_sales_cents),
    cogsCents: Number(sales.cogs_cents),
    uncostedLines: sales.uncosted_lines,
    wasteCostCents: Number(adjustments.waste_cost_cents),
    uncostedWasteEntries: adjustments.uncosted_waste,
    countDifferenceCents: Number(adjustments.count_difference_cents),
    uncostedCounts: adjustments.uncosted_counts,
    stockValueCents: Number(stock.stock_value_cents),
    ingredientsWithoutCost: stock.ingredients_without_cost,
  };
}

/** Each menu item's base recipe cost at today's ingredient costs (no
 * options), or null when an ingredient in its recipe has no cost. */
export async function getMenuItemCosts(): Promise<Record<number, number | null>> {
  const rows = await sql`
    select m.id,
           case when bool_and(i.unit_cost_cents is not null or r.inventory_item_id is null)
                then coalesce(sum(r.quantity_used * i.unit_cost_cents), 0)
           end as cost_cents
    from menu_items m
    left join recipe_lines r on r.menu_item_id = m.id
    left join inventory_items i on i.id = r.inventory_item_id
    group by m.id
  `;
  const result: Record<number, number | null> = {};
  for (const r of rows) result[r.id] = r.cost_cents === null ? null : Number(r.cost_cents);
  return result;
}
