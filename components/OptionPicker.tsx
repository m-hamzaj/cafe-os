"use client";

import { useEffect, useRef, useState } from "react";
import type { MenuItemWithOptions, MenuOption, MenuOptionGroup } from "@/lib/types";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDelta(cents: number): string {
  if (cents === 0) return "";
  return `${cents > 0 ? "+" : "−"}${formatCents(Math.abs(cents))}`;
}

/**
 * What's actually chosen, given the options' current stock. Worked out on
 * every render rather than stored, because stock can change while the picker
 * is open: a chosen option that runs out drops away, and a required
 * single-choice group falls back to its first in-stock option.
 */
function effectiveSelection(item: MenuItemWithOptions, pickedIds: Set<number>): Set<number> {
  const effective = new Set<number>();
  for (const group of item.optionGroups) {
    const picked = group.options.filter((o) => o.isAvailable && pickedIds.has(o.id));
    for (const option of picked) effective.add(option.id);
    if (picked.length === 0 && group.isRequired && !group.allowsMultiple) {
      const fallback = group.options.find((o) => o.isAvailable);
      if (fallback) effective.add(fallback.id);
    }
  }
  return effective;
}

/**
 * Other menu items with this option whose stock status differs from the one
 * just set. Matches setOptionAvailability's rule: same option name in a group
 * of the same name, ignoring case.
 */
function otherItemsToSync(
  menu: MenuItemWithOptions[],
  item: MenuItemWithOptions,
  group: MenuOptionGroup,
  option: MenuOption,
  isAvailable: boolean
): string[] {
  return menu
    .filter(
      (other) =>
        other.id !== item.id &&
        other.optionGroups.some(
          (g) =>
            g.name.toLowerCase() === group.name.toLowerCase() &&
            g.options.some((o) => o.name.toLowerCase() === option.name.toLowerCase() && o.isAvailable !== isAvailable)
        )
    )
    .map((other) => other.name);
}

interface SyncOffer {
  option: MenuOption;
  isAvailable: boolean;
  itemNames: string[];
}

/**
 * Asks for an item's options before it goes in the cart. Required
 * single-choice groups start on their first in-stock option, so the most
 * common order stays a tap on Add. Out-of-stock options stay visible but
 * can't be chosen, so the cashier can tell the customer why.
 *
 * Marking something out of stock is a separate mode, so a mis-tap while
 * taking an order can't hide an option from the whole counter. A flip changes
 * this item only, then offers to do the same on other items with that option.
 */
