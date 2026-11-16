// Quantities are stored in an ingredient's own unit (ml, g, each), which keeps
// recipes exact: a latte uses 200 ml, not 0.2 L. This file only changes how
// they're shown and typed: 17000 ml reads as 17 L, and a delivery can be
// entered as 2 kg. Shared by the server (AI summary) and the browser.

import { formatCostCents } from "@/lib/costs";

const LARGER_UNITS: Record<string, { name: string; factor: number }> = {
  ml: { name: "L", factor: 1000 },
  g: { name: "kg", factor: 1000 },
};

function larger(unit: string) {
  return LARGER_UNITS[unit.trim().toLowerCase()] ?? null;
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** "17 L", "350 ml", "3.2 kg", "12 each". Switches to L/kg from 1000 ml/g. */
export function formatAmount(quantity: number, unit: string): string {
  const big = larger(unit);
  if (big && Math.abs(quantity) >= big.factor) {
    return `${formatNumber(quantity / big.factor)} ${big.name}`;
  }
  return `${formatNumber(quantity)} ${unit}`;
}

/** "+1.2 L", "−350 ml", "0 ml". */
export function formatSignedAmount(quantity: number, unit: string): string {
  const sign = quantity > 0 ? "+" : quantity < 0 ? "−" : "";
  return `${sign}${formatAmount(Math.abs(quantity), unit)}`;
}

/** Cost per L or kg for ml/g ingredients ("$1.20 per L"), since a cost per ml
 * is too small to read. Other units keep their own ("$0.90 per each"). */
export function formatUnitCost(unitCostCents: number, unit: string): string {
  const big = larger(unit);
  return big
    ? `${formatCostCents(unitCostCents * big.factor)} per ${big.name}`
    : `${formatCostCents(unitCostCents)} per ${unit}`;
}

/** Units an amount can be typed in: ["ml", "L"], ["g", "kg"] or just [unit]. */
export function inputUnits(unit: string): string[] {
  const big = larger(unit);
  return big ? [unit, big.name] : [unit];
}

/** The larger unit when there is one: deliveries and counts are usually in
 * litres and kilos. */
export function defaultInputUnit(unit: string): string {
  return larger(unit)?.name ?? unit;
}

/** Converts a typed amount into the ingredient's own unit for saving. */
export function toStoredQuantity(value: number, inputUnit: string, unit: string): number {
  const big = larger(unit);
  if (big && inputUnit === big.name) return Math.round(value * big.factor * 10_000) / 10_000;
  return value;
}

/** A stored quantity as text for an input, in the larger unit when it's at
 * least one whole L/kg, so a prefilled 5000 ml shows as "5" L. */
export function toInputValue(quantity: number, unit: string): { value: string; inputUnit: string } {
  const big = larger(unit);
  if (big && Math.abs(quantity) >= big.factor) {
    return { value: String(Math.round((quantity / big.factor) * 10_000) / 10_000), inputUnit: big.name };
  }
  return { value: String(quantity), inputUnit: unit };
}
