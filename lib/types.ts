export interface MenuItem {
  id: number;
  name: string;
  category: string;
  priceCents: number;
  isAvailable: boolean;
}

export interface OptionAdjustment {
  inventoryItemId: number;
  quantityDelta: number;
}

export interface MenuOption {
  id: number;
  name: string;
  priceDeltaCents: number;
  isAvailable: boolean;
  adjustments: OptionAdjustment[];
}

export interface MenuOptionGroup {
  id: number;
  name: string;
  isRequired: boolean;
  allowsMultiple: boolean;
  options: MenuOption[];
}

export interface MenuItemWithOptions extends MenuItem {
  optionGroups: MenuOptionGroup[];
}

export interface InventoryItem {
  id: number;
  name: string;
  unit: string;
  currentStock: number;
  lowStockThreshold: number;
  /** Cents per one unit; null when no cost has been set. */
  unitCostCents: number | null;
  /** Days from ordering to delivery; null means no reorder point. */
  leadTimeDays: number | null;
  /** Extra stock to keep on top of lead-time usage; null counts as zero. */
  safetyStock: number | null;
}

/** Cost figures for a recent window. Anything that depends on a missing
 * ingredient cost is left out of the totals and counted separately. */
export interface CostSummary {
  days: number;
  salesCents: number;
  /** Sales whose ingredient cost was known when they were sold. */
  costedSalesCents: number;
  cogsCents: number;
  uncostedLines: number;
  wasteCostCents: number;
  uncostedWasteEntries: number;
  /** Net value of count differences: negative means stock went missing. */
  countDifferenceCents: number;
  uncostedCounts: number;
  stockValueCents: number;
  ingredientsWithoutCost: number;
}

export type StockAdjustmentKind = "waste" | "count";

export interface StockAdjustment {
  id: number;
  inventoryItemId: number;
  inventoryItemName: string;
  unit: string;
  kind: StockAdjustmentKind;
  /** Signed: negative for waste or a count that came up short. */
  quantityChange: number;
  expectedStock: number;
  countedStock: number | null;
  reason: string | null;
  note: string | null;
  staffName: string | null;
  createdAt: string;
}

/** Waste and count results per ingredient over the recent window. */
export interface InventoryActivity {
  wasted: number;
  /** Sum of count differences: negative means stock went missing. */
  countVariance: number;
  /** Whole days since the last count, or null if it was never counted. */
  daysSinceCount: number | null;
}

export interface RecipeLine {
  menuItemId: number;
  inventoryItemId: number;
  quantityUsed: number;
}

export type OrderStatus = "open" | "paid" | "cancelled";
export type PaymentMethod = "cash" | "card";

export interface OrderLineInput {
  menuItemId: number;
  quantity: number;
  optionIds: number[];
}

export interface Order {
  id: number;
  status: OrderStatus;
  paymentMethod: PaymentMethod | null;
  totalCents: number;
  createdAt: string;
  closedAt: string | null;
}

export interface OrderWithLines extends Order {
  lines: Array<{
    menuItemId: number;
    menuItemName: string;
    quantity: number;
    unitPriceCents: number;
    optionNames: string[];
  }>;
}
