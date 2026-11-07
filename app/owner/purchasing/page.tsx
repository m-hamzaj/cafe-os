import { getInventoryItems } from "@/lib/queries/inventory";
import { getDailyUsageRates } from "@/lib/queries/insights";
import { getOnOrder, getPurchaseOrders } from "@/lib/queries/purchasing";
import { needsReorder, reorderPoint } from "@/lib/reorder";
import PurchasingManager from "@/components/PurchasingManager";

export default async function OwnerPurchasingPage() {
  const [orders, items, usageRates, onOrder] = await Promise.all([
    getPurchaseOrders(),
    getInventoryItems(),
    getDailyUsageRates(),
    getOnOrder(),
  ]);
  // Ingredients at their reorder point that aren't already on an open order.
  const reorderIds = items
    .filter(
      (i) =>
        !onOrder[i.id] &&
        needsReorder(i.currentStock, reorderPoint(usageRates[i.id] ?? 0, i.leadTimeDays, i.safetyStock))
    )
    .map((i) => i.id);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display mb-6 text-2xl font-semibold text-ink">Purchasing</h1>
      <PurchasingManager
        initialOrders={orders}
        ingredients={items.map((i) => ({ id: i.id, name: i.name, unit: i.unit }))}
        reorderIds={reorderIds}
      />
    </div>
  );
}
