import { formatCostCents } from "@/lib/costs";
import type { CostSummary } from "@/lib/types";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Cost of goods sold and related figures. Profit and food cost % only use
 * sales whose ingredient cost was known, and say so, rather than mixing in
 * sales with no cost as if they were free. */
export default function CostsCard({ costs }: { costs: CostSummary }) {
  const hasCostedSales = costs.costedSalesCents > 0;
  const grossProfit = costs.costedSalesCents - costs.cogsCents;
  const foodCostPct = hasCostedSales ? Math.round((costs.cogsCents / costs.costedSalesCents) * 100) : null;
  const allCosted = costs.uncostedLines === 0;

  const rows: Array<{ label: string; value: string; note?: string; warn?: boolean }> = [
    { label: "Sales", value: formatCostCents(costs.salesCents) },
    {
      label: "Cost of goods sold",
      value: hasCostedSales ? formatCostCents(costs.cogsCents) : "—",
      note: allCosted ? undefined : `on ${formatCostCents(costs.costedSalesCents)} of costed sales`,
    },
    {
      label: "Gross profit",
      value: hasCostedSales ? formatCostCents(grossProfit) : "—",
      note: foodCostPct === null ? undefined : `food cost ${foodCostPct}% of sales`,
    },
    {
      label: "Waste",
      value: formatCostCents(costs.wasteCostCents),
      note: costs.uncostedWasteEntries > 0 ? `+ ${plural(costs.uncostedWasteEntries, "entry", "entries")} with no cost` : undefined,
    },
    {
      label: "Count differences",
      value: formatCostCents(costs.countDifferenceCents),
      note:
        costs.countDifferenceCents < 0
          ? "stock missing"
          : costs.uncostedCounts > 0
            ? `${plural(costs.uncostedCounts, "count", "counts")} with no cost`
            : undefined,
      warn: costs.countDifferenceCents < 0,
    },
    {
      label: "Stock on hand",
      value: formatCostCents(costs.stockValueCents),
      note:
        costs.ingredientsWithoutCost > 0
          ? `${plural(costs.ingredientsWithoutCost, "ingredient", "ingredients")} not valued`
          : "value now",
    },
  ];

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <p className="mb-3 text-sm font-semibold text-muted">Costs, last {costs.days} days</p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        {rows.map((r) => (
          <div key={r.label}>
            <dt className="text-xs text-muted">{r.label}</dt>
            <dd className={`font-display text-lg font-semibold ${r.warn ? "text-warn" : "text-ink"}`}>{r.value}</dd>
            {r.note && <dd className="text-xs text-muted">{r.note}</dd>}
          </div>
        ))}
      </dl>
      {!allCosted && (
        <p className="mt-4 text-xs text-muted">
          {plural(costs.uncostedLines, "sale line has", "sale lines have")} no cost, because an ingredient had no cost
          set when it was sold. Set ingredient costs on the Inventory page; earlier sales stay uncosted.
        </p>
      )}
    </div>
  );
}
