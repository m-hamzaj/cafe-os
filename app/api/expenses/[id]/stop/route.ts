import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { COST_LOOKBACK_DAYS } from "@/lib/queries/costs";
import { ExpenseError, getExpenses, stopExpense } from "@/lib/queries/expenses";

/** Stops a weekly or monthly expense after today. Owner only. Returns the updated list. */
export async function POST(_request: Request, ctx: RouteContext<"/api/expenses/[id]/stop">) {
  const auth = await requireSession({ requireOwner: true });
  if (auth.response) return auth.response;

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid expense." }, { status: 400 });
  }
  try {
    await stopExpense(id);
    return NextResponse.json({ expenses: await getExpenses(COST_LOOKBACK_DAYS) });
  } catch (error) {
    if (error instanceof ExpenseError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
