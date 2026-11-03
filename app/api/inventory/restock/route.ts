import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { addStock } from "@/lib/queries/inventory";
import { addStockSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const auth = await requireSession({ requireOwner: true });
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = addStockSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid restock entry." }, { status: 400 });
  }
  await addStock(parsed.data.inventoryItemId, parsed.data.quantityAdded);
  return NextResponse.json({ ok: true });
}
