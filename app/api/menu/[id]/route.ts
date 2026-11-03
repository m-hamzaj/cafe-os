import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { updateMenuItem, getMenuItemRecipe, setMenuItemRecipe } from "@/lib/queries/menu";
import { menuItemSchema, recipeLineSchema } from "@/lib/validation";
import { z } from "zod";

export async function GET(_request: Request, ctx: RouteContext<"/api/menu/[id]">) {
  const auth = await requireSession();
  if (auth.response) return auth.response;

  const { id } = await ctx.params;
  const recipe = await getMenuItemRecipe(Number(id));
  return NextResponse.json({ recipe });
}

const updateBodySchema = menuItemSchema.extend({
  recipe: z.array(recipeLineSchema),
});

export async function PUT(request: Request, ctx: RouteContext<"/api/menu/[id]">) {
  const auth = await requireSession({ requireOwner: true });
  if (auth.response) return auth.response;

  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const parsed = updateBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid item." }, { status: 400 });
  }

  const menuItemId = Number(id);
  const item = await updateMenuItem(menuItemId, parsed.data);
  await setMenuItemRecipe(menuItemId, parsed.data.recipe);
  return NextResponse.json({ item });
}
