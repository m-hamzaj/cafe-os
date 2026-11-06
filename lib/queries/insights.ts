import "server-only";
import { sql } from "@/lib/db";
import { CAFE_TIMEZONE } from "@/lib/time";

export interface TopSeller {
  menuItemName: string;
  unitsSold: number;
  revenueCents: number;
}

export interface StockRunway {
  inventoryItemName: string;
  unit: string;
  currentStock: number;
  dailyConsumptionRate: number;
  /** null when there's no measurable consumption in the lookback window
   * -- "infinite runway" shouldn't be reported as a number. */
  daysRemaining: number | null;
}

export interface SalesDelta {
  todayCents: number;
  yesterdayCents: number;
  thisWeekCents: number;
  lastWeekCents: number;
}

export interface InsightData {
  topSellers: TopSeller[];
  bottomSellers: TopSeller[];
  stockRunway: StockRunway[];
  salesDelta: SalesDelta;
}

const LOOKBACK_DAYS = 7;

/** All the real, computed numbers an AI insight summary is allowed to
 * narrate -- nothing in lib/llm/insights.ts may state a figure that
 * doesn't come from here. Same contract as the gig-tax-calculator's
 * calculate.ts -> AI explanation layer. */
export async function computeInsightData(): Promise<InsightData> {
  const [topSellers, bottomSellers, stockRunway, salesDelta] = await Promise.all([
    getTopSellers(5),
    getBottomSellers(5),
    getStockRunway(),
    getSalesDelta(),
  ]);
  return { topSellers, bottomSellers, stockRunway, salesDelta };
}

async function getTopSellers(limit: number): Promise<TopSeller[]> {
  const rows = await sql`
    select m.name as menu_item_name,
           sum(ol.quantity) as units_sold,
           sum(ol.quantity * ol.unit_price_cents) as revenue_cents
    from order_lines ol
    join orders o on o.id = ol.order_id
    join menu_items m on m.id = ol.menu_item_id
    where o.status = 'paid' and o.created_at >= now() - (${LOOKBACK_DAYS} || ' days')::interval
    group by m.name
    order by units_sold desc
    limit ${limit}
  `;
  return rows.map((r) => ({
    menuItemName: r.menu_item_name,
    unitsSold: Number(r.units_sold),
    revenueCents: Number(r.revenue_cents),
  }));
}

async function getBottomSellers(limit: number): Promise<TopSeller[]> {
  // Only menu items that are available but have real (possibly zero)
  // sales in the window -- an unavailable item showing "0 sold" isn't a
  // useful signal.
  const rows = await sql`
    select m.name as menu_item_name,
           coalesce(sum(ol.quantity), 0) as units_sold,
           coalesce(sum(ol.quantity * ol.unit_price_cents), 0) as revenue_cents
    from menu_items m
    left join order_lines ol on ol.menu_item_id = m.id
    left join orders o on o.id = ol.order_id
      and o.status = 'paid' and o.created_at >= now() - (${LOOKBACK_DAYS} || ' days')::interval
    where m.is_available
    group by m.name
    order by units_sold asc
    limit ${limit}
  `;
  return rows.map((r) => ({
    menuItemName: r.menu_item_name,
    unitsSold: Number(r.units_sold),
    revenueCents: Number(r.revenue_cents),
  }));
}

async function getStockRunway(): Promise<StockRunway[]> {
  // Mirrors createPaidOrder: per line, an ingredient's use is the recipe plus
  // the chosen options' adjustments, floored at zero, times the quantity.
  // Adjustments are read from the option's current definition, and an option
  // deleted since the sale no longer contributes.
  const rows = await sql`
    with recent_lines as (
      select ol.id, ol.menu_item_id, ol.quantity
      from order_lines ol
      join orders o on o.id = ol.order_id
      where o.status = 'paid' and o.created_at >= now() - (${LOOKBACK_DAYS} || ' days')::interval
    ),
    per_unit as (
      select l.id as order_line_id, l.quantity, r.inventory_item_id, r.quantity_used as amount
      from recent_lines l
      join recipe_lines r on r.menu_item_id = l.menu_item_id
      union all
      select l.id, l.quantity, a.inventory_item_id, a.quantity_delta
      from recent_lines l
      join order_line_options olo on olo.order_line_id = l.id
      join option_recipe_adjustments a on a.option_id = olo.option_id
    ),
    line_usage as (
      select inventory_item_id, greatest(sum(amount), 0) * quantity as used
      from per_unit
      group by order_line_id, quantity, inventory_item_id
    ),
    total_usage as (
      select inventory_item_id, sum(used) as used
      from line_usage
      group by inventory_item_id
    )
    select i.name as inventory_item_name,
           i.unit,
           i.current_stock,
           coalesce(u.used, 0) / ${LOOKBACK_DAYS}::numeric as daily_rate
    from inventory_items i
    left join total_usage u on u.inventory_item_id = i.id
    order by i.name
  `;
  return rows.map((r) => {
    const currentStock = Number(r.current_stock);
    const dailyRate = Number(r.daily_rate);
    return {
      inventoryItemName: r.inventory_item_name,
      unit: r.unit,
      currentStock,
      dailyConsumptionRate: dailyRate,
      daysRemaining: dailyRate > 0 ? currentStock / dailyRate : null,
    };
  });
}

async function getSalesDelta(): Promise<SalesDelta> {
  // Every day boundary is anchored to the cafe's own timezone (lib/time.ts),
  // not Postgres's session timezone -- `date_trunc('day', now())` alone
  // resolves "today" against whatever timezone the DB session happens to
  // be in (UTC in this Docker setup), which can disagree with the local
  // calendar day getOrderHistory computes, especially right around
  // midnight. Both files must agree on what day "today" is.
  //
  // "today"/"this_week" are also capped at `now()`, not just floored at
  // day-start, so a stray future-dated row (e.g. a seeding bug) can't
  // silently inflate these while getOrderHistory's `to` bound excludes it.
  const [row] = await sql`
    with bounds as (
      select date_trunc('day', now() AT TIME ZONE ${CAFE_TIMEZONE}) AT TIME ZONE ${CAFE_TIMEZONE} as today_start
    )
    select
      coalesce(sum(ol.quantity * ol.unit_price_cents)
        filter (where o.created_at >= bounds.today_start and o.created_at <= now()), 0) as today_cents,
      coalesce(sum(ol.quantity * ol.unit_price_cents)
        filter (where o.created_at >= bounds.today_start - interval '1 day'
                  and o.created_at < bounds.today_start), 0) as yesterday_cents,
      coalesce(sum(ol.quantity * ol.unit_price_cents)
        filter (where o.created_at >= bounds.today_start - interval '6 days'
                  and o.created_at <= now()), 0) as this_week_cents,
      coalesce(sum(ol.quantity * ol.unit_price_cents)
        filter (where o.created_at >= bounds.today_start - interval '13 days'
                  and o.created_at < bounds.today_start - interval '6 days'), 0) as last_week_cents
    from order_lines ol
    join orders o on o.id = ol.order_id
    cross join bounds
    where o.status = 'paid'
  `;
  return {
    todayCents: Number(row.today_cents),
    yesterdayCents: Number(row.yesterday_cents),
    thisWeekCents: Number(row.this_week_cents),
    lastWeekCents: Number(row.last_week_cents),
  };
}
