"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import WasteDialog from "@/components/WasteDialog";

export default function CounterTopBar({ staffName }: { staffName: string }) {
  const router = useRouter();
  const [loggingWaste, setLoggingWaste] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-6">
      <span className="font-display text-xl font-semibold text-ink">cafe-os</span>
      <div className="flex items-center gap-4 text-sm text-muted">
        <button
          onClick={() => setLoggingWaste(true)}
          className="min-h-10 rounded-lg border border-line px-3 font-medium text-ink"
        >
          Log waste
        </button>
        <span>{staffName}</span>
        <button onClick={logout} className="hover:text-ink">
          Log out
        </button>
      </div>
      {loggingWaste && <WasteDialog onClose={() => setLoggingWaste(false)} />}
    </header>
  );
}
