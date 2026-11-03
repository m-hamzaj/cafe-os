import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import OwnerLogoutButton from "@/components/OwnerLogoutButton";

const NAV = [
  { href: "/owner", label: "Insights" },
  { href: "/owner/sales", label: "Sales" },
  { href: "/owner/menu", label: "Menu" },
  { href: "/owner/inventory", label: "Inventory" },
];

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "owner") redirect("/counter");

  return (
    <div className="flex min-h-full flex-1 flex-col bg-bg">
      <header className="flex items-center justify-between border-b border-line px-6 py-4">
        <div className="flex items-center gap-8">
          <span className="font-display text-xl font-semibold text-ink">cafe-os</span>
          <nav className="flex gap-5 text-sm text-muted">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="hover:text-ink">
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted">
          <span>{session.name}</span>
          <OwnerLogoutButton />
        </div>
      </header>
      <main className="flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
