/**
 * Seeds a realistic demo: staff, a 9-item menu across 4 categories with
 * options on the milk drinks, 8 ingredients with real recipe_lines,
 * starting stock, and ~8 days of
 * backdated order history so the insights panel (top/slow sellers,
 * stock runway, sales delta) has real data to narrate on first load
 * instead of an empty dashboard.
 *
 * Run with: npm run db:seed
 */
import { sql } from "../lib/db-client";
import { hashPin } from "../lib/pin";
import { ingredientCostCents } from "../lib/costs";

async function main() {
  console.log("Applying schema...");
  const fs = await import("node:fs/promises");
  const schemaSql = await fs.readFile(new URL("../db/schema.sql", import.meta.url), "utf-8");
  await sql.unsafe(schemaSql);

  console.log("Clearing existing demo data (safe to re-run)...");
  await sql`truncate table insight_summary_cache, purchase_order_lines, purchase_orders, stock_adjustments, order_line_options, order_lines, orders, stock_entries, option_recipe_adjustments, menu_options, menu_option_groups, recipe_lines, menu_items, inventory_items, staff restart identity cascade`;

  console.log("Seeding staff...");
  const ownerPinHash = await hashPin("1234");
  const cashierPinHash = await hashPin("1111");
  await sql`
    insert into staff (name, role, pin_hash) values
    ('Owner', 'owner', ${ownerPinHash}),
    ('Cashier', 'cashier', ${cashierPinHash})
  `;
  const [{ id: cashierId }] = await sql`select id from staff where role = 'cashier' limit 1`;

  console.log("Seeding inventory...");
  // Stock levels tuned against the actual 8-day demand this script
  // generates below (see the `weighted` pool), so the seeded state lands
  // on a believable mix: most ingredients comfortably stocked, 1-2
  // genuinely low (positive, not negative) to give the restock alert
  // and AI insight something real to flag on first run.
  // costCents is per one unit: beans at $25/kg are 2.5 cents a gram, milk at
  // $1.20/L is 0.12 cents a ml.
  // lead is days from ordering to delivery and safety is extra stock to keep,
  // so the inventory screen has reorder points to show. Pastries arrive
  // daily; beans and concentrates take a few days.
  const inventorySeed = [
    { name: "Espresso beans", unit: "g", stock: 3200, threshold: 500, costCents: 2.5, lead: 3, safety: 300 },
    { name: "Milk", unit: "ml", stock: 17000, threshold: 2500, costCents: 0.12, lead: 1, safety: 1000 },
    { name: "Oat milk", unit: "ml", stock: 5200, threshold: 1000, costCents: 0.3, lead: 2, safety: 500 },
    { name: "Chai concentrate", unit: "ml", stock: 1800, threshold: 500, costCents: 0.8, lead: 3, safety: 200 },
    { name: "Croissant", unit: "each", stock: 32, threshold: 8, costCents: 90, lead: 1, safety: 4 },
    { name: "Blueberry muffin", unit: "each", stock: 22, threshold: 6, costCents: 80, lead: 1, safety: 3 },
    { name: "Banana bread slice", unit: "each", stock: 18, threshold: 6, costCents: 70, lead: 1, safety: 3 },
    { name: "Cold brew concentrate", unit: "ml", stock: 6000, threshold: 600, costCents: 1, lead: 3, safety: 500 },
  ];
  const inventoryIds: Record<string, number> = {};
  const costByName: Record<string, number> = {};
  for (const i of inventorySeed) {
    const [row] = await sql`
      insert into inventory_items
        (name, unit, current_stock, low_stock_threshold, unit_cost_cents, lead_time_days, safety_stock)
      values (${i.name}, ${i.unit}, ${i.stock}, ${i.threshold}, ${i.costCents}, ${i.lead}, ${i.safety})
      returning id
    `;
    inventoryIds[i.name] = row.id;
    costByName[i.name] = i.costCents;
  }

  console.log("Seeding menu + recipes...");
  const menuSeed = [
    { name: "Espresso", category: "Coffee", priceCents: 250, recipe: [["Espresso beans", 18]] },
    { name: "Latte", category: "Coffee", priceCents: 400, recipe: [["Espresso beans", 18], ["Milk", 200]] },
    { name: "Cappuccino", category: "Coffee", priceCents: 400, recipe: [["Espresso beans", 18], ["Milk", 150]] },
    { name: "Americano", category: "Coffee", priceCents: 300, recipe: [["Espresso beans", 18]] },
    { name: "Chai Latte", category: "Tea", priceCents: 350, recipe: [["Chai concentrate", 150], ["Milk", 100]] },
    { name: "Croissant", category: "Pastries", priceCents: 300, recipe: [["Croissant", 1]] },
    { name: "Blueberry Muffin", category: "Pastries", priceCents: 325, recipe: [["Blueberry muffin", 1]] },
    { name: "Banana Bread", category: "Pastries", priceCents: 350, recipe: [["Banana bread slice", 1]] },
    { name: "Cold Brew", category: "Cold", priceCents: 400, recipe: [["Cold brew concentrate", 300]] },
  ] as const;

  const menuIds: Record<string, number> = {};
  const menuPrices: Record<string, number> = {};
  for (const m of menuSeed) {
    const [row] = await sql`
      insert into menu_items (name, category, price_cents) values (${m.name}, ${m.category}, ${m.priceCents})
      returning id
    `;
    menuIds[m.name] = row.id;
    menuPrices[m.name] = m.priceCents;
    for (const [ingredientName, qty] of m.recipe) {
      await sql`
        insert into recipe_lines (menu_item_id, inventory_item_id, quantity_used)
        values (${row.id}, ${inventoryIds[ingredientName]}, ${qty})
      `;
    }
  }

  console.log("Seeding menu options...");
  type SeedOption = { name: string; priceDeltaCents: number; adjustments: Array<[string, number]> };
  type SeedGroup = { name: string; isRequired: boolean; allowsMultiple: boolean; options: SeedOption[] };

  const milkGroup = (ml: number): SeedGroup => ({
    name: "Milk",
    isRequired: true,
    allowsMultiple: false,
    options: [
      { name: "Whole", priceDeltaCents: 0, adjustments: [] },
      { name: "Oat", priceDeltaCents: 50, adjustments: [["Milk", -ml], ["Oat milk", ml]] },
    ],
  });
  const extrasGroup: SeedGroup = {
    name: "Extras",
    isRequired: false,
    allowsMultiple: true,
    options: [{ name: "Extra shot", priceDeltaCents: 75, adjustments: [["Espresso beans", 18]] }],
  };
  const optionSeed: Record<string, SeedGroup[]> = {
    Latte: [milkGroup(200), extrasGroup],
    Cappuccino: [milkGroup(150), extrasGroup],
    "Chai Latte": [milkGroup(100)],
    Americano: [extrasGroup],
  };

  const optionIds = new Map<string, number>();
  for (const [menuName, groups] of Object.entries(optionSeed)) {
    for (const [groupIndex, group] of groups.entries()) {
      const [groupRow] = await sql`
        insert into menu_option_groups (menu_item_id, name, is_required, allows_multiple, sort_order)
        values (${menuIds[menuName]}, ${group.name}, ${group.isRequired}, ${group.allowsMultiple}, ${groupIndex})
        returning id
      `;
      for (const [optionIndex, option] of group.options.entries()) {
        const [optionRow] = await sql`
          insert into menu_options (group_id, name, price_delta_cents, sort_order)
          values (${groupRow.id}, ${option.name}, ${option.priceDeltaCents}, ${optionIndex})
          returning id
        `;
        optionIds.set(`${menuName}/${group.name}/${option.name}`, optionRow.id);
        for (const [ingredientName, delta] of option.adjustments) {
          await sql`
            insert into option_recipe_adjustments (option_id, inventory_item_id, quantity_delta)
            values (${optionRow.id}, ${inventoryIds[ingredientName]}, ${delta})
          `;
        }
      }
    }
  }

  console.log("Seeding 8 days of order history...");
  // Weighted so Latte/Cappuccino/Espresso sell well, Chai/Banana Bread
  // sell slowly -- gives the insights panel a real top/slow-seller split
  // to narrate instead of flat, meaningless data. "Oat Milk Latte" isn't a
  // menu item: it stands for a Latte sold with the Oat option below.
  const weighted: Array<[string, number]> = [
    ["Latte", 10],
    ["Cappuccino", 8],
    ["Espresso", 7],
    ["Americano", 5],
    ["Oat Milk Latte", 5],
    ["Croissant", 6],
    ["Blueberry Muffin", 4],
    ["Cold Brew", 4],
    ["Chai Latte", 2],
    ["Banana Bread", 2],
  ];
  const pool = weighted.flatMap(([name, weight]) => Array(weight).fill(name));

  function pick(): string {
    return pool[Math.floor(Math.random() * pool.length)];
  }

  const OPEN_HOUR = 7;
  const CLOSE_HOUR = 18;
  const currentHour = new Date().getHours();
  // The cafe hasn't opened yet today if seeding runs before OPEN_HOUR --
  // zero "today" orders is the honest state then, not a bug to paper
  // over. Otherwise, only ever pick hours that have actually elapsed, so
  // a "today" order can never land in the future relative to the moment
  // this script runs (which broke getOrderHistory's "up to now" bound
  // the first time this seed ran at 4am local).
  const latestElapsedHour = Math.min(currentHour, CLOSE_HOUR);

  for (let daysAgo = 7; daysAgo >= 0; daysAgo--) {
    const isToday = daysAgo === 0;
    const hourSpan = isToday ? Math.max(0, latestElapsedHour - OPEN_HOUR + 1) : CLOSE_HOUR - OPEN_HOUR + 1;
    const ordersToday = isToday
      ? Math.round((14 + Math.random() * 10) * (hourSpan / (CLOSE_HOUR - OPEN_HOUR + 1)))
      : 14 + Math.floor(Math.random() * 10);
    for (let o = 0; o < ordersToday; o++) {
      const lineCount = 1 + Math.floor(Math.random() * 2);
      const chosen = new Map<string, number>();
      for (let l = 0; l < lineCount; l++) {
        const name = pick();
        chosen.set(name, (chosen.get(name) ?? 0) + 1);
      }

      const hour = isToday
        ? OPEN_HOUR + Math.floor(Math.random() * hourSpan)
        : OPEN_HOUR + Math.floor(Math.random() * (CLOSE_HOUR - OPEN_HOUR + 1));
      const minute = isToday && hour === currentHour ? Math.floor(Math.random() * new Date().getMinutes()) : Math.floor(Math.random() * 60);
      const createdAt = new Date();
      createdAt.setDate(createdAt.getDate() - daysAgo);
      createdAt.setHours(hour, minute, 0, 0);

      const [orderRow] = await sql`
        insert into orders (status, payment_method, staff_id, created_at, closed_at)
        values ('paid', ${Math.random() > 0.4 ? "card" : "cash"}, ${cashierId}, ${createdAt}, ${createdAt})
        returning id
      `;

      for (const [saleName, quantity] of chosen) {
        const isOat = saleName === "Oat Milk Latte";
        const name = isOat ? "Latte" : saleName;

        // Every required group gets its first option (or Oat), matching what
        // the counter sends. Seeded history leaves optional extras unchosen.
        const selected = (optionSeed[name] ?? [])
          .filter((g) => g.isRequired)
          .map((g) => ({
            group: g,
            option: (isOat && g.options.find((o) => o.name === "Oat")) || g.options[0],
          }));
        const unitPrice = selected.reduce((sum, s) => sum + s.option.priceDeltaCents, menuPrices[name]);

        const ingredientUse: Array<readonly [string, number]> = [
          ...menuSeed.find((m) => m.name === name)!.recipe,
          ...selected.flatMap((s) => s.option.adjustments),
        ];
        // Same rule as checkout: sum each ingredient's use per unit, floor at
        // zero, then price it.
        const usedPerUnit = new Map<number, number>();
        for (const [ingredientName, qty] of ingredientUse) {
          const id = inventoryIds[ingredientName];
          usedPerUnit.set(id, (usedPerUnit.get(id) ?? 0) + qty);
        }
        const unitCost = ingredientCostCents(
          usedPerUnit,
          new Map(Object.entries(costByName).map(([n, c]) => [inventoryIds[n], c]))
        );

        const [lineRow] = await sql`
          insert into order_lines (order_id, menu_item_id, quantity, unit_price_cents, unit_cost_cents)
          values (${orderRow.id}, ${menuIds[name]}, ${quantity}, ${unitPrice}, ${unitCost})
          returning id
        `;
        for (const { group, option } of selected) {
          await sql`
            insert into order_line_options (order_line_id, option_id, group_name, option_name, price_delta_cents)
            values (
              ${lineRow.id}, ${optionIds.get(`${name}/${group.name}/${option.name}`)!},
              ${group.name}, ${option.name}, ${option.priceDeltaCents}
            )
          `;
        }

        for (const [ingredientName, qtyPerUnit] of ingredientUse) {
          await sql`
            update inventory_items set current_stock = current_stock - ${qtyPerUnit * quantity}
            where id = ${inventoryIds[ingredientName]}
          `;
        }
      }
    }
  }

  console.log("Seeding an open purchase order...");
  // One dairy order waiting for delivery, so the purchasing page and the
  // "on order" notes have something to show. Nothing is added to stock until
  // it's received.
  const [{ id: ownerId }] = await sql`select id from staff where role = 'owner' limit 1`;
  const [po] = await sql`
    insert into purchase_orders (supplier, note, created_by)
    values ('Valley Dairy', 'Usual weekly milk order', ${ownerId})
    returning id
  `;
  for (const [ingredientName, quantity] of [
    ["Milk", 10000],
    ["Oat milk", 4000],
  ] as const) {
    await sql`
      insert into purchase_order_lines (purchase_order_id, inventory_item_id, quantity_ordered, unit_cost_cents)
      values (${po.id}, ${inventoryIds[ingredientName]}, ${quantity}, ${costByName[ingredientName]})
    `;
  }

  console.log("\nSeed complete.");
  console.log("Log in at /login as:");
  console.log("  Owner, PIN 1234");
  console.log("  Cashier, PIN 1111");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
