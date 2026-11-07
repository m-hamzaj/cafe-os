// Shared by the insights query (server) and the inventory screen (browser),
// so both show the same reorder point.

/**
 * Reorder point = average daily usage × supplier lead time + safety stock.
 * Null when no lead time is set. Usage is the same 7-day rate as the stock
 * runway: sales plus logged waste.
 */
export function reorderPoint(
  dailyUsage: number,
  leadTimeDays: number | null,
  safetyStock: number | null
): number | null {
  if (leadTimeDays === null) return null;
  return dailyUsage * leadTimeDays + (safetyStock ?? 0);
}

/** True when stock has reached the reorder point and it's time to order. */
export function needsReorder(currentStock: number, point: number | null): boolean {
  return point !== null && currentStock <= point;
}
