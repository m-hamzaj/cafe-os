import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { getInventoryActivity, recordStockAdjustment, StockAdjustmentError } from "@/lib/queries/inventory";
import { stockAdjustmentSchema } from "@/lib/validation";

/** Logs waste or a physical count. Returns the updated ingredient, the new
 * log entry, and refreshed waste/count totals for the inventory screen.
 *
 * Anyone logged in can log waste, since spills and remakes happen at the
 * counter. Only the owner can save a count, because a count replaces the
 * stock level rather than adjusting it. */
export async function POST(request: Request) {
  const auth = await requireSession();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = stockAdjustmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid stock entry." }, { status: 400 });
  }
  if (parsed.data.kind === "count" && auth.session.role !== "owner") {
    return NextResponse.json({ error: "Only the owner can save a stock count." }, { status: 403 });
  }

  try {
    const { item, adjustment } = await recordStockAdjustment(parsed.data, auth.session.staffId);
    const activity = await getInventoryActivity();
    return NextResponse.json({ item, adjustment, activity });
  } catch (error) {
    if (error instanceof StockAdjustmentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
