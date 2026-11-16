import Link from "next/link";
import { getOrderHistory, getPaymentSplits, type PaymentSplit } from "@/lib/queries/orders";
import { CAFE_TIMEZONE } from "@/lib/time";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatTime(iso: string): string {
  // The cafe's clock, not the server's.
  return new Date(iso).toLocaleString("en-US", {
    timeZone: CAFE_TIMEZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function orders(n: number): string {
  return `${n} ${n === 1 ? "order" : "orders"}`;
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "cash", label: "Cash" },
  { key: "card", label: "Card" },
] as const;

function SplitCard({ title, split }: { title: string; split: PaymentSplit }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="mb-2 text-sm font-semibold text-muted">{title}</p>
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-xs text-muted">Cash</dt>
          <dd className="font-display text-lg font-semibold text-ink">{formatCents(split.cashCents)}</dd>
          <dd className="text-xs text-muted">{orders(split.cashOrders)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Card</dt>
          <dd className="font-display text-lg font-semibold text-ink">{formatCents(split.cardCents)}</dd>
          <dd className="text-xs text-muted">{orders(split.cardOrders)}</dd>
        </div>
      </dl>
    </div>
  );
}

export default async function OwnerSalesPage({ searchParams }: { searchParams: Promise<{ pay?: string }> }) {
  const { pay } = await searchParams;
  const filter = pay === "cash" || pay === "card" ? pay : "all";
  const [allOrders, splits] = await Promise.all([getOrderHistory({}), getPaymentSplits()]);
  const shown = filter === "all" ? allOrders : allOrders.filter((o) => o.paymentMethod === filter);
  const dayTotalCents = allOrders.reduce((sum, o) => sum + o.totalCents, 0);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="font-display text-2xl font-semibold text-ink">Today&apos;s sales</h1>
        <span className="font-display text-xl font-semibold text-ink">{formatCents(dayTotalCents)}</span>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SplitCard title="Today" split={splits.today} />
        <SplitCard title="Last 7 days" split={splits.week} />
      </div>
      <p className="-mt-3 mb-6 text-xs text-muted">
        Cash today is what should be in the drawer from sales, on top of the float you started with.
      </p>

      <nav className="mb-4 flex gap-2" aria-label="Filter by payment">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "all" ? "/owner/sales" : `/owner/sales?pay=${f.key}`}
            aria-current={filter === f.key ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${
              filter === f.key ? "border-brand bg-brand/10 font-medium text-brand" : "border-line text-muted hover:text-ink"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {shown.length === 0 ? (
        <p className="text-muted">
          {filter === "all" ? "No orders yet today." : `No ${filter} orders yet today.`}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((order) => (
            <div key={order.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-muted">
                  {formatTime(order.createdAt)}
                  {order.paymentMethod && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        order.paymentMethod === "cash" ? "bg-good/15 text-good" : "bg-brand/15 text-brand"
                      }`}
                    >
                      {order.paymentMethod === "cash" ? "Cash" : "Card"}
                    </span>
                  )}
                </span>
                <span className="font-medium text-ink">{formatCents(order.totalCents)}</span>
              </div>
              <ul className="text-sm text-muted">
                {order.lines.map((l, i) => (
                  <li key={i}>
                    {l.quantity}× {l.menuItemName}
                    {l.optionNames.length > 0 && ` (${l.optionNames.join(", ")})`}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
