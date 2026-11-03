import postgres from "postgres";

/** The actual connection factory, with no `server-only` guard -- used by
 * both lib/db.ts (the app's import, guarded) and scripts/seed.ts (plain
 * Node via tsx, which can't satisfy `server-only`'s Next.js-bundler-only
 * check). Keep all real connection logic here; lib/db.ts only adds the
 * guard on top. */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set. Copy .env.local.example to .env.local and fill it in.");
}

export const sql = postgres(databaseUrl, {
  idle_timeout: 20,
});
