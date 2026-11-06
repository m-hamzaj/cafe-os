import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import {
  updateMenuItem,
  getMenuItemRecipe,
  setMenuItemRecipe,
  getOptionGroups,
  setMenuItemOptions,
} from "@/lib/queries/menu";
import { menuItemSchema, optionGroupSchema, recipeLineSchema } from "@/lib/validation";
import { z } from "zod";

export async function GET(_request: Request, ctx: RouteContext<"/api/menu/[id]">) {
  const auth = await requireSession();
  if (auth.response) return auth.response;

  const { id } = await ctx.params;
  const menuItemId = Number(id);
  const [recipe, optionGroups] = await Promise.all([
    getMenuItemRecipe(menuItemId),
    getOptionGroups([menuItemId]),
  ]);
  return NextResponse.json({ recipe, optionGroups: optionGroups.get(menuItemId) ?? [] });
}

const updateBodySchema = menuItemSchema.extend({
  recipe: z.array(recipeLineSchema),
  optionGroups: z.array(optionGroupSchema),
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
  try {
    const item = await updateMenuItem(menuItemId, parsed.data);
    await setMenuItemRecipe(menuItemId, parsed.data.recipe);
    await setMenuItemOptions(menuItemId, parsed.data.optionGroups);
    return NextResponse.json({ item });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
