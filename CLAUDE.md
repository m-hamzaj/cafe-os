# cafe-os

A single-cafe order-taking, inventory, and AI-insights system — v1 of a
product eventually meant to be sold/licensed to other cafes. Full
background and the v1/v2 scope split: see the plan this was built from
(cafe-os business plan, car-wash/iPhone sibling projects' planning
sessions).

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
  nothing was wasted.
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
