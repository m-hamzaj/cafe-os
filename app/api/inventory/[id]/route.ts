import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { updateInventorySettings } from "@/lib/queries/inventory";
import { inventorySettingsSchema } from "@/lib/validation";

/** Sets or clears an ingredient's cost and reorder settings. Owner only. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/inventory/[id]">) {
  const auth = await requireSession({ requireOwner: true });
  if (auth.response) return auth.response;

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid ingredient." }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = inventorySettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid settings." }, { status: 400 });
  }

  const item = await updateInventorySettings(id, parsed.data);
  if (!item) {
    return NextResponse.json({ error: "That ingredient no longer exists." }, { status: 404 });
  }
  return NextResponse.json({ item });
}
