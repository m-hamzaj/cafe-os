import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { setOptionAvailability } from "@/lib/queries/menu";
import { optionAvailabilitySchema } from "@/lib/validation";

// Open to cashiers as well as owners: whoever is at the counter is usually
// the first to notice something has run out. This route can only change stock
// status; prices, recipes and the options themselves stay owner-only.
export async function PATCH(request: Request, ctx: RouteContext<"/api/menu/options/[id]">) {
  const auth = await requireSession();
  if (auth.response) return auth.response;

  const { id } = await ctx.params;
  const optionId = Number(id);
  if (!Number.isInteger(optionId) || optionId <= 0) {
    return NextResponse.json({ error: "Invalid option." }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = optionAvailabilitySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
  }

  const optionIds = await setOptionAvailability(optionId, parsed.data.isAvailable, parsed.data.acrossMenu);
  if (optionIds.length === 0) {
    return NextResponse.json({ error: "That option is no longer on the menu." }, { status: 404 });
  }
  return NextResponse.json({ isAvailable: parsed.data.isAvailable, optionIds });
}
