import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { PurchaseOrderError, receivePurchaseOrder } from "@/lib/queries/purchasing";
import { receivePurchaseOrderSchema } from "@/lib/validation";

/** Records what arrived on a purchase order and adds it to stock. Owner only. */
export async function POST(request: Request, ctx: RouteContext<"/api/purchase-orders/[id]/receive">) {
  const auth = await requireSession({ requireOwner: true });
  if (auth.response) return auth.response;

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid purchase order." }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  const parsed = receivePurchaseOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid delivery." }, { status: 400 });
  }
  try {
    const order = await receivePurchaseOrder(id, parsed.data.lines, auth.session.staffId);
    return NextResponse.json({ order });
  } catch (error) {
    if (error instanceof PurchaseOrderError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
