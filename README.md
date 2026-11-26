# cafe-os

Point of sale, ingredient-level inventory and AI-written daily insights for
a single cafe. It's the v1 pilot for a product meant to be licensed to other
cafes later.

**Live:** https://cafe-os-theta-three.vercel.app

## What it does

- **Counter (`/counter`):** fast order taking with menu options like oat
  milk or an extra shot. Tiles are coloured by category. Cashiers can log
  waste and mark an option out of stock. Each order is saved as cash or
  card, and the Sales page totals each for today and the last 7 days.
- **Inventory:** every sale subtracts the ingredients its recipe uses, so a
  latte reduces milk and beans. Waste is logged with a reason. A physical
  count sets stock to what's on the shelf and keeps the difference.
- **Units:** stock is kept in ml, g or pieces so recipes stay exact, but
  large amounts show as L and kg, and deliveries, costs and counts can be
  typed in either.
- **Costs and profit:** each ingredient can have a cost. Sales record their
  cost at the moment they happen, giving cost of goods sold, gross profit,
  food cost % and per-item margins. Anything sold before a cost existed is
  shown as not costed, never estimated. Rent, wages and bills go on
  `/owner/expenses`, and the dashboard shows net profit: gross profit minus
  waste, missing stock and expenses.
- **Reorder points:** daily usage × supplier lead time + safety stock. Items
  at or below that point are flagged "Reorder now".
- **Purchase orders (`/owner/purchasing`):** place an order, then receive
  what actually arrived. Only received stock counts, the price paid becomes
  the ingredient's cost, and shortfalls are kept.
- **AI summary (`/owner`):** a short daily briefing written by Groq from
  numbers the database already computed. The model never calculates or
  invents a figure. Summaries are reused for 15 minutes.
- **MCP server (`mcp/`):** lets AI assistants such as Claude Code, Claude
  Desktop or Cursor query the cafe and draft purchase orders. See below.

## MCP server

`mcp/` is a [Model Context Protocol](https://modelcontextprotocol.io) server
over stdio. It calls the same `lib/queries` functions as the app, so an
assistant gets exactly the numbers the dashboard shows.

| Tool | What it returns |
| --- | --- |
| `get_stock_status` | Stock, daily usage, days left, reorder point, on order, "order now" |
| `get_sales_summary` | Today vs yesterday, week vs last week, top and slowest sellers, cash/card |
| `get_profit_summary` | COGS, gross profit, food cost %, waste, expenses, net profit, data gaps |
| `get_menu_margins` | Price, recipe cost and margin per item, lowest margin first |
| `get_waste_and_counts` | Logged waste and count differences with their top reasons |
| `list_purchase_orders` | Open and recent purchase orders |
| `draft_purchase_order` | Checks and previews an order. Saves nothing |
| `confirm_purchase_order` | Saves a previewed draft. Only exists with writes enabled |

**Safety rules:**
- Everything is read-only by default.
- Ordering takes two steps. `draft_purchase_order` shows each line in L/kg next
  to current stock, reorder point and anything already on order, so a person
  can catch a wrong quantity before approving it.
- `confirm_purchase_order` only appears when `CAFE_OS_MCP_ALLOW_WRITES=1`. It
  accepts a draft once, within 15 minutes. It's marked as a write, so clients
  ask before running it.
- A confirmed order is saved under the owner account and tagged "created via AI
  assistant". Stock still only changes when the delivery is received in the app.

**Connect it:** Claude Code picks up `.mcp.json` when it's opened in this
folder. For other clients, use the same command:

```bash
npm run mcp   # reads DATABASE_URL from .env.local
```

To allow drafted orders to be saved, set `"CAFE_OS_MCP_ALLOW_WRITES": "1"` in
`.mcp.json`. `CAFE_OS_MCP_STAFF_ID` picks which staff member orders are
recorded under; the default is the first owner.

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
lib/queries/       SQL per area: menu, orders, inventory, costs, expenses, purchasing, insights, staff
lib/llm/           Groq client and the insights narration
mcp/               MCP server for AI assistants (server.ts starts it, tools.ts defines the tools)
lib/               Shared rules: costs.ts, units.ts, reorder.ts, stock-reasons.ts, validation.ts, auth.ts
app/counter/       Cashier screen
app/owner/         Insights, sales, menu, inventory, purchasing, expenses
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
