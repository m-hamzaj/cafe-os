import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { createPurchaseOrder, PurchaseOrderError } from "@/lib/queries/purchasing";
import { createPurchaseOrderSchema } from "@/lib/validation";

/** Starts a purchase order. Owner only; nothing changes stock until it's received. */
export async function POST(request: Request) {
  const auth = await requireSession({ requireOwner: true });
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = createPurchaseOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid order." }, { status: 400 });
  }
  try {
    const order = await createPurchaseOrder(parsed.data, auth.session.staffId);
    return NextResponse.json({ order });
  } catch (error) {
    if (error instanceof PurchaseOrderError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
