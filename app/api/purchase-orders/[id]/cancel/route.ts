import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { cancelPurchaseOrder, PurchaseOrderError } from "@/lib/queries/purchasing";

/** Cancels an open purchase order. Owner only. */
export async function POST(_request: Request, ctx: RouteContext<"/api/purchase-orders/[id]/cancel">) {
  const auth = await requireSession({ requireOwner: true });
  if (auth.response) return auth.response;

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid purchase order." }, { status: 400 });
  }
  try {
    const order = await cancelPurchaseOrder(id, auth.session.staffId);
    return NextResponse.json({ order });
  } catch (error) {
    if (error instanceof PurchaseOrderError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
