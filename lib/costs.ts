// Cost arithmetic shared by checkout (server) and the menu editor (browser),
// so a menu item's cost on screen is worked out the same way as a sale's.

/** Rounds to a ten-thousandth of a cent, enough to keep fractional per-ml
 * costs exact without carrying float noise like 24.000000000000004. */
export function roundCost(cents: number): number {
  return Math.round(cents * 10_000) / 10_000;
}

/**
 * Ingredient cost of one unit, given how much of each ingredient it uses.
 * Returns null if any ingredient it actually uses has no cost, rather than
 * a total that silently leaves that ingredient out.
 */
export function ingredientCostCents(
  usage: Iterable<[inventoryItemId: number, quantity: number]>,
  costById: Map<number, number | null>
): number | null {
  let total = 0;
  for (const [inventoryItemId, quantity] of usage) {
    const used = Math.max(0, quantity);
    if (used === 0) continue;
    const cost = costById.get(inventoryItemId);
    if (cost === null || cost === undefined) return null;
    total += used * cost;
  }
  return roundCost(total);
}

/** "$0.0012" for tiny per-unit costs, "$1.25" otherwise. */
export function formatCostCents(cents: number): string {
  const dollars = cents / 100;
  if (dollars !== 0 && Math.abs(dollars) < 0.01) {
    return `$${Number(dollars.toPrecision(2))}`;
  }
  return `${dollars < 0 ? "−" : ""}$${Math.abs(dollars).toFixed(2)}`;
}
