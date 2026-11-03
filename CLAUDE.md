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
- **`lib/llm/insights.ts` never invents a number.** It narrates exactly
  what `lib/queries/insights.ts` computed from real SQL — same contract
  as the sibling `gig-tax-calculator` project's AI explanation layer. If
  you add a new insight, compute it as real data first, then pass it to
  the narration prompt; never ask the model to estimate or recalculate.
- **Checkout never blocks on inventory.** `createPaidOrder()` in
  `lib/queries/orders.ts` lets stock go negative rather than refuse a
  sale — a cafe counter can't turn away a paying customer over a
  bookkeeping discrepancy. Negative/low stock is surfaced as an alert,
  never as a checkout error.
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
