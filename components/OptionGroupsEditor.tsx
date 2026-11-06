"use client";

import type { MenuOptionGroup } from "@/lib/types";

interface InventoryChoice {
  id: number;
  name: string;
  unit: string;
}

interface DraftAdjustment {
  inventoryItemId: number;
  quantityDelta: string;
}

interface DraftOption {
  key: number;
  id?: number;
  name: string;
  price: string;
  isAvailable: boolean;
  // Stock status when the editor loaded, to tell whether the owner changed it.
  // Undefined for an option that hasn't been saved yet.
  savedIsAvailable?: boolean;
  adjustments: DraftAdjustment[];
}

export interface DraftGroup {
  key: number;
  id?: number;
  name: string;
  isRequired: boolean;
  allowsMultiple: boolean;
  options: DraftOption[];
}

let nextKey = 0;
function newKey(): number {
  nextKey += 1;
  return nextKey;
}

function newOption(): DraftOption {
  return { key: newKey(), name: "", price: "0.00", isAvailable: true, adjustments: [] };
}

export function toDraftGroups(groups: MenuOptionGroup[]): DraftGroup[] {
  return groups.map((g) => ({
    key: newKey(),
    id: g.id,
    name: g.name,
    isRequired: g.isRequired,
    allowsMultiple: g.allowsMultiple,
    options: g.options.map((o) => ({
      key: newKey(),
      id: o.id,
      name: o.name,
      price: (o.priceDeltaCents / 100).toFixed(2),
      isAvailable: o.isAvailable,
      savedIsAvailable: o.isAvailable,
      adjustments: o.adjustments.map((a) => ({
        inventoryItemId: a.inventoryItemId,
        quantityDelta: String(a.quantityDelta),
      })),
    })),
  }));
}

/** The body the API expects. Blank or zero ingredient rows are dropped. */
export function toOptionGroupInput(groups: DraftGroup[]) {
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    isRequired: g.isRequired,
    allowsMultiple: g.allowsMultiple,
    options: g.options.map((o) => {
      const dollars = Number(o.price);
      return {
        id: o.id,
        name: o.name,
        priceDeltaCents: Number.isFinite(dollars) ? Math.round(dollars * 100) : 0,
        // Only sent when changed: a cashier may have flipped it since this loaded.
        isAvailable: o.isAvailable === o.savedIsAvailable ? undefined : o.isAvailable,
        adjustments: o.adjustments
          .map((a) => ({ inventoryItemId: a.inventoryItemId, quantityDelta: Number(a.quantityDelta) }))
          .filter((a) => Number.isFinite(a.quantityDelta) && a.quantityDelta !== 0),
      };
    }),
  }));
}

const inputClass = "rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink";

