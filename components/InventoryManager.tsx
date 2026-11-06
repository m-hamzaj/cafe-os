"use client";

import { useState } from "react";

interface InventoryItem {
  id: number;
  name: string;
  unit: string;
  currentStock: number;
  lowStockThreshold: number;
}

export default function InventoryManager({ initialItems }: { initialItems: InventoryItem[] }) {
  const [items, setItems] = useState(initialItems);
  const [restockAmount, setRestockAmount] = useState<Record<number, string>>({});
  const [newItem, setNewItem] = useState({ name: "", unit: "", threshold: "" });
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
    setNewItem({ name: "", unit: "", threshold: "" });
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
          return (
            <div
              key={item.id}
              className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${
                low ? "border-warn bg-warn/5" : "border-line bg-surface"
              }`}
            >
              <div>
                <p className="text-ink">
                  {item.name} {low && <span className="ml-2 text-xs font-semibold text-warn">Low stock</span>}
                </p>
                <p className="text-sm text-muted">
                  {item.currentStock.toFixed(1)} {item.unit} on hand · alert below {item.lowStockThreshold} {item.unit}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step="any"
                  placeholder="Add"
                  value={restockAmount[item.id] ?? ""}
                  onChange={(e) => setRestockAmount((prev) => ({ ...prev, [item.id]: e.target.value }))}
                  className="w-20 rounded-lg border border-line bg-bg px-2 py-1 text-right text-sm text-ink"
                />
                <button onClick={() => restock(item)} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white">
                  Restock
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
