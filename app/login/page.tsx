"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface StaffSummary {
  id: number;
  name: string;
  role: "owner" | "cashier";
}

export default function LoginPage() {
  const router = useRouter();
  const [staff, setStaff] = useState<StaffSummary[]>([]);
  const [selected, setSelected] = useState<StaffSummary | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/auth/staff")
      .then((r) => r.json())
      .then((data) => setStaff(data.staff ?? []));
  }, []);

  function pressDigit(d: string) {
    setError(null);
    setPin((p) => (p.length < 8 ? p + d : p));
  }

  async function submit() {
    if (!selected || pin.length < 4) return;
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staffId: selected.id, pin }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Incorrect PIN.");
      setPin("");
      return;
    }
    const body = await res.json();
    router.push(body.role === "owner" ? "/owner" : "/counter");
  }

  if (!selected) {
    return (
      <main className="flex min-h-full flex-1 flex-col items-center justify-center gap-8 bg-bg px-6 py-12">
        <h1 className="font-display text-3xl font-semibold text-ink">Who&apos;s working?</h1>
        <div className="grid w-full max-w-md grid-cols-2 gap-4">
          {staff.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelected(s)}
              className="flex flex-col items-center gap-1 rounded-2xl border border-line bg-surface px-4 py-6 text-center shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md"
            >
              <span className="text-lg font-medium text-ink">{s.name}</span>
              <span className="text-xs uppercase tracking-wide text-muted">{s.role}</span>
            </button>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 bg-bg px-6 py-12">
      <button onClick={() => { setSelected(null); setPin(""); setError(null); }} className="text-sm text-muted hover:text-ink">
        &larr; Not {selected.name}?
      </button>
      <h1 className="font-display text-2xl font-semibold text-ink">Enter PIN for {selected.name}</h1>

      <div className="flex gap-3">
        {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
          <div
            key={i}
            className={`h-4 w-4 rounded-full border-2 border-brand ${i < pin.length ? "bg-brand" : "bg-transparent"}`}
          />
        ))}
      </div>

      {error && <p className="text-sm font-medium text-warn">{error}</p>}

      <div className="grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((d, i) =>
          d === "" ? (
            <div key={i} />
          ) : (
            <button
              key={i}
              onClick={() => (d === "⌫" ? setPin((p) => p.slice(0, -1)) : pressDigit(d))}
              className="h-16 w-16 rounded-full border border-line bg-surface text-xl font-medium text-ink transition-colors hover:bg-line active:scale-95"
            >
              {d}
            </button>
          )
        )}
      </div>

      <button
        onClick={submit}
        disabled={pin.length < 4 || submitting}
        className="mt-2 rounded-xl bg-brand px-10 py-3 font-medium text-white transition-opacity disabled:opacity-40"
      >
        {submitting ? "Checking..." : "Log in"}
      </button>
    </main>
  );
}
