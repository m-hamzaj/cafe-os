import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import OwnerLogoutButton from "@/components/OwnerLogoutButton";

const NAV = [
  { href: "/owner", label: "Insights" },
  { href: "/owner/sales", label: "Sales" },
  { href: "/owner/menu", label: "Menu" },
  { href: "/owner/inventory", label: "Inventory" },
  { href: "/owner/purchasing", label: "Purchasing" },
];

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "owner") redirect("/counter");

  return (
    <div className="flex min-h-full flex-1 flex-col bg-bg">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
          <span className="font-display text-xl font-semibold text-ink">cafe-os</span>
          <nav className="flex shrink-0 gap-5 overflow-x-auto text-sm text-muted">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="shrink-0 hover:text-ink">
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-sm text-muted">
          <span>{session.name}</span>
          <OwnerLogoutButton />
        </div>
      </header>
      <main className="flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