export default function OptionPicker({
  item,
  menu,
  onAdd,
  onClose,
  onSetStock,
}: {
  item: MenuItemWithOptions;
  menu: MenuItemWithOptions[];
  onAdd: (selected: MenuOption[]) => void;
  onClose: () => void;
  onSetStock: (optionId: number, isAvailable: boolean, acrossMenu: boolean) => Promise<boolean>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pickedIds, setPickedIds] = useState<Set<number>>(() => new Set());
  const [managingStock, setManagingStock] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [stockError, setStockError] = useState<string | null>(null);
  const [syncOffer, setSyncOffer] = useState<SyncOffer | null>(null);
  const [syncDone, setSyncDone] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const selectedIds = effectiveSelection(item, pickedIds);

  function toggle(group: MenuOptionGroup, option: MenuOption) {
    if (!option.isAvailable) return;
    const next = new Set(selectedIds);
    const wasSelected = next.has(option.id);
    if (group.allowsMultiple) {
      if (wasSelected) next.delete(option.id);
      else next.add(option.id);
    } else if (!(wasSelected && group.isRequired)) {
      for (const o of group.options) next.delete(o.id);
      if (!wasSelected) next.add(option.id);
    }
    setPickedIds(next);
  }

  async function flipStock(group: MenuOptionGroup, option: MenuOption) {
    const isAvailable = !option.isAvailable;
    setSavingId(option.id);
    setStockError(null);
    setSyncOffer(null);
    setSyncDone(null);
    const saved = await onSetStock(option.id, isAvailable, false);
    setSavingId(null);
    if (!saved) {
      setStockError(`Couldn't update ${option.name}. Try again.`);
      return;
    }
    const itemNames = otherItemsToSync(menu, item, group, option, isAvailable);
    if (itemNames.length > 0) setSyncOffer({ option, isAvailable, itemNames });
  }

  async function applySyncOffer(offer: SyncOffer) {
    setSavingId(offer.option.id);
    setStockError(null);
    const saved = await onSetStock(offer.option.id, offer.isAvailable, true);
    setSavingId(null);
    if (!saved) {
      setStockError(`Couldn't update ${offer.option.name} on the other items. Try again.`);
      return;
    }
    setSyncOffer(null);
    setSyncDone(`${offer.option.name} is now ${offer.isAvailable ? "in stock" : "out of stock"} on all items.`);
  }

  const selected = item.optionGroups.flatMap((g) => g.options.filter((o) => selectedIds.has(o.id)));
  const unitPriceCents = Math.max(0, selected.reduce((sum, o) => sum + o.priceDeltaCents, item.priceCents));
  const missingGroup = item.optionGroups.find(
    (g) => g.isRequired && !g.options.some((o) => selectedIds.has(o.id))
  );
  const addLabel = !missingGroup
    ? `Add · ${formatCents(unitPriceCents)}`
    : missingGroup.options.some((o) => o.isAvailable)
      ? `Choose ${missingGroup.name}`
      : `${missingGroup.name} is out of stock`;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="option-picker-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className="m-auto max-h-[85vh] w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-5 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="option-picker-title" className="font-display text-xl font-semibold text-ink">
            {item.name}
          </h2>
          {!managingStock && (
            <button
              onClick={() => setManagingStock(true)}
              className="min-h-10 shrink-0 rounded-lg px-2 text-sm text-muted underline"
            >
              Stock
            </button>
          )}
        </div>

        {managingStock && (
          <p className="text-sm text-muted">Tap an option to change it on {item.name}.</p>
        )}

        {item.optionGroups.map((group) => (
          <fieldset key={group.id} className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-semibold text-muted">
              {group.name}
              {group.isRequired && !managingStock && <span className="font-normal"> · required</span>}
            </legend>
            {group.options.map((option) =>
              managingStock ? (
                <button
                  key={option.id}
                  role="switch"
                  aria-checked={option.isAvailable}
                  aria-label={`${option.name} in stock`}
                  disabled={savingId !== null}
                  onClick={() => flipStock(group, option)}
                  className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-left aria-checked:border-accent disabled:opacity-60"
                >
                  <span className="text-sm font-medium text-ink">{option.name}</span>
                  <span className={`text-sm font-medium ${option.isAvailable ? "text-good" : "text-warn"}`}>
                    {option.isAvailable ? "In stock" : "Out of stock"}
                  </span>
                </button>
              ) : (
                <label
                  key={option.id}
                  className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-line px-3 py-2 has-[:checked]:border-accent has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
                >
                  <input
                    type={group.allowsMultiple ? "checkbox" : "radio"}
                    name={`option-group-${group.id}`}
                    checked={selectedIds.has(option.id)}
                    disabled={!option.isAvailable}
                    readOnly
                    // onClick rather than onChange: a checked radio fires no
                    // change event, and tapping it again has to clear an
                    // optional single choice.
                    onClick={() => toggle(group, option)}
                    className="accent-accent"
                  />
                  <span className="flex-1 text-sm font-medium text-ink">{option.name}</span>
                  <span className="text-sm text-muted">
                    {option.isAvailable ? formatDelta(option.priceDeltaCents) : "Out of stock"}
                  </span>
                </label>
              )
            )}
          </fieldset>
        ))}

        {stockError && (
          <p role="alert" className="text-sm font-medium text-warn">
            {stockError}
          </p>
        )}

        {managingStock && syncOffer && (
          <div role="status" className="flex flex-col gap-3 rounded-xl border border-line p-3">
            <p className="text-sm text-ink">
              {syncOffer.option.name} is also on {new Intl.ListFormat("en").format(syncOffer.itemNames)}.
            </p>
            <button
              disabled={savingId !== null}
              onClick={() => applySyncOffer(syncOffer)}
              className="min-h-12 rounded-xl border border-accent px-3 py-2 text-sm font-medium text-accent disabled:opacity-60"
            >
              Mark {syncOffer.isAvailable ? "in stock" : "out of stock"} on{" "}
              {syncOffer.itemNames.length === 1 ? "that item" : "those items"} too
            </button>
          </div>
        )}

        {managingStock && syncDone && (
          <p role="status" className="text-sm font-medium text-good">
            {syncDone}
          </p>
        )}

        {managingStock ? (
          <button
            onClick={() => {
              setManagingStock(false);
              setStockError(null);
              setSyncOffer(null);
              setSyncDone(null);
            }}
            className="rounded-xl bg-accent py-3 font-medium text-accent-ink"
          >
            Done
          </button>
        ) : (
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <button onClick={onClose} className="rounded-xl border border-line px-4 py-3 font-medium text-muted">
              Cancel
            </button>
            <button
              onClick={() => onAdd(selected)}
              disabled={missingGroup !== undefined}
              className="rounded-xl bg-accent py-3 font-medium text-accent-ink disabled:opacity-40"
            >
              {addLabel}
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
}
