# cafe-os

Order-taking, inventory, and AI-narrated daily insights for a single cafe —
built as the v1 pilot for a product eventually meant to be sold/licensed to
other cafes (see the multi-tenant plan for v2, below).

## Why this exists

Most small-cafe POS tools are either generic retail software (overkill,
built for multi-location chains) or informal pen-and-paper/spreadsheet
tracking. This is right-sized for one cafe: order-taking, real
ingredient-level inventory decrement, and a daily AI summary that
explains numbers the database already computed — it never invents or
recalculates a figure, same discipline as this project's companion
`gig-tax-calculator`.

## Stack

Next.js (App Router) + TypeScript + Tailwind, PostgreSQL via `postgres.js`
(hand-written SQL, no ORM), Groq for the AI insights narration.

**Cache Components is deliberately disabled** (see `next.config.ts`) —
every page here is authenticated, per-request business data with nothing
to gain from static prerendering.

## Getting started

### 1. Database

Either run Postgres locally via Docker:

```bash
docker compose up -d
```

...or sign up for a free [Neon](https://neon.tech) or [Supabase](https://supabase.com)
account and copy its connection string instead.

### 2. Environment

```bash
cp .env.local.example .env.local
```

Fill in `DATABASE_URL` (matches `docker-compose.yml` by default for local
dev), `GROQ_API_KEY` (from [console.groq.com](https://console.groq.com)),
and `SESSION_SECRET` (any long random string — the file has a one-liner
to generate one).

### 3. Seed

```bash
npm install
npm run db:seed
```

This applies `db/schema.sql`, creates two demo staff logins, a 9-item
menu across 4 categories with real ingredient recipes and options on the
milk drinks, and 8 days of
backdated order history — so the insights panel has real data to narrate
on first load instead of an empty dashboard.

Log in at `/login` as:
- **Owner**, PIN `1234`
- **Cashier**, PIN `1111`

### 4. Run

```bash
npm run dev
```

## Project layout

```
lib/
  db.ts              Postgres connection (server-only)
  auth.ts             PIN hashing + signed session cookies (server-only)
  api-auth.ts         requireSession() helper for route handlers
  types.ts            Shared domain types
  validation.ts       Zod schemas, shared by client forms and API routes
  queries/            Hand-written SQL per domain (menu, inventory, orders, insights, staff)
  llm/
    groq-client.ts     Server-only Groq wrapper (same resilience pattern as gig-tax-calculator)
    insights.ts        Narrates lib/queries/insights.ts's real numbers -- never invents one; reuses a summary for 15 minutes
app/
  counter/            Cashier order-taking screen (dark, high-contrast, built for speed)
  owner/              Owner dashboard: insights, sales history, menu + inventory management
  api/                Route handlers backing both
db/
  schema.sql           The whole schema -- read this first to understand the data model
scripts/
  seed.ts              Demo data (npm run db:seed)
```

## The data model, in one sentence

Selling a menu item decrements the *actual ingredients* it consumes via
`recipe_lines` (e.g. a latte decrements milk + coffee beans), not a
generic per-item stock count — this is what makes low-stock alerts and
AI insights genuinely useful instead of cosmetic. Menu options adjust that
same recipe when chosen: oat milk on a latte is Milk −200, Oat milk +200.

Sales are only the expected usage. On `/owner/inventory` the owner can also
log waste with a reason, which subtracts it from stock, and enter a physical
count. A count sets stock to what's on the shelf but keeps the system's
figure and the difference in `stock_adjustments`, with a reason whenever
they don't match, so missing stock is explained rather than overwritten.
Cashiers can log waste too, from the "Log waste" button on `/counter`;
counts stay owner-only.

Each ingredient can have a cost (set on `/owner/inventory` from a recent
purchase, like $4.00 for 1000 ml). Sales then record their ingredient cost
when they happen, so `/owner` shows cost of goods sold, gross profit, food
cost %, the cost of waste and missing stock, and stock value for the last 7
days, and `/owner/menu` shows each item's recipe cost and margin. Sales made
before an ingredient had a cost are reported as not costed, not estimated.

## Tests / verification

No automated test suite yet (v1 pilot scope). Manual verification path:
seed the demo data, run a few orders through `/counter`, confirm
`/owner/inventory` reflects the real ingredient decrement, confirm
`/owner` insights numbers match what you'd compute by hand from the
same orders.

## v2 (not built yet — see the plan)

Multi-tenancy (`cafe_id` scoping across every table), per-cafe billing,
and real POS hardware integration (receipt printer, cash drawer) are all
deliberately deferred until this single-cafe pilot is proven. See
`CLAUDE.md` for the full reasoning.
