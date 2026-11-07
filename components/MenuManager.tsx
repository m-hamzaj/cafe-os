"use client";

import { useState } from "react";
import type { MenuOptionGroup } from "@/lib/types";
import { formatCostCents, ingredientCostCents } from "@/lib/costs";
import OptionGroupsEditor, {
  toDraftGroups,
  toOptionGroupInput,
  type DraftGroup,
} from "@/components/OptionGroupsEditor";

interface MenuItem {
  id: number;
  name: string;
  category: string;
  priceCents: number;
  isAvailable: boolean;
}

interface InventoryItem {
  id: number;
  name: string;
  unit: string;
  unitCostCents: number | null;
}

/** "cost $0.62 · 16% of price", or why it can't be shown. */
function costLabel(costCents: number | null | undefined, priceCents: number): string {
  if (costCents === null || costCents === undefined) return "cost unknown: an ingredient has no cost";
  if (priceCents <= 0) return `cost ${formatCostCents(costCents)}`;
  return `cost ${formatCostCents(costCents)} · ${Math.round((costCents / priceCents) * 100)}% of price`;
}

interface RecipeLine {
  inventoryItemId: number;
  quantityUsed: number;
}

function dollarsToCents(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function centsToDollars(c: number): string {
  return (c / 100).toFixed(2);
}

export default function MenuManager({
  initialMenuItems,
  inventoryItems,
  initialItemCosts,
}: {
  initialMenuItems: MenuItem[];
  inventoryItems: InventoryItem[];
  /** Base recipe cost per menu item at today's ingredient costs. */
  initialItemCosts: Record<number, number | null>;
}) {
  const [items, setItems] = useState(initialMenuItems);
  const [itemCosts, setItemCosts] = useState(initialItemCosts);
  const costById = new Map(inventoryItems.map((i) => [i.id, i.unitCostCents]));
  const recipeCost = (itemId: number) =>
    ingredientCostCents(
      (recipeByItem[itemId] ?? []).map((l) => [l.inventoryItemId, l.quantityUsed]),
      costById
    );
  const [editingId, setEditingId] = useState<number | null>(null);
  const [recipeByItem, setRecipeByItem] = useState<Record<number, RecipeLine[]>>({});
  const [optionsByItem, setOptionsByItem] = useState<Record<number, DraftGroup[]>>({});
  const [draft, setDraft] = useState<{ name: string; category: string; price: string; isAvailable: boolean }>({
    name: "",
    category: "",
    price: "",
    isAvailable: true,
  });
  const [newItem, setNewItem] = useState({ name: "", category: "", price: "" });
  const [error, setError] = useState<string | null>(null);

  async function startEdit(item: MenuItem) {
    setEditingId(item.id);
    setDraft({ name: item.name, category: item.category, price: centsToDollars(item.priceCents), isAvailable: item.isAvailable });
    // Always reload rather than reuse the last draft: new options only get
    // their ids from the server, and saving without those ids would re-create
    // them. Clearing first also keeps Save disabled until this load lands.
    setRecipeByItem((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    setOptionsByItem((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    const res = await fetch(`/api/menu/${item.id}`);
    const body: {
      recipe: Array<{ inventoryItemId: number; quantityUsed: number }>;
      optionGroups: MenuOptionGroup[];
    } = await res.json();
    setRecipeByItem((prev) => ({
      ...prev,
      [item.id]: body.recipe.map((r) => ({
        inventoryItemId: r.inventoryItemId,
        quantityUsed: r.quantityUsed,
      })),
    }));
    setOptionsByItem((prev) => ({ ...prev, [item.id]: toDraftGroups(body.optionGroups) }));
  }

  function updateRecipeLine(itemId: number, inventoryItemId: number, quantityUsed: number) {
    setRecipeByItem((prev) => {
      const lines = prev[itemId] ?? [];
      const existing = lines.find((l) => l.inventoryItemId === inventoryItemId);
      let next: RecipeLine[];
      if (quantityUsed <= 0) {
        next = lines.filter((l) => l.inventoryItemId !== inventoryItemId);
      } else if (existing) {
        next = lines.map((l) => (l.inventoryItemId === inventoryItemId ? { ...l, quantityUsed } : l));
      } else {
        next = [...lines, { inventoryItemId, quantityUsed }];
      }
      return { ...prev, [itemId]: next };
    });
  }

  async function saveEdit(itemId: number) {
    setError(null);
    const res = await fetch(`/api/menu/${itemId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draft.name,
        category: draft.category,
        priceCents: dollarsToCents(draft.price),
        isAvailable: draft.isAvailable,
        recipe: recipeByItem[itemId] ?? [],
        optionGroups: toOptionGroupInput(optionsByItem[itemId] ?? []),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not save.");
      return;
    }
    const body = await res.json();
    setItems((prev) => prev.map((i) => (i.id === itemId ? body.item : i)));
    setItemCosts((prev) => ({ ...prev, [itemId]: recipeCost(itemId) }));
    setEditingId(null);
  }

  async function addItem() {
    setError(null);
    const res = await fetch("/api/menu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newItem.name,
        category: newItem.category,
        priceCents: dollarsToCents(newItem.price),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not add item.");
      return;
    }
    const body = await res.json();
    setItems((prev) => [...prev, body.item]);
    setItemCosts((prev) => ({ ...prev, [body.item.id]: 0 }));
    setNewItem({ name: "", category: "", price: "" });
  }

  const byCategory = items.reduce<Record<string, MenuItem[]>>((acc, item) => {
    (acc[item.category] ??= []).push(item);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-8">
      {error && <p className="text-sm font-medium text-warn">{error}</p>}

      <div className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-muted">Add menu item</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <input
            placeholder="Name"
            value={newItem.name}
            onChange={(e) => setNewItem((p) => ({ ...p, name: e.target.value }))}
            className="rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink sm:col-span-2"
          />
          <input
            placeholder="Category"
            value={newItem.category}
            onChange={(e) => setNewItem((p) => ({ ...p, category: e.target.value }))}
            className="rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink"
          />
          <input
            placeholder="Price ($)"
            value={newItem.price}
            onChange={(e) => setNewItem((p) => ({ ...p, price: e.target.value }))}
            className="rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink"
          />
        </div>
        <button onClick={addItem} className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">
          Add
        </button>
      </div>

      {Object.entries(byCategory).map(([category, categoryItems]) => (
        <div key={category}>
          <h2 className="mb-3 font-display text-lg font-semibold text-ink">{category}</h2>
          <div className="flex flex-col gap-3">
            {categoryItems.map((item) =>
              editingId === item.id ? (
                <div key={item.id} className="rounded-2xl border border-brand bg-surface p-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                    <input
                      value={draft.name}
                      onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                      className="rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink sm:col-span-2"
                    />
                    <input
                      value={draft.category}
                      onChange={(e) => setDraft((p) => ({ ...p, category: e.target.value }))}
                      className="rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink"
                    />
                    <input
                      value={draft.price}
                      onChange={(e) => setDraft((p) => ({ ...p, price: e.target.value }))}
                      className="rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink"
                    />
                  </div>

                  <label className="mt-3 flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={draft.isAvailable}
                      onChange={(e) => setDraft((p) => ({ ...p, isAvailable: e.target.checked }))}
                    />
                    Available on the order screen
                  </label>

                  <div className="mt-4">
                    <p className="mb-2 text-sm font-semibold text-muted">
                      Recipe (what one order consumes)
                    </p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {inventoryItems.map((ing) => {
                        const line = (recipeByItem[item.id] ?? []).find((l) => l.inventoryItemId === ing.id);
                        return (
                          <div key={ing.id} className="flex items-center justify-between gap-2 text-sm">
                            <span className="text-ink">
                              {ing.name} <span className="text-muted">({ing.unit})</span>
                            </span>
                            <input
                              type="number"
                              min={0}
                              step="any"
                              value={line?.quantityUsed ?? ""}
                              onChange={(e) => updateRecipeLine(item.id, ing.id, Number(e.target.value))}
                              placeholder="0"
                              className="w-20 rounded-lg border border-line bg-bg px-2 py-1 text-right text-ink"
                            />
                          </div>
                        );
                      })}
                    </div>
                    {recipeByItem[item.id] && (
                      <p className="mt-2 text-sm text-muted">
                        Base recipe {costLabel(recipeCost(item.id), dollarsToCents(draft.price))}. Options can change it.
                      </p>
                    )}
                  </div>

                  {optionsByItem[item.id] && (
                    <OptionGroupsEditor
                      groups={optionsByItem[item.id]}
                      inventoryItems={inventoryItems}
                      onChange={(groups) => setOptionsByItem((prev) => ({ ...prev, [item.id]: groups }))}
                    />
                  )}

                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => saveEdit(item.id)}
                      disabled={!recipeByItem[item.id] || !optionsByItem[item.id]}
                      className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                    >
                      Save
                    </button>
                    <button onClick={() => setEditingId(null)} className="rounded-lg border border-line px-4 py-2 text-sm text-muted">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  key={item.id}
                  onClick={() => startEdit(item)}
                  className="flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3 text-left"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-ink">{item.name}</span>
                    {!item.isAvailable && (
                      <span className="rounded-full bg-line px-2 py-0.5 text-xs text-muted">Hidden</span>
                    )}
                  </span>
                  <span className="flex flex-col items-end text-right">
                    <span className="text-sm text-muted">{centsToDollars(item.priceCents)}</span>
                    <span className={`text-xs ${itemCosts[item.id] === null ? "text-warn" : "text-muted"}`}>
                      {costLabel(itemCosts[item.id], item.priceCents)}
                    </span>
                  </span>
                </button>
              )
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
