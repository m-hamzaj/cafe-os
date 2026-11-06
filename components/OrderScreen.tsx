"use client";

import { useEffect, useMemo, useState } from "react";

interface MenuItem {
  id: number;
  name: string;
  category: string;
  priceCents: number;
  isAvailable: boolean;
}

interface CartLine {
  menuItemId: number;
  name: string;
  priceCents: number;
  quantity: number;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function OrderScreen() {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastOrderTotal, setLastOrderTotal] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/menu")
      .then((r) => r.json())
      .then((data) => setMenu(data.items ?? []));
  }, []);

  const categories = useMemo(() => Array.from(new Set(menu.map((m) => m.category))), [menu]);
  const visibleItems = useMemo(
    () => menu.filter((m) => (category ? m.category === category : true)),
    [menu, category]
  );
  const totalCents = cart.reduce((sum, l) => sum + l.priceCents * l.quantity, 0);

  function addToCart(item: MenuItem) {
    setLastOrderTotal(null);
    setCart((prev) => {
      const existing = prev.find((l) => l.menuItemId === item.id);
      if (existing) {
        return prev.map((l) => (l.menuItemId === item.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { menuItemId: item.id, name: item.name, priceCents: item.priceCents, quantity: 1 }];
    });
  }

  function changeQuantity(menuItemId: number, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.menuItemId === menuItemId ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0)
    );
  }

  async function submit(paymentMethod: "cash" | "card") {
    if (cart.length === 0) return;
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lines: cart.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity })),
        paymentMethod,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not complete the order.");
      return;
    }
    const body = await res.json();
    setLastOrderTotal(body.totalCents);
    setCart([]);
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
      {/* Menu grid */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex gap-2 overflow-x-auto border-b border-line px-4 py-3">
          <button
            onClick={() => setCategory(null)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ${
              category === null ? "bg-accent text-accent-ink" : "bg-surface text-muted"
            }`}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ${
                category === c ? "bg-accent text-accent-ink" : "bg-surface text-muted"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="grid flex-1 auto-rows-max grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3 lg:grid-cols-4">
          {visibleItems.map((item) => (
            <button
              key={item.id}
              onClick={() => addToCart(item)}
              className="flex flex-col items-start gap-1 rounded-2xl border border-line bg-surface p-4 text-left transition-transform active:scale-95"
            >
              <span className="text-base font-medium text-ink">{item.name}</span>
              <span className="text-sm text-muted">{formatCents(item.priceCents)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Cart */}
      <div className="flex w-full shrink-0 flex-col border-t border-line bg-surface lg:w-80 lg:border-t-0 lg:border-l">
        <div className="max-h-48 overflow-y-auto p-4 lg:max-h-none lg:flex-1">
          {cart.length === 0 ? (
            <p className="text-sm text-muted">Tap a menu item to start an order.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {cart.map((l) => (
                <li key={l.menuItemId} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{l.name}</p>
                    <p className="text-xs text-muted">{formatCents(l.priceCents)} each</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => changeQuantity(l.menuItemId, -1)}
                      className="h-7 w-7 rounded-full border border-line text-ink"
                    >
                      −
                    </button>
                    <span className="w-4 text-center text-sm text-ink">{l.quantity}</span>
                    <button
                      onClick={() => changeQuantity(l.menuItemId, 1)}
                      className="h-7 w-7 rounded-full border border-line text-ink"
                    >
                      +
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-line p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm text-muted">Total</span>
            <span className="font-display text-2xl font-semibold text-ink">{formatCents(totalCents)}</span>
          </div>

          {error && <p className="mb-2 text-sm font-medium text-warn">{error}</p>}
          {lastOrderTotal !== null && (
            <p className="mb-2 text-sm font-medium text-good">Order complete: {formatCents(lastOrderTotal)}</p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => submit("cash")}
              disabled={cart.length === 0 || submitting}
              className="rounded-xl bg-accent py-3 font-medium text-accent-ink disabled:opacity-40"
            >
              Cash
            </button>
            <button
              onClick={() => submit("card")}
              disabled={cart.length === 0 || submitting}
              className="rounded-xl border border-accent py-3 font-medium text-accent disabled:opacity-40"
            >
              Card
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
