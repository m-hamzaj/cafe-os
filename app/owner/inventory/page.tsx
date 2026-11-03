import { getInventoryItems } from "@/lib/queries/inventory";
import InventoryManager from "@/components/InventoryManager";

export default async function OwnerInventoryPage() {
  const items = await getInventoryItems();
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display mb-6 text-2xl font-semibold text-ink">Inventory</h1>
      <InventoryManager initialItems={items} />
    </div>
  );
}
