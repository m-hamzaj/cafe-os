import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { COST_LOOKBACK_DAYS } from "@/lib/queries/costs";
import { deleteExpense, ExpenseError, getExpenses } from "@/lib/queries/expenses";

/** Deletes an expense entered by mistake. Owner only. Returns the updated list. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/expenses/[id]">) {
  const auth = await requireSession({ requireOwner: true });
  if (auth.response) return auth.response;

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid expense." }, { status: 400 });
  }
  try {
    await deleteExpense(id);
    return NextResponse.json({ expenses: await getExpenses(COST_LOOKBACK_DAYS) });
  } catch (error) {
    if (error instanceof ExpenseError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
