import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { getAvailableMenuItems, getMenuItems, createMenuItem } from "@/lib/queries/menu";
import { menuItemSchema } from "@/lib/validation";

export async function GET(request: Request) {
  const auth = await requireSession();
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const all = url.searchParams.get("all") === "1";
  const items = all ? await getMenuItems() : await getAvailableMenuItems();
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const auth = await requireSession({ requireOwner: true });
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = menuItemSchema.pick({ name: true, category: true, priceCents: true }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid item." }, { status: 400 });
  }
  const item = await createMenuItem(parsed.data);
  return NextResponse.json({ item });
}
