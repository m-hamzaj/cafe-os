"use client";

import { useEffect, useState } from "react";
import CostsCard from "@/components/CostsCard";
import type { CostSummary } from "@/lib/types";
import { needsReorder } from "@/lib/reorder";

interface TopSeller {
  menuItemName: string;
  unitsSold: number;
  revenueCents: number;
}

interface StockRunway {
  inventoryItemName: string;
  unit: string;
  currentStock: number;
  dailyConsumptionRate: number;
  daysRemaining: number | null;
  leadTimeDays: number | null;
  reorderPoint: number | null;
  onOrder: number;
}

interface InsightData {
  topSellers: TopSeller[];
  bottomSellers: TopSeller[];
  stockRunway: StockRunway[];
  salesDelta: { todayCents: number; yesterdayCents: number; thisWeekCents: number; lastWeekCents: number };
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function InsightsPanel() {
  const [data, setData] = useState<InsightData | null>(null);
  const [costs, setCosts] = useState<CostSummary | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryAgeMinutes, setSummaryAgeMinutes] = useState<number | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/insights")
      .then((r) => r.json())
      .then((body) => {
        setData(body.data);
        setCosts(body.costs ?? null);
        setSummary(body.summary);
        setSummaryAgeMinutes(body.summaryAgeMinutes);
        setSummaryError(body.summaryError);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-muted">Loading today&apos;s numbers...</p>;
  }
  if (!data) {
    return <p className="text-warn">Could not load insights.</p>;
  }

  const weekDeltaPct =
    data.salesDelta.lastWeekCents > 0
      ? (((data.salesDelta.thisWeekCents - data.salesDelta.lastWeekCents) / data.salesDelta.lastWeekCents) * 100).toFixed(0)
      : null;

  // At its reorder point, or (for ingredients with no lead time set) five
  // days or less left.
  const runwayAlerts = data.stockRunway.filter(
    (r) => needsReorder(r.currentStock, r.reorderPoint) || (r.daysRemaining !== null && r.daysRemaining <= 5)
  );

  return (
    <div className="flex flex-col gap-6">
      {/* AI summary -- always renders from the real data below regardless
          of whether this narration succeeded, per the graceful-degradation
          contract in lib/llm/insights.ts. */}
      <div className="rounded-2xl border border-accent/40 bg-surface p-5">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold text-accent">Today, in brief</p>
          {summary && summaryAgeMinutes !== null && (
            <p className="text-xs text-muted">
              {summaryAgeMinutes === 0 ? "Written just now" : `Written ${summaryAgeMinutes} min ago`}
            </p>
          )}
        </div>
        {summary ? (
          <p className="text-ink">{summary}</p>
        ) : (
          <p className="text-sm text-muted">{summaryError ?? "Summary unavailable."}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Stat label="Today" value={formatCents(data.salesDelta.todayCents)} />
        <Stat label="Yesterday" value={formatCents(data.salesDelta.yesterdayCents)} />
        <Stat
          label="This week vs last"
          value={formatCents(data.salesDelta.thisWeekCents)}
          sub={weekDeltaPct !== null ? `${Number(weekDeltaPct) >= 0 ? "+" : ""}${weekDeltaPct}% vs last week` : undefined}
        />
        <Stat label="Last week" value={formatCents(data.salesDelta.lastWeekCents)} />
      </div>

      {runwayAlerts.length > 0 && (
        <div className="rounded-2xl border border-warn bg-warn/5 p-5">
          <p className="mb-2 text-sm font-semibold text-warn">Restock soon</p>
          <ul className="flex flex-col gap-1 text-sm text-ink">
            {runwayAlerts.map((r) => (
              <li key={r.inventoryItemName}>
                {r.inventoryItemName}:{" "}
                {r.onOrder > 0 ? (
                  <span className="font-semibold text-ink">
                    {r.onOrder.toFixed(1)} {r.unit} on order,{" "}
                  </span>
                ) : (
                  needsReorder(r.currentStock, r.reorderPoint) && (
                    <span className="font-semibold text-warn">order now, </span>
                  )
                )}
                {r.daysRemaining === null ? "no recent usage" : `~${r.daysRemaining.toFixed(1)} days left`} (
                {r.currentStock.toFixed(1)} {r.unit}
                {needsReorder(r.currentStock, r.reorderPoint) &&
                  `, reorder point ${r.reorderPoint!.toFixed(1)}, ${r.leadTimeDays}-day lead time`}
                )
              </li>
            ))}
          </ul>
        </div>
      )}

      {costs && <CostsCard costs={costs} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-5">
          <p className="mb-3 text-sm font-semibold text-muted">Top sellers (7 days)</p>
          <ul className="flex flex-col gap-2">
            {data.topSellers.map((s) => (
              <li key={s.menuItemName} className="flex justify-between text-sm">
                <span className="text-ink">{s.menuItemName}</span>
                <span className="text-muted">{s.unitsSold} sold</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-5">
          <p className="mb-3 text-sm font-semibold text-muted">Slowest sellers (7 days)</p>
          <ul className="flex flex-col gap-2">
            {data.bottomSellers.map((s) => (
              <li key={s.menuItemName} className="flex justify-between text-sm">
                <span className="text-ink">{s.menuItemName}</span>
                <span className="text-muted">{s.unitsSold} sold</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="font-display mt-1 text-xl font-semibold text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}
