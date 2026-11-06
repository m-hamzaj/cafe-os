import { getOrderHistory } from "@/lib/queries/orders";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function OwnerSalesPage() {
  const orders = await getOrderHistory({});
  const dayTotalCents = orders.reduce((sum, o) => sum + o.totalCents, 0);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="font-display text-2xl font-semibold text-ink">Today&apos;s sales</h1>
        <span className="font-display text-xl font-semibold text-ink">{formatCents(dayTotalCents)}</span>
      </div>

      {orders.length === 0 ? (
        <p className="text-muted">No orders yet today.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {orders.map((order) => (
            <div key={order.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="text-muted">
                  {formatTime(order.createdAt)} · {order.paymentMethod}
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
