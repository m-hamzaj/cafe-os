import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { getInventoryItems, createInventoryItem } from "@/lib/queries/inventory";
import { inventoryItemSchema } from "@/lib/validation";

export async function GET() {
  const auth = await requireSession();
  if (auth.response) return auth.response;
  const items = await getInventoryItems();
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const auth = await requireSession({ requireOwner: true });
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = inventoryItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid item." }, { status: 400 });
  }
  const item = await createInventoryItem(parsed.data);
  return NextResponse.json({ item });
}
