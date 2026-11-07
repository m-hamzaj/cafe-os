"use client";

import { useState } from "react";
import { COUNT_REASONS, WASTE_REASONS } from "@/lib/stock-reasons";
import { CAFE_TIMEZONE } from "@/lib/time";
import type { InventoryActivity, InventoryItem, StockAdjustment } from "@/lib/types";

type Panel = { itemId: number; kind: "waste" | "count" } | null;

const EMPTY_FORM = { amount: "", reason: "", note: "" };

function formatQty(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatSigned(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatQty(Math.abs(n))}`;
}

function formatWhen(iso: string): string {
  // Fixed timezone so the server render and the browser agree.
  return new Date(iso).toLocaleString("en-US", {
    timeZone: CAFE_TIMEZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function countedLabel(days: number | null): string {
  if (days === null) return "Never counted";
  if (days === 0) return "Counted today";
  if (days === 1) return "Counted yesterday";
  return `Counted ${days} days ago`;
}

export default function InventoryManager({
  initialItems,
  initialActivity,
  initialAdjustments,
  lookbackDays,
}: {
  initialItems: InventoryItem[];
  initialActivity: Record<number, InventoryActivity>;
  initialAdjustments: StockAdjustment[];
  lookbackDays: number;
}) {
  const [items, setItems] = useState(initialItems);
  const [activity, setActivity] = useState(initialActivity);
  const [adjustments, setAdjustments] = useState(initialAdjustments);
  const [restockAmount, setRestockAmount] = useState<Record<number, string>>({});
  const [newItem, setNewItem] = useState({ name: "", unit: "", threshold: "" });
  const [panel, setPanel] = useState<Panel>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restock(item: InventoryItem) {
    const amount = Number(restockAmount[item.id]);
    if (!amount || amount <= 0) return;
    setError(null);
    const res = await fetch("/api/inventory/restock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inventoryItemId: item.id, quantityAdded: amount }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not restock.");
      return;
    }
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, currentStock: i.currentStock + amount } : i)));
    setRestockAmount((prev) => ({ ...prev, [item.id]: "" }));
  }

  async function addItem() {
    setError(null);
    const res = await fetch("/api/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newItem.name,
        unit: newItem.unit,
        lowStockThreshold: Number(newItem.threshold) || 0,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not add ingredient.");
      return;
    }
    const body = await res.json();
    setItems((prev) => [...prev, body.item]);
    setActivity((prev) => ({ ...prev, [body.item.id]: { wasted: 0, countVariance: 0, daysSinceCount: null } }));
    setNewItem({ name: "", unit: "", threshold: "" });
  }

  function openPanel(itemId: number, kind: "waste" | "count") {
    setError(null);
    setForm(EMPTY_FORM);
    setPanel(panel?.itemId === itemId && panel.kind === kind ? null : { itemId, kind });
  }

  async function saveAdjustment(item: InventoryItem, kind: "waste" | "count") {
    if (form.amount.trim() === "") {
      setError(kind === "waste" ? "Enter how much was wasted." : "Enter what's on the shelf.");
      return;
    }
    const amount = Number(form.amount);
    const payload =
      kind === "waste"
        ? { kind, inventoryItemId: item.id, quantity: amount, reason: form.reason || undefined, note: form.note }
        : { kind, inventoryItemId: item.id, countedStock: amount, reason: form.reason || undefined, note: form.note };

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not save.");
        return;
      }
      setItems((prev) => prev.map((i) => (i.id === body.item.id ? body.item : i)));
      setAdjustments((prev) => [body.adjustment, ...prev]);
      setActivity(body.activity);
      setPanel(null);
      setForm(EMPTY_FORM);
    } catch {
      setError("Could not save. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm font-medium text-warn">{error}</p>}

      <div className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-muted">Add ingredient</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <input
            placeholder="Name (e.g. Oat milk)"
            value={newItem.name}
            onChange={(e) => setNewItem((p) => ({ ...p, name: e.target.value }))}
            className="rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink sm:col-span-2"
          />
          <input
            placeholder="Unit (e.g. ml)"
            value={newItem.unit}
            onChange={(e) => setNewItem((p) => ({ ...p, unit: e.target.value }))}
            className="rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink"
          />
          <input
            placeholder="Low-stock at"
            value={newItem.threshold}
            onChange={(e) => setNewItem((p) => ({ ...p, threshold: e.target.value }))}
            className="rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink"
          />
        </div>
        <button onClick={addItem} className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">
          Add
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {items.map((item) => {
          const low = item.currentStock <= item.lowStockThreshold;
          const stats = activity[item.id] ?? { wasted: 0, countVariance: 0, daysSinceCount: null };
          const open = panel?.itemId === item.id ? panel.kind : null;
          const counted = open === "count" && form.amount.trim() !== "" ? Number(form.amount) : null;
          const difference = counted === null || Number.isNaN(counted) ? null : counted - item.currentStock;
          const showCountReason = difference !== null && Math.abs(difference) > 1e-9;

          return (
            <div
              key={item.id}
              className={`rounded-2xl border px-4 py-3 ${low ? "border-warn bg-warn/5" : "border-line bg-surface"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-ink">
                    {item.name} {low && <span className="ml-2 text-xs font-semibold text-warn">Low stock</span>}
                  </p>
                  <p className="text-sm text-muted">
                    {formatQty(item.currentStock)} {item.unit} on hand · alert below {formatQty(item.lowStockThreshold)}{" "}
                    {item.unit}
                  </p>
                  <p className="text-xs text-muted">
                    {countedLabel(stats.daysSinceCount)}
                    {stats.wasted > 0 && ` · ${formatQty(stats.wasted)} ${item.unit} wasted`}
                    {stats.countVariance !== 0 && (
                      <span className={stats.countVariance < 0 ? "text-warn" : undefined}>
                        {` · counts ${formatSigned(stats.countVariance)} ${item.unit}`}
                      </span>
                    )}
                    {(stats.wasted > 0 || stats.countVariance !== 0) && ` (${lookbackDays} days)`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    step="any"
                    placeholder="Add"
                    aria-label={`Restock amount for ${item.name}`}
                    value={restockAmount[item.id] ?? ""}
                    onChange={(e) => setRestockAmount((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    className="w-20 rounded-lg border border-line bg-bg px-2 py-1 text-right text-sm text-ink"
                  />
                  <button onClick={() => restock(item)} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white">
                    Restock
                  </button>
                  <button
                    onClick={() => openPanel(item.id, "waste")}
                    aria-expanded={open === "waste"}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                      open === "waste" ? "border-brand bg-brand/10 text-brand" : "border-line text-ink"
                    }`}
                  >
                    Waste
                  </button>
                  <button
                    onClick={() => openPanel(item.id, "count")}
                    aria-expanded={open === "count"}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                      open === "count" ? "border-brand bg-brand/10 text-brand" : "border-line text-ink"
                    }`}
                  >
                    Count
                  </button>
                </div>
              </div>

              {open && (
                <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <label className="flex flex-col gap-1 text-xs text-muted">
                      {open === "waste" ? `Amount wasted (${item.unit})` : `On the shelf (${item.unit})`}
                      <input
                        type="number"
                        min={0}
                        step="any"
                        autoFocus
                        value={form.amount}
                        onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                        className="rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink"
                      />
                    </label>
                    {(open === "waste" || showCountReason) && (
                      <label className="flex flex-col gap-1 text-xs text-muted">
                        {open === "waste" ? "Reason" : "Why it's different"}
                        <select
                          value={form.reason}
                          onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                          className="rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink"
                        >
                          <option value="">Choose…</option>
                          {(open === "waste" ? WASTE_REASONS : COUNT_REASONS).map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="flex flex-col gap-1 text-xs text-muted">
                      Note (optional)
                      <input
                        maxLength={200}
                        value={form.note}
                        onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                        className="rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink"
                      />
                    </label>
                  </div>
                  {open === "count" && (
                    <p className="text-sm text-muted">
                      System expects {formatQty(item.currentStock)} {item.unit}.
                      {difference !== null &&
                        (showCountReason ? (
                          <span className={difference < 0 ? "text-warn" : "text-ink"}>
                            {" "}
                            Difference: {formatSigned(difference)} {item.unit}. Stock will be set to what you counted.
                          </span>
                        ) : (
                          <span className="text-good"> Matches.</span>
                        ))}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveAdjustment(item, open)}
                      disabled={saving}
                      className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                    >
                      {saving ? "Saving..." : open === "waste" ? "Log waste" : "Save count"}
                    </button>
                    <button onClick={() => setPanel(null)} className="rounded-lg px-3 py-2 text-sm text-muted hover:text-ink">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="mb-1 text-sm font-semibold text-muted">Waste and count log</h2>
        <p className="mb-3 text-xs text-muted">The most recent 30 entries. Counts keep what the system expected.</p>
        {adjustments.length === 0 ? (
          <p className="text-sm text-muted">Nothing logged yet. Use Waste or Count on an ingredient above.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {adjustments.slice(0, 30).map((a) => (
              <li key={a.id} className="flex flex-col gap-0.5 py-2 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <span className="font-medium text-ink">{a.inventoryItemName}</span>{" "}
                  {a.kind === "waste" ? (
                    <span className="text-ink">
                      wasted {formatQty(-a.quantityChange)} {a.unit}
                    </span>
                  ) : (
                    <span className="text-ink">
                      counted {formatQty(a.countedStock ?? 0)} {a.unit}, system had {formatQty(a.expectedStock)}{" "}
                      {a.quantityChange === 0 ? (
                        <span className="text-good">(matched)</span>
                      ) : (
                        <span className={a.quantityChange < 0 ? "text-warn" : undefined}>
                          ({formatSigned(a.quantityChange)} {a.unit})
                        </span>
                      )}
                    </span>
                  )}
                  {a.reason && <span className="text-muted"> · {a.reason}</span>}
                  {a.note && <span className="text-muted"> · {a.note}</span>}
                </div>
                <span className="shrink-0 text-xs text-muted">
                  {formatWhen(a.createdAt)}
                  {a.staffName && ` · ${a.staffName}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
