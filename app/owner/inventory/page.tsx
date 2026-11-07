import {
  ACTIVITY_LOOKBACK_DAYS,
  getInventoryActivity,
  getInventoryItems,
  getRecentStockAdjustments,
} from "@/lib/queries/inventory";
import { getDailyUsageRates } from "@/lib/queries/insights";
import InventoryManager from "@/components/InventoryManager";

export default async function OwnerInventoryPage() {
  const [items, activity, adjustments, usageRates] = await Promise.all([
    getInventoryItems(),
    getInventoryActivity(),
    getRecentStockAdjustments(),
    getDailyUsageRates(),
  ]);
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display mb-6 text-2xl font-semibold text-ink">Inventory</h1>
      <InventoryManager
        initialItems={items}
        initialActivity={activity}
        initialAdjustments={adjustments}
        lookbackDays={ACTIVITY_LOOKBACK_DAYS}
        usageRates={usageRates}
      />
    </div>
  );
}
