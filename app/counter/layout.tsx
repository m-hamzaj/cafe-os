import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import CounterTopBar from "@/components/CounterTopBar";

export default async function CounterLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div data-mode="counter" className="flex min-h-full flex-1 flex-col bg-bg">
      <CounterTopBar staffName={session.name} />
      {children}
    </div>
  );
}
