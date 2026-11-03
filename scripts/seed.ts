/**
 * Seeds a realistic demo: staff, an 10-item menu across 4 categories,
 * 8 ingredients with real recipe_lines, starting stock, and ~8 days of
 * backdated order history so the insights panel (top/slow sellers,
 * stock runway, sales delta) has real data to narrate on first load
 * instead of an empty dashboard.
 *
 * Run with: npm run db:seed
 */
import { sql } from "../lib/db-client";
import { hashPin } from "../lib/pin";

async function main() {
  console.log("Applying schema...");
  const fs = await import("node:fs/promises");
  const schemaSql = await fs.readFile(new URL("../db/schema.sql", import.meta.url), "utf-8");
  await sql.unsafe(schemaSql);

  console.log("Clearing existing demo data (safe to re-run)...");
  await sql`truncate table order_lines, orders, stock_entries, recipe_lines, menu_items, inventory_items, staff restart identity cascade`;

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
  const inventorySeed = [
    { name: "Espresso beans", unit: "g", stock: 3200, threshold: 500 },
    { name: "Milk", unit: "ml", stock: 17000, threshold: 2500 },
    { name: "Oat milk", unit: "ml", stock: 5200, threshold: 1000 },
    { name: "Chai concentrate", unit: "ml", stock: 1800, threshold: 500 },
    { name: "Croissant", unit: "each", stock: 32, threshold: 8 },
    { name: "Blueberry muffin", unit: "each", stock: 22, threshold: 6 },
    { name: "Banana bread slice", unit: "each", stock: 18, threshold: 6 },
    { name: "Cold brew concentrate", unit: "ml", stock: 6000, threshold: 600 },
  ];
  const inventoryIds: Record<string, number> = {};
  for (const i of inventorySeed) {
    const [row] = await sql`
      insert into inventory_items (name, unit, current_stock, low_stock_threshold)
      values (${i.name}, ${i.unit}, ${i.stock}, ${i.threshold})
      returning id
    `;
    inventoryIds[i.name] = row.id;
  }

  console.log("Seeding menu + recipes...");
  const menuSeed = [
    { name: "Espresso", category: "Coffee", priceCents: 250, recipe: [["Espresso beans", 18]] },
    { name: "Latte", category: "Coffee", priceCents: 400, recipe: [["Espresso beans", 18], ["Milk", 200]] },
    { name: "Cappuccino", category: "Coffee", priceCents: 400, recipe: [["Espresso beans", 18], ["Milk", 150]] },
    { name: "Americano", category: "Coffee", priceCents: 300, recipe: [["Espresso beans", 18]] },
    { name: "Oat Milk Latte", category: "Coffee", priceCents: 450, recipe: [["Espresso beans", 18], ["Oat milk", 200]] },
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

  console.log("Seeding 8 days of order history...");
  // Weighted so Latte/Cappuccino/Espresso sell well, Chai/Banana Bread
  // sell slowly -- gives the insights panel a real top/slow-seller split
  // to narrate instead of flat, meaningless data.
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

      for (const [name, quantity] of chosen) {
        await sql`
          insert into order_lines (order_id, menu_item_id, quantity, unit_price_cents)
          values (${orderRow.id}, ${menuIds[name]}, ${quantity}, ${menuPrices[name]})
        `;
        for (const [ingredientName, qtyPerUnit] of menuSeed.find((m) => m.name === name)!.recipe) {
          await sql`
            update inventory_items set current_stock = current_stock - ${qtyPerUnit * quantity}
            where id = ${inventoryIds[ingredientName]}
          `;
        }
      }
    }
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
