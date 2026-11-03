"use client";

import { useRouter } from "next/navigation";

export default function CounterTopBar({ staffName }: { staffName: string }) {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <header className="flex items-center justify-between border-b border-line px-6 py-4">
      <span className="font-display text-xl font-semibold text-ink">cafe-os</span>
      <div className="flex items-center gap-4 text-sm text-muted">
        <span>{staffName}</span>
        <button onClick={logout} className="hover:text-ink">
          Log out
        </button>
      </div>
    </header>
  );
}
