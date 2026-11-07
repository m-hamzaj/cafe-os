import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { setInventoryCost } from "@/lib/queries/inventory";
import { inventoryCostSchema } from "@/lib/validation";

/** Sets or clears an ingredient's cost per unit. Owner only. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/inventory/[id]">) {
  const auth = await requireSession({ requireOwner: true });
  if (auth.response) return auth.response;

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid ingredient." }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = inventoryCostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid cost." }, { status: 400 });
  }

  const item = await setInventoryCost(id, parsed.data.unitCostCents);
  if (!item) {
    return NextResponse.json({ error: "That ingredient no longer exists." }, { status: 404 });
  }
  return NextResponse.json({ item });
}
