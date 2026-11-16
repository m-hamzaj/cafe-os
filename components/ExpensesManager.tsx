"use client";

import { useState } from "react";
import { formatCostCents } from "@/lib/costs";
import type { Expense, ExpenseFrequency } from "@/lib/types";

const FREQUENCY_LABEL: Record<ExpenseFrequency, string> = {
  once: "One-off",
  weekly: "Every week",
  monthly: "Every month",
};

const EMPTY_FORM = { name: "", amount: "", frequency: "monthly" as ExpenseFrequency, startsOn: "" };

function formatDate(ymd: string): string {
  // Dates are plain calendar days, so format them in UTC to avoid shifting.
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function ExpensesManager({
  initialExpenses,
  today,
  days,
}: {
  initialExpenses: Expense[];
  /** The cafe's date today, YYYY-MM-DD. */
  today: string;
  /** How many days the dashboard's cost summary covers. */
  days: number;
}) {
  const [expenses, setExpenses] = useState(initialExpenses);
  const [form, setForm] = useState({ ...EMPTY_FORM, startsOn: today });
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rangeTotal = expenses.reduce((sum, e) => sum + e.rangeCents, 0);
  const running = expenses.filter((e) => e.running);
  const past = expenses.filter((e) => !e.running);

  async function send(url: string, method: string, body?: unknown): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not save.");
        return false;
      }
      setExpenses(data.expenses);
      return true;
    } catch {
      setError("Could not save. Check the connection and try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function add() {
    const dollars = Number(form.amount);
    if (form.name.trim() === "") return setError("Enter what the expense is for.");
    if (form.amount.trim() === "" || !Number.isFinite(dollars) || dollars <= 0) {
      return setError("Enter the amount in dollars.");
    }
    if (form.startsOn === "") return setError("Choose a date.");
    const ok = await send("/api/expenses", "POST", {
      name: form.name,
      amountCents: Math.round(dollars * 100),
      frequency: form.frequency,
      startsOn: form.startsOn,
    });
    if (ok) setForm({ ...EMPTY_FORM, frequency: form.frequency, startsOn: today });
  }

  const inputClass = "rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink";

  function row(e: Expense) {
    return (
      <li key={e.id} className="flex flex-col gap-2 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-ink">
            <span className="font-medium">{e.name}</span> · {formatCostCents(e.amountCents)}{" "}
            <span className="text-muted">{FREQUENCY_LABEL[e.frequency].toLowerCase()}</span>
          </p>
          <p className="text-xs text-muted">
            {e.frequency === "once"
              ? `Paid ${formatDate(e.startsOn)}`
              : `From ${formatDate(e.startsOn)}${e.endsOn ? ` to ${formatDate(e.endsOn)}` : ""}`}
            {` · ${formatCostCents(e.rangeCents)} in the last ${days} days`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {confirmDeleteId === e.id ? (
            <>
              <button
                onClick={async () => {
                  if (await send(`/api/expenses/${e.id}`, "DELETE")) setConfirmDeleteId(null);
                }}
                disabled={saving}
                className="rounded-lg border border-warn px-3 py-1.5 text-sm font-medium text-warn disabled:opacity-40"
              >
                Yes, delete it
              </button>
              <button onClick={() => setConfirmDeleteId(null)} className="rounded-lg px-3 py-1.5 text-sm text-muted hover:text-ink">
                Keep it
              </button>
            </>
          ) : (
            <>
              {e.running && (
                <button
                  onClick={() => send(`/api/expenses/${e.id}/stop`, "POST")}
                  disabled={saving}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink disabled:opacity-40"
                >
                  Stop after today
                </button>
              )}
              <button
                onClick={() => setConfirmDeleteId(e.id)}
                className="rounded-lg px-3 py-1.5 text-sm text-muted hover:text-ink"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </li>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p role="alert" className="text-sm font-medium text-warn">
          {error}
        </p>
      )}

      <section className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="mb-1 text-sm font-semibold text-muted">Add an expense</h2>
        <p className="mb-4 text-xs text-muted">
          Running costs that aren&apos;t ingredients, like rent, wages and bills. Weekly and monthly ones are spread
          over the days they cover, so the dashboard&apos;s net profit gets a fair share each week.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">
            What for
            <input
              value={form.name}
              maxLength={80}
              placeholder="e.g. Rent"
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Amount ($)
            <input
              type="number"
              min={0}
              step="any"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            How often
            <select
              value={form.frequency}
              onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as ExpenseFrequency }))}
              className={inputClass}
            >
              {(Object.keys(FREQUENCY_LABEL) as ExpenseFrequency[]).map((k) => (
                <option key={k} value={k}>
                  {FREQUENCY_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted sm:col-span-2">
            {form.frequency === "once" ? "Paid on" : "Starting"}
            <input
              type="date"
              value={form.startsOn}
              onChange={(e) => setForm((f) => ({ ...f, startsOn: e.target.value }))}
              className={inputClass}
            />
          </label>
        </div>
        <button
          onClick={add}
          disabled={saving}
          className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {saving ? "Saving..." : "Add expense"}
        </button>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-muted">Running</h2>
          <p className="text-sm text-ink">
            {formatCostCents(rangeTotal)} <span className="text-muted">in the last {days} days, all expenses</span>
          </p>
        </div>
        {running.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No weekly or monthly expenses yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">{running.map(row)}</ul>
        )}
      </section>

      {past.length > 0 && (
        <section className="rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold text-muted">One-off and stopped</h2>
          <ul className="flex flex-col divide-y divide-line">{past.map(row)}</ul>
        </section>
      )}
    </div>
  );
}
