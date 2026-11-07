// Shared by the API's validation and the inventory screen, so the choices a
// person sees are exactly the ones the server accepts.

export const WASTE_REASONS = [
  "Expired",
  "Spilled",
  "Remake",
  "Damaged",
  "Prep waste",
  "Sample",
  "Comp",
  "Other",
] as const;

// Why the shelf and the system disagreed. "Not sure" is allowed on purpose:
// recording an unexplained difference is still better than hiding it.
export const COUNT_REASONS = [
  "Waste not logged",
  "Delivery not recorded",
  "Earlier count was off",
  "Recipe amount is off",
  "Not sure",
] as const;

export type WasteReason = (typeof WASTE_REASONS)[number];
export type CountReason = (typeof COUNT_REASONS)[number];
