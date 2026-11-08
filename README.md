# cafe-os

Point of sale, ingredient-level inventory and AI-written daily insights for
a single cafe. It's the v1 pilot for a product meant to be licensed to other
cafes later.

**Live:** https://cafe-os-theta-three.vercel.app

## What it does

- **Counter (`/counter`):** fast order taking with menu options like oat
  milk or an extra shot. Tiles are coloured by category. Cashiers can log
  waste and mark an option out of stock.
- **Inventory:** every sale subtracts the ingredients its recipe uses, so a
  latte reduces milk and beans. Waste is logged with a reason. A physical
  count sets stock to what's on the shelf and keeps the difference.
- **Costs:** each ingredient can have a cost. Sales record their cost at the
  moment they happen, giving cost of goods sold, gross profit, food cost %
  and per-item margins. Anything sold before a cost existed is shown as not
  costed, never estimated.
- **Reorder points:** daily usage × supplier lead time + safety stock. Items
  at or below that point are flagged "Reorder now".
- **Purchase orders (`/owner/purchasing`):** place an order, then receive
  what actually arrived. Only received stock counts, the price paid becomes
  the ingredient's cost, and shortfalls are kept.
- **AI summary (`/owner`):** a short daily briefing written by Groq from
  numbers the database already computed. The model never calculates or
  invents a figure. Summaries are reused for 15 minutes.

## Stack

Next.js (App Router) and TypeScript, Tailwind, PostgreSQL through
`postgres.js` with hand-written SQL and no ORM, zod, and Groq for the
summary. Cache Components is off on purpose: every page is per-request
data behind a login.

## Run it locally

```bash
docker compose up -d              # or use a Neon/Supabase connection string
cp .env.local.example .env.local  # set DATABASE_URL, GROQ_API_KEY, SESSION_SECRET
npm install
npm run db:seed                   # schema + demo menu, stock and 8 days of orders
npm run dev
```

Log in at `/login`: **Owner** PIN `1234`, **Cashier** PIN `1111`.

## Layout

```
db/schema.sql      The whole data model. Read this first
lib/queries/       SQL per area: menu, orders, inventory, costs, purchasing, insights, staff
lib/llm/           Groq client and the insights narration
lib/               Shared rules: costs.ts, reorder.ts, stock-reasons.ts, validation.ts, auth.ts
app/counter/       Cashier screen
app/owner/         Insights, sales, menu, inventory, purchasing
app/api/           Route handlers
scripts/seed.ts    Demo data
```

`CLAUDE.md` lists the design rules any change has to follow.

## Verifying

There's no automated test suite yet. Seed the demo data, place a few orders
on `/counter`, then check that `/owner/inventory` shows the right ingredient
changes and that the numbers on `/owner` match a hand calculation.

## Not built yet (v2)

Multiple cafes (a `cafe_id` on every table), billing, and receipt printer
and cash drawer support all wait until the single-cafe pilot is proven.
