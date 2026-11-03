// The cafe's own wall-clock day, not wherever the app or DB server
// happens to run. "Today" must mean the same thing to a cashier standing
// in the cafe as it does to every date boundary in lib/queries/orders.ts
// and lib/queries/insights.ts -- those boundaries must not drift apart
// just because Node's local timezone and Postgres's session timezone
// disagree (as they do in local dev: Node defaults to the OS timezone,
// Postgres in Docker defaults to UTC).
//
// Fixed for this v1 single-cafe pilot; a v2 multi-tenant build would make
// this a per-cafe column instead of a constant.
export const CAFE_TIMEZONE = "Asia/Karachi";
