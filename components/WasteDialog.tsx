"use client";

import { useEffect, useRef, useState } from "react";
import { WASTE_REASONS } from "@/lib/stock-reasons";

interface Ingredient {
  id: number;
  name: string;
  unit: string;
}

const EMPTY_FORM = { itemId: "", amount: "", reason: "", note: "" };

/** Lets anyone at the counter log waste (a spill, a remake, expired milk)
 * without leaving the order screen. Stays open after saving so several
 * entries can be logged in a row. */
export default function WasteDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [ingredients, setIngredients] = useState<Ingredient[] | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logged, setLogged] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
    let active = true;
    fetch("/api/inventory")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((body: { items: Ingredient[] }) => {
        if (active) setIngredients(body.items);
      })
      .catch(() => {
        if (active) setError("Couldn't load the ingredient list. Close this and try again.");
      });
    return () => {
      active = false;
    };
  }, []);

  const selected = ingredients?.find((i) => String(i.id) === form.itemId);

  async function save() {
    if (!selected) return setError("Choose what was wasted.");
    if (form.amount.trim() === "") return setError("Enter how much was wasted.");
    setSaving(true);
    setError(null);
    setLogged(null);
    try {
      const res = await fetch("/api/inventory/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "waste",
          inventoryItemId: selected.id,
          quantity: Number(form.amount),
          reason: form.reason || undefined,
          note: form.note,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Couldn't log the waste.");
        return;
      }
      setLogged(`Logged ${form.amount} ${selected.unit} of ${selected.name} (${form.reason.toLowerCase()}).`);
      setForm(EMPTY_FORM);
    } catch {
      setError("Couldn't log the waste. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const fieldClass = "min-h-12 rounded-xl border border-line bg-bg px-3 py-2 text-base text-ink";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="waste-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className="m-auto max-h-[85vh] w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-4 p-5">
        <h2 id="waste-dialog-title" className="font-display text-xl font-semibold text-ink">
          Log waste
        </h2>

        <label className="flex flex-col gap-1 text-sm text-muted">
          What was wasted
          <select
            value={form.itemId}
            disabled={!ingredients}
            onChange={(e) => setForm((f) => ({ ...f, itemId: e.target.value }))}
            className={fieldClass}
          >
            <option value="">{ingredients ? "Choose…" : "Loading…"}</option>
            {ingredients?.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm text-muted">
            Amount{selected && ` (${selected.unit})`}
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            Reason
            <select
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              className={fieldClass}
            >
              <option value="">Choose…</option>
              {WASTE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm text-muted">
          Note (optional)
          <input
            maxLength={200}
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            className={fieldClass}
          />
        </label>

        {error && (
          <p role="alert" className="text-sm font-medium text-warn">
            {error}
          </p>
        )}
        {logged && (
          <p role="status" className="text-sm font-medium text-good">
            {logged}
          </p>
        )}

        <div className="grid grid-cols-[auto_1fr] gap-2">
          <button onClick={onClose} className="rounded-xl border border-line px-4 py-3 font-medium text-muted">
            {logged ? "Done" : "Cancel"}
          </button>
          <button
            onClick={save}
            disabled={saving || !ingredients}
            className="rounded-xl bg-accent py-3 font-medium text-accent-ink disabled:opacity-40"
          >
            {saving ? "Saving..." : "Log waste"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
