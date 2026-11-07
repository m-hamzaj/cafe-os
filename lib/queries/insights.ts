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

export interface WasteSummary {
  inventoryItemName: string;
  unit: string;
  wasted: number;
  entries: number;
  /** The reason given most often; ties are broken alphabetically. */
  topReason: string;
}

export interface CountDifferenceSummary {
  inventoryItemName: string;
  unit: string;
  /** Net of all mismatched counts: negative means stock went missing. */
  netDifference: number;
  mismatchedCounts: number;
  /** The reason given most often; ties are broken alphabetically. */
  topReason: string;
}

export interface InsightData {
  topSellers: TopSeller[];
  bottomSellers: TopSeller[];
  stockRunway: StockRunway[];
  salesDelta: SalesDelta;
  /** Only ingredients with waste logged in the window; empty when none was. */
  waste: WasteSummary[];
  /** Only ingredients with a count that didn't match in the window. */
  countDifferences: CountDifferenceSummary[];
  /** How many counts were saved in the window, matching or not, so "no
   * differences" can be told apart from "nobody counted". */
  countsSaved: number;
}

const LOOKBACK_DAYS = 7;

/** All the real, computed numbers an AI insight summary is allowed to
 * narrate -- nothing in lib/llm/insights.ts may state a figure that
 * doesn't come from here. Same contract as the gig-tax-calculator's
 * calculate.ts -> AI explanation layer. */
export async function computeInsightData(): Promise<InsightData> {
  const [topSellers, bottomSellers, stockRunway, salesDelta, waste, counts] = await Promise.all([
    getTopSellers(5),
    getBottomSellers(5),
    getStockRunway(),
    getSalesDelta(),
    getWasteSummary(5),
    getCountDifferences(5),
  ]);
  return {
    topSellers,
    bottomSellers,
    stockRunway,
    salesDelta,
    waste,
    countDifferences: counts.differences,
    countsSaved: counts.countsSaved,
  };
}

/** Counts that didn't match the system over the lookback window, per
 * ingredient, most mismatches first. Like waste, amounts are in each
 * ingredient's own unit and aren't compared across ingredients. */
async function getCountDifferences(
  limit: number
): Promise<{ differences: CountDifferenceSummary[]; countsSaved: number }> {
  // A fresh fragment per query rather than one shared object.
  const inWindow = () => sql`a.kind = 'count' and a.created_at >= now() - (${LOOKBACK_DAYS} || ' days')::interval`;
  const [rows, [{ counts_saved }]] = await Promise.all([
    sql`
      select i.name as inventory_item_name,
             i.unit,
             sum(a.quantity_change) as net_difference,
             count(*)::integer as mismatched_counts,
             mode() within group (order by a.reason) as top_reason
      from stock_adjustments a
      join inventory_items i on i.id = a.inventory_item_id
      where ${inWindow()} and a.quantity_change <> 0
      group by i.id, i.name, i.unit
      order by mismatched_counts desc, i.name
      limit ${limit}
    `,
    sql`select count(*)::integer as counts_saved from stock_adjustments a where ${inWindow()}`,
  ]);
  return {
    differences: rows.map((r) => ({
      inventoryItemName: r.inventory_item_name,
      unit: r.unit,
      netDifference: Number(r.net_difference),
      mismatchedCounts: r.mismatched_counts,
      topReason: r.top_reason,
    })),
    countsSaved: counts_saved,
  };
}

/** Logged waste per ingredient over the lookback window, most entries first.
 * Amounts are in each ingredient's own unit, so they aren't comparable
 * across ingredients; entry count is what decides the order. */
async function getWasteSummary(limit: number): Promise<WasteSummary[]> {
  const rows = await sql`
    select i.name as inventory_item_name,
           i.unit,
           -sum(a.quantity_change) as wasted,
           count(*)::integer as entries,
           mode() within group (order by a.reason) as top_reason
    from stock_adjustments a
    join inventory_items i on i.id = a.inventory_item_id
    where a.kind = 'waste' and a.created_at >= now() - (${LOOKBACK_DAYS} || ' days')::interval
    group by i.id, i.name, i.unit
    order by entries desc, i.name
    limit ${limit}
  `;
  return rows.map((r) => ({
    inventoryItemName: r.inventory_item_name,
    unit: r.unit,
    wasted: Number(r.wasted),
    entries: r.entries,
    topReason: r.top_reason,
  }));
}

/** The saved AI summary, or null if there isn't one newer than maxAgeMinutes. */
export async function getCachedInsightSummary(
  maxAgeMinutes: number
): Promise<{ summary: string; ageMinutes: number } | null> {
  const [row] = await sql`
    select summary,
           floor(extract(epoch from now() - generated_at) / 60)::integer as age_minutes
    from insight_summary_cache
    where generated_at > now() - (${maxAgeMinutes} || ' minutes')::interval
  `;
  return row ? { summary: row.summary, ageMinutes: row.age_minutes } : null;
}

export async function saveInsightSummary(summary: string): Promise<void> {
  await sql`
    insert into insight_summary_cache (id, summary, generated_at)
    values (1, ${summary}, now())
    on conflict (id) do update set summary = excluded.summary, generated_at = excluded.generated_at
  `;
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
  // useful signal. order_lines and orders are joined to each other first, so
  // a line outside the window drops out instead of still being counted.
  const rows = await sql`
    select m.name as menu_item_name,
           coalesce(sum(ol.quantity), 0) as units_sold,
           coalesce(sum(ol.quantity * ol.unit_price_cents), 0) as revenue_cents
    from menu_items m
    left join (
      order_lines ol
      join orders o on o.id = ol.order_id
        and o.status = 'paid' and o.created_at >= now() - (${LOOKBACK_DAYS} || ' days')::interval
    ) on ol.menu_item_id = m.id
    where m.is_available
    group by m.name
    order by units_sold asc, m.name
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
  //
  // Logged waste in the same window counts as usage too, since it empties the
  // shelf just like a sale. Count differences don't: a count can correct drift
  // built up over far longer than the window, which would distort the rate.
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
    waste_usage as (
      select inventory_item_id, -quantity_change as used
      from stock_adjustments
      where kind = 'waste' and created_at >= now() - (${LOOKBACK_DAYS} || ' days')::interval
    ),
    total_usage as (
      select inventory_item_id, sum(used) as used
      from (
        select inventory_item_id, used from line_usage
        union all
        select inventory_item_id, used from waste_usage
      ) all_usage
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
