"use client";

import { useState } from "react";
import { formatCostCents, roundCost } from "@/lib/costs";
import { CAFE_TIMEZONE } from "@/lib/time";
import type { PurchaseOrder } from "@/lib/types";

interface Ingredient {
  id: number;
  name: string;
  unit: string;
}

/** Quantities and total prices are kept as typed text until saved. */
interface DraftLine {
  inventoryItemId: string;
  quantity: string;
  total: string;
}

interface ReceiveDraft {
  quantity: string;
  total: string;
  note: string;
}

const EMPTY_LINE: DraftLine = { inventoryItemId: "", quantity: "", total: "" };

function formatQty(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: CAFE_TIMEZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Unit cost in cents from a total price in dollars, or null if not given. */
function unitCostFrom(total: string, quantity: number): number | null {
  if (total.trim() === "" || quantity <= 0) return null;
  const dollars = Number(total);
  return Number.isFinite(dollars) && dollars >= 0 ? roundCost((dollars * 100) / quantity) : null;
}

function orderTotalCents(order: PurchaseOrder): number | null {
  let total = 0;
  for (const l of order.lines) {
    const qty = order.status === "received" ? (l.quantityReceived ?? 0) : l.quantityOrdered;
    if (qty === 0) continue;
    if (l.unitCostCents === null) return null;
    total += qty * l.unitCostCents;
  }
  return total;
}

export default function PurchasingManager({
  initialOrders,
  ingredients,
  reorderIds,
}: {
  initialOrders: PurchaseOrder[];
  ingredients: Ingredient[];
  /** Ingredients at their reorder point and not already on an open order. */
  reorderIds: number[];
}) {
  const [orders, setOrders] = useState(initialOrders);
  const [supplier, setSupplier] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([EMPTY_LINE]);
  const [receiving, setReceiving] = useState<{ orderId: number; drafts: Record<number, ReceiveDraft> } | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const openOrders = orders.filter((o) => o.status === "open");
  const pastOrders = orders.filter((o) => o.status !== "open");
  // Skip anything already on this draft or on an open order, including one
  // placed since the page loaded.
  const toReorder = reorderIds.filter(
    (id) =>
      !lines.some((l) => l.inventoryItemId === String(id)) &&
      !openOrders.some((o) => o.lines.some((l) => l.inventoryItemId === id))
  );

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function addReorderLines() {
    setLines((prev) => [
      ...prev.filter((l) => l.inventoryItemId !== ""),
      ...toReorder.map((id) => ({ ...EMPTY_LINE, inventoryItemId: String(id) })),
    ]);
  }

  function replaceOrder(order: PurchaseOrder) {
    setOrders((prev) => [order, ...prev.filter((o) => o.id !== order.id)]);
  }

  async function post(url: string, body: unknown): Promise<PurchaseOrder | null> {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not save.");
        return null;
      }
      return data.order as PurchaseOrder;
    } catch {
      setError("Could not save. Check the connection and try again.");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function createOrder() {
    const filled = lines.filter((l) => l.inventoryItemId !== "");
    if (supplier.trim() === "") return setError("Enter the supplier.");
    if (filled.length === 0) return setError("Add at least one ingredient.");
    const payload = filled.map((l) => {
      const quantity = Number(l.quantity);
      return { inventoryItemId: Number(l.inventoryItemId), quantity, unitCostCents: unitCostFrom(l.total, quantity) };
    });
    const bad = payload.find((l) => !Number.isFinite(l.quantity) || l.quantity <= 0);
    if (bad) return setError(`Enter a quantity for ${byId.get(bad.inventoryItemId)?.name ?? "each line"}.`);

    const order = await post("/api/purchase-orders", { supplier, note, lines: payload });
    if (!order) return;
    replaceOrder(order);
    setSupplier("");
    setNote("");
    setLines([EMPTY_LINE]);
  }

  function startReceiving(order: PurchaseOrder) {
    setError(null);
    setConfirmCancelId(null);
    setReceiving({
      orderId: order.id,
      drafts: Object.fromEntries(
        order.lines.map((l) => [
          l.id,
          {
            quantity: String(l.quantityOrdered),
            total: l.unitCostCents === null ? "" : ((l.unitCostCents * l.quantityOrdered) / 100).toFixed(2),
            note: "",
          },
        ])
      ),
    });
  }

  async function receive(order: PurchaseOrder) {
    if (!receiving) return;
    const payload = order.lines.map((l) => {
      const d = receiving.drafts[l.id];
      const quantityReceived = d.quantity.trim() === "" ? NaN : Number(d.quantity);
      return {
        lineId: l.id,
        quantityReceived,
        unitCostCents: unitCostFrom(d.total, quantityReceived),
        note: d.note,
      };
    });
    const badIndex = payload.findIndex((p) => !Number.isFinite(p.quantityReceived) || p.quantityReceived < 0);
    if (badIndex >= 0) {
      return setError(`Enter how much ${order.lines[badIndex].inventoryItemName} arrived (0 if none).`);
    }

    const updated = await post(`/api/purchase-orders/${order.id}/receive`, { lines: payload });
    if (!updated) return;
    replaceOrder(updated);
    setReceiving(null);
  }

  async function cancel(order: PurchaseOrder) {
    const updated = await post(`/api/purchase-orders/${order.id}/cancel`, {});
    if (!updated) return;
    replaceOrder(updated);
    setConfirmCancelId(null);
  }

  const inputClass = "rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink";

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p role="alert" className="text-sm font-medium text-warn">
          {error}
        </p>
      )}

      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="mb-1 text-sm font-semibold text-muted">New purchase order</h2>
        <p className="mb-4 text-xs text-muted">
          Nothing is added to stock until the order is received, and then only what actually arrived.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Supplier
            <input value={supplier} maxLength={80} onChange={(e) => setSupplier(e.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Note (optional)
            <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} className={inputClass} />
          </label>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          {lines.map((line, index) => {
            const unit = byId.get(Number(line.inventoryItemId))?.unit;
            return (
              <div key={index} className="grid grid-cols-2 gap-2 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
                <label className="col-span-2 flex flex-col gap-1 text-xs text-muted sm:col-span-1">
                  Ingredient
                  <select
                    value={line.inventoryItemId}
                    onChange={(e) => updateLine(index, { inventoryItemId: e.target.value })}
                    className={inputClass}
                  >
                    <option value="">Choose…</option>
                    {ingredients.map((i) => (
                      <option
                        key={i.id}
                        value={i.id}
                        disabled={lines.some((l, j) => j !== index && l.inventoryItemId === String(i.id))}
                      >
                        {i.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Quantity{unit && ` (${unit})`}
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={line.quantity}
                    onChange={(e) => updateLine(index, { quantity: e.target.value })}
                    className={inputClass}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">
                  Total price ($, optional)
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={line.total}
                    onChange={(e) => updateLine(index, { total: e.target.value })}
                    className={inputClass}
                  />
                </label>
                <button
                  onClick={() => setLines((prev) => (prev.length === 1 ? [EMPTY_LINE] : prev.filter((_, j) => j !== index)))}
                  className="col-span-2 rounded-lg px-3 py-2 text-sm text-muted hover:text-ink sm:col-span-1"
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => setLines((prev) => [...prev, EMPTY_LINE])}
            className="rounded-lg border border-line px-3 py-2 text-sm text-ink"
          >
            Add ingredient
          </button>
          {toReorder.length > 0 && (
            <button onClick={addReorderLines} className="rounded-lg border border-warn px-3 py-2 text-sm text-warn">
              Add {toReorder.length} at reorder point
            </button>
          )}
          <button
            onClick={createOrder}
            disabled={saving}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {saving ? "Saving..." : "Place order"}
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold text-ink">Waiting for delivery</h2>
        {openOrders.length === 0 && <p className="text-sm text-muted">No open orders.</p>}
        {openOrders.map((order) => {
          const draft = receiving?.orderId === order.id ? receiving.drafts : null;
          const total = orderTotalCents(order);
          return (
            <div key={order.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-ink">{order.supplier}</p>
                <p className="text-xs text-muted">
                  Ordered {formatWhen(order.createdAt)}
                  {order.createdBy && ` by ${order.createdBy}`}
                  {total !== null && ` · ${formatCostCents(total)}`}
                </p>
              </div>
              {order.note && <p className="mt-1 text-sm text-muted">{order.note}</p>}

              <ul className="mt-3 flex flex-col gap-2">
                {draft && (
                  <li aria-hidden className="hidden text-xs text-muted sm:flex sm:justify-end">
                    <span className="grid grid-cols-3 gap-2 sm:w-[28rem]">
                      <span>Received</span>
                      <span>Total paid ($)</span>
                      <span>Note</span>
                    </span>
                  </li>
                )}
                {order.lines.map((l) => (
                  <li key={l.id} className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-ink">
                      {l.inventoryItemName}: {formatQty(l.quantityOrdered)} {l.unit}
                      {l.unitCostCents !== null && (
                        <span className="text-muted"> · {formatCostCents(l.unitCostCents * l.quantityOrdered)}</span>
                      )}
                    </span>
                    {draft && (
                      <span className="grid grid-cols-3 gap-2 sm:w-[28rem]">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          aria-label={`${l.inventoryItemName} received (${l.unit})`}
                          title={`Received (${l.unit})`}
                          value={draft[l.id].quantity}
                          onChange={(e) =>
                            setReceiving((r) => r && { ...r, drafts: { ...r.drafts, [l.id]: { ...r.drafts[l.id], quantity: e.target.value } } })
                          }
                          className={inputClass}
                        />
                        <input
                          type="number"
                          min={0}
                          step="any"
                          placeholder="Paid $"
                          aria-label={`${l.inventoryItemName} total paid ($)`}
                          value={draft[l.id].total}
                          onChange={(e) =>
                            setReceiving((r) => r && { ...r, drafts: { ...r.drafts, [l.id]: { ...r.drafts[l.id], total: e.target.value } } })
                          }
                          className={inputClass}
                        />
                        <input
                          placeholder="Note"
                          maxLength={200}
                          aria-label={`${l.inventoryItemName} note`}
                          value={draft[l.id].note}
                          onChange={(e) =>
                            setReceiving((r) => r && { ...r, drafts: { ...r.drafts, [l.id]: { ...r.drafts[l.id], note: e.target.value } } })
                          }
                          className={inputClass}
                        />
                      </span>
                    )}
                  </li>
                ))}
              </ul>

              {draft ? (
                <div className="mt-3 flex flex-col gap-2">
                  <p className="text-xs text-muted">
                    Enter what actually arrived (0 if an item didn&apos;t come) and what you paid in total. Prices paid
                    become each ingredient&apos;s cost from now on.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => receive(order)}
                      disabled={saving}
                      className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                    >
                      {saving ? "Saving..." : "Receive and add to stock"}
                    </button>
                    <button onClick={() => setReceiving(null)} className="rounded-lg px-3 py-2 text-sm text-muted hover:text-ink">
                      Back
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => startReceiving(order)} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">
                    Receive delivery
                  </button>
                  {confirmCancelId === order.id ? (
                    <>
                      <button
                        onClick={() => cancel(order)}
                        disabled={saving}
                        className="rounded-lg border border-warn px-3 py-2 text-sm font-medium text-warn disabled:opacity-40"
                      >
                        Yes, cancel this order
                      </button>
                      <button onClick={() => setConfirmCancelId(null)} className="rounded-lg px-3 py-2 text-sm text-muted hover:text-ink">
                        Keep it
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmCancelId(order.id)}
                      className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink"
                    >
                      Cancel order
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-muted">Past orders</h2>
        {pastOrders.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {pastOrders.map((order) => {
              const total = orderTotalCents(order);
              return (
                <li key={order.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-ink">
                      {order.supplier}{" "}
                      <span className={`text-xs font-semibold ${order.status === "cancelled" ? "text-muted" : "text-good"}`}>
                        {order.status === "cancelled" ? "Cancelled" : "Received"}
                      </span>
                    </span>
                    <span className="text-xs text-muted">
                      {order.closedAt && formatWhen(order.closedAt)}
                      {order.closedBy && ` · ${order.closedBy}`}
                      {order.status === "received" && total !== null && ` · ${formatCostCents(total)}`}
                    </span>
                  </div>
                  <ul className="mt-1 flex flex-col gap-0.5 text-xs text-muted">
                    {order.lines.map((l) => {
                      const short =
                        l.quantityReceived !== null && l.quantityReceived < l.quantityOrdered
                          ? l.quantityOrdered - l.quantityReceived
                          : 0;
                      return (
                        <li key={l.id}>
                          {l.inventoryItemName}: {order.status === "received" ? `${formatQty(l.quantityReceived ?? 0)} of ` : ""}
                          {formatQty(l.quantityOrdered)} {l.unit}
                          {short > 0 && <span className="text-warn"> · {formatQty(short)} short</span>}
                          {l.receiveNote && ` · ${l.receiveNote}`}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
