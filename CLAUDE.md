# cafe-os

A single-cafe order-taking, inventory, and AI-insights system — v1 of a
product eventually meant to be sold/licensed to other cafes. README.md
has the feature overview and setup; this file has the rules.

## Key conventions

- **`lib/queries/` has zero framework dependency** — hand-written SQL via
  `postgres.js`, no ORM. Every query function returns a typed domain
  object (see `lib/types.ts`), never a raw DB row, past its own file.
- **`recipe_lines` is the core design decision**: selling a menu item
  decrements the ingredients it actually consumes, scaled by quantity —
  not a flat per-item stock count. Any new feature touching inventory
  must go through this relationship, not add a parallel stock-tracking
  path.
- **Menu options adjust the recipe, they don't replace it.** A chosen
  option's `option_recipe_adjustments` are signed changes on top of
  `recipe_lines`. `createPaidOrder()` and `getStockRunway()` must apply
  them the same way: per line, floored at zero, times quantity.
  `getStockRunway()` also counts logged waste in its window as usage, but
  not count differences. The AI summary gets logged waste per ingredient
  too, and is told an empty waste log means nothing was recorded, not that
  nothing was wasted. It also gets counts that didn't match the system,
  plus how many counts were saved, so "no differences" isn't confused with
  "nobody counted".
- **`lib/llm/insights.ts` never invents a number.** It narrates exactly
  what `lib/queries/insights.ts` computed from real SQL — same contract
  as the sibling `gig-tax-calculator` project's AI explanation layer. If
  you add a new insight, compute it as real data first, then pass it to
  the narration prompt; never ask the model to estimate or recalculate.
  Only the narration is cached (`insight_summary_cache`, 15 minutes); the
  numbers are computed on every request. Cache Components stays off, so
  this lives in Postgres rather than `use cache`.
- **Stock corrections keep their reason.** Waste and physical counts go
  through `recordStockAdjustment()` into `stock_adjustments`, never a bare
  `UPDATE current_stock`. A count stores what the system expected next to
  what was counted, so variance stays reviewable. Restocks stay in
  `stock_entries`. The reason lists live in `lib/stock-reasons.ts`, shared
  by validation and the UI. Anyone logged in can log waste (the counter's
  "Log waste" button); only the owner can save a count, because it replaces
  the stock level.
- **Costs are recorded when things happen, never guessed.** Each
  ingredient has an optional `unit_cost_cents` (cents per one unit,
  fractions allowed). `createPaidOrder()` stores each line's ingredient
  cost in `order_lines.unit_cost_cents` using `ingredientCostCents()` from
  `lib/costs.ts`, the same rule as stock (per line, floored at zero), and
  waste and counts store the ingredient's cost too. If any ingredient used
  has no cost, the line is null ("not costed") rather than a partial total.
  COGS in `lib/queries/costs.ts` sums those recorded costs; it is not the
  beginning + purchases − ending inventory formula, because there's no
  inventory valuation from before costs existed.
- **Reorder points are worked out, not stored.** Each ingredient has an
  optional `lead_time_days` and `safety_stock`; the reorder point is daily
  usage × lead time + safety stock (`reorderPoint()` in `lib/reorder.ts`),
  where usage is the stock runway's rate (sales plus logged waste). The
  server and the inventory screen both call that function. No lead time
  means no reorder point.
- **Purchase orders only touch stock when received.** `lib/queries/purchasing.ts`
  creates orders (`purchase_orders`, `purchase_order_lines`); receiving
  records what actually arrived for every line (zero allowed), adds it via
  `stock_entries` linked by `purchase_order_line_id`, sets the ingredient's
  cost to the price paid, and closes the order even if lines came up short.
  Quantities on open orders show as "on order" and suppress "reorder now"
  advice, including in the AI summary.
- **Quantities are stored in the ingredient's own unit (ml, g, each).**
  `lib/units.ts` only changes display and input: amounts from 1000 ml/g
  show as L/kg, costs show per L/kg, and inputs can be typed in either via
  `UnitSelect`, converted with `toStoredQuantity()` before sending. Never
  send an L or kg number to the API, and keep recipes in ml/g.
- **Net profit = gross profit − waste + count differences − expenses.**
  Expenses (`expenses` table, `/owner/expenses`) are rent, wages and bills:
  one-off on a date, or weekly/monthly spread evenly per day (monthly ×
  12 ÷ 365) until stopped. `getExpenses()` works out each one's share of
  the cost summary's days in SQL; `getCostSummary()` sums those shares.
- **Checkout never blocks on inventory.** `createPaidOrder()` in
  `lib/queries/orders.ts` lets stock go negative rather than refuse a
  sale — a cafe counter can't turn away a paying customer over a
  bookkeeping discrepancy. Negative/low stock is surfaced as an alert,
  never as a checkout error. An option marked out of stock follows the
  same rule: the counter stops offering it, the order API still accepts it.
  Cashiers can flip that switch (`PATCH /api/menu/options/[id]`), so the
  owner's editor only sends stock status when the owner changed it. The
  flip can also apply across the menu, matching on option name plus group
  name; `setOptionAvailability()` and `otherItemsToSync()` must agree on that.
- **The MCP server (`mcp/`) reuses `lib/queries`, never its own SQL for
  figures the app already computes.** Same no-invented-numbers contract as
  the AI summary: derived values (profit, margin %) are worked out in
  `mcp/tools.ts` with the app's own formulas, never left to the model. Every
  tool is read-only except `confirm_purchase_order`, which only registers
  with `CAFE_OS_MCP_ALLOW_WRITES=1` and only saves a draft previewed by
  `draft_purchase_order`. A new write tool must follow the same draft then
  confirm pattern. stdout is the protocol, so nothing in it may log there.
- **Cache Components is off** (`next.config.ts`) — this whole app is
  authenticated, per-request data with nothing to statically prerender.
  Don't re-enable it without restructuring every data-fetching page
  behind `<Suspense>` first.
- **`lib/auth.ts` is the only file handling PINs/sessions.** PINs are
  scrypt-hashed (`hashPin`/`verifyPin`), sessions are HMAC-signed cookies
  (`SESSION_SECRET`), not a database-backed session table — deliberately
  simple for single-cafe scale.
- **v1 is single-tenant, on purpose.** No table has a `cafe_id` column
  yet. Adding multi-tenancy (v2) means adding that column everywhere and
  a scoping layer on every query — don't half-do this by adding it to
  only some tables.

## Commands

```bash
npm run dev        # local dev server
npm run build       # production build + typecheck
npm run db:seed     # apply schema.sql + seed realistic demo data
```

No automated test suite yet (v1 pilot scope) — see README.md's
verification section for the manual check path.
