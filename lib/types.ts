export interface MenuItem {
  id: number;
  name: string;
  category: string;
  priceCents: number;
  isAvailable: boolean;
}

export interface InventoryItem {
  id: number;
  name: string;
  unit: string;
  currentStock: number;
  lowStockThreshold: number;
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
  }>;
}
