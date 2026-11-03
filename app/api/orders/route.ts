import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { createOrderSchema } from "@/lib/validation";
import { createPaidOrder } from "@/lib/queries/orders";

export async function POST(request: Request) {
  const auth = await requireSession();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid order." }, { status: 400 });
  }

  try {
    const result = await createPaidOrder({
      lines: parsed.data.lines,
      paymentMethod: parsed.data.paymentMethod,
      staffId: auth.session.staffId,
    });
    return NextResponse.json(result);
  } catch (error) {
    // A menu item being deleted mid-order, etc -- a real but rare race,
    // not worth a 500 with no explanation for the cashier at the counter.
    const message = error instanceof Error ? error.message : "Could not complete the order.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
