import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { COST_LOOKBACK_DAYS } from "@/lib/queries/costs";
import { createExpense, getExpenses } from "@/lib/queries/expenses";
import { createExpenseSchema } from "@/lib/validation";

/** Adds an expense (rent, wages, a bill). Owner only. Returns the updated list. */
export async function POST(request: Request) {
  const auth = await requireSession({ requireOwner: true });
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = createExpenseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid expense." }, { status: 400 });
  }
  await createExpense(parsed.data, auth.session.staffId);
  return NextResponse.json({ expenses: await getExpenses(COST_LOOKBACK_DAYS) });
}
