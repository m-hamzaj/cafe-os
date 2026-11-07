import { getMenuItems } from "@/lib/queries/menu";
import { getInventoryItems } from "@/lib/queries/inventory";
import { getMenuItemCosts } from "@/lib/queries/costs";
import MenuManager from "@/components/MenuManager";

export default async function OwnerMenuPage() {
  const [menuItems, inventoryItems, itemCosts] = await Promise.all([
    getMenuItems(),
    getInventoryItems(),
    getMenuItemCosts(),
  ]);
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-display mb-6 text-2xl font-semibold text-ink">Menu</h1>
      <MenuManager initialMenuItems={menuItems} inventoryItems={inventoryItems} initialItemCosts={itemCosts} />
    </div>
  );
}
