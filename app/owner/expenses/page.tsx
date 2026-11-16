import { COST_LOOKBACK_DAYS } from "@/lib/queries/costs";
import { getExpenses } from "@/lib/queries/expenses";
import { CAFE_TIMEZONE } from "@/lib/time";
import ExpensesManager from "@/components/ExpensesManager";

export default async function OwnerExpensesPage() {
  const expenses = await getExpenses(COST_LOOKBACK_DAYS);
  // The cafe's date, so the form's default isn't the server's or browser's.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: CAFE_TIMEZONE });

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display mb-6 text-2xl font-semibold text-ink">Expenses</h1>
      <ExpensesManager initialExpenses={expenses} today={today} days={COST_LOOKBACK_DAYS} />
    </div>
  );
}