export default function OptionGroupsEditor({
  groups,
  inventoryItems,
  onChange,
}: {
  groups: DraftGroup[];
  inventoryItems: InventoryChoice[];
  onChange: (groups: DraftGroup[]) => void;
}) {
  function updateGroup(key: number, patch: Partial<DraftGroup>) {
    onChange(groups.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  }

  function updateOption(group: DraftGroup, key: number, patch: Partial<DraftOption>) {
    updateGroup(group.key, {
      options: group.options.map((o) => (o.key === key ? { ...o, ...patch } : o)),
    });
  }

  return (
    <div className="mt-4">
      <p className="text-sm font-semibold text-muted">Options</p>
      <p className="mb-3 text-xs text-muted">
        Ingredient changes are per order, on top of the recipe. To swap an ingredient, use a minus for what comes out
        and a plus for what goes in.
      </p>

      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <div key={group.key} className="rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-center gap-3">
              <input
                aria-label="Option group name"
                placeholder="Group name, e.g. Milk"
                value={group.name}
                onChange={(e) => updateGroup(group.key, { name: e.target.value })}
                className={`${inputClass} min-w-0 flex-1 basis-40`}
              />
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={group.isRequired}
                  onChange={(e) => updateGroup(group.key, { isRequired: e.target.checked })}
                />
                Required
              </label>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={group.allowsMultiple}
                  onChange={(e) => updateGroup(group.key, { allowsMultiple: e.target.checked })}
                />
                Allow several
              </label>
              <button
                onClick={() => onChange(groups.filter((g) => g.key !== group.key))}
                className="text-sm text-muted underline"
              >
                Remove group
              </button>
            </div>

            <div className="mt-3 flex flex-col gap-3">
              {group.options.map((option) => {
                const usedIds = new Set(option.adjustments.map((a) => a.inventoryItemId));
                const unusedInventory = inventoryItems.filter((i) => !usedIds.has(i.id));
                return (
                  <div key={option.key} className="rounded-lg bg-bg p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        aria-label="Option name"
                        placeholder="Option name, e.g. Oat"
                        value={option.name}
                        onChange={(e) => updateOption(group, option.key, { name: e.target.value })}
                        className={`${inputClass} min-w-0 flex-1 basis-40`}
                      />
                      <label className="flex items-center gap-2 text-sm text-muted">
                        Price change ($)
                        <input
                          value={option.price}
                          inputMode="decimal"
                          onChange={(e) => updateOption(group, option.key, { price: e.target.value })}
                          className={`${inputClass} w-20 text-right`}
                        />
                      </label>
                      <label className="flex items-center gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          checked={option.isAvailable}
                          onChange={(e) => updateOption(group, option.key, { isAvailable: e.target.checked })}
                        />
                        In stock
                      </label>
                      <button
                        onClick={() =>
                          updateGroup(group.key, {
                            options: group.options.filter((o) => o.key !== option.key),
                          })
                        }
                        className="text-sm text-muted underline"
                      >
                        Remove
                      </button>
                    </div>

                    {option.adjustments.map((adjustment) => {
                      const ingredient = inventoryItems.find((i) => i.id === adjustment.inventoryItemId);
                      return (
                        <div
                          key={adjustment.inventoryItemId}
                          className="mt-2 flex items-center justify-between gap-2 text-sm"
                        >
                          <span className="text-ink">
                            {ingredient?.name ?? "Unknown ingredient"}{" "}
                            <span className="text-muted">({ingredient?.unit})</span>
                          </span>
                          <span className="flex items-center gap-2">
                            <input
                              aria-label={`Change in ${ingredient?.name ?? "ingredient"}`}
                              type="number"
                              step="any"
                              placeholder="0"
                              value={adjustment.quantityDelta}
                              onChange={(e) =>
                                updateOption(group, option.key, {
                                  adjustments: option.adjustments.map((a) =>
                                    a.inventoryItemId === adjustment.inventoryItemId
                                      ? { ...a, quantityDelta: e.target.value }
                                      : a
                                  ),
                                })
                              }
                              className="w-20 rounded-lg border border-line bg-surface px-2 py-1 text-right text-ink"
                            />
                            <button
                              aria-label={`Remove ${ingredient?.name ?? "ingredient"} change`}
                              onClick={() =>
                                updateOption(group, option.key, {
                                  adjustments: option.adjustments.filter(
                                    (a) => a.inventoryItemId !== adjustment.inventoryItemId
                                  ),
                                })
                              }
                              className="h-7 w-7 rounded-full border border-line text-muted"
                            >
                              ×
                            </button>
                          </span>
                        </div>
                      );
                    })}

                    {unusedInventory.length > 0 && (
                      <select
                        aria-label="Add an ingredient change"
                        value=""
                        onChange={(e) =>
                          updateOption(group, option.key, {
                            adjustments: [
                              ...option.adjustments,
                              { inventoryItemId: Number(e.target.value), quantityDelta: "" },
                            ],
                          })
                        }
                        className="mt-2 w-full rounded-lg border border-line bg-surface px-2 py-1 text-sm text-muted"
                      >
                        <option value="" disabled>
                          Add an ingredient change…
                        </option>
                        {unusedInventory.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name} ({i.unit})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              onClick={() => updateGroup(group.key, { options: [...group.options, newOption()] })}
              className="mt-3 rounded-lg border border-line px-3 py-1.5 text-sm text-ink"
            >
              Add option
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={() =>
          onChange([
            ...groups,
            { key: newKey(), name: "", isRequired: false, allowsMultiple: false, options: [newOption()] },
          ])
        }
        className="mt-3 rounded-lg border border-line px-3 py-1.5 text-sm text-ink"
      >
        Add option group
      </button>
    </div>
  );
}
