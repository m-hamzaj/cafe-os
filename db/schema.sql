-- cafe-os v1 schema -- single cafe, no tenant scoping yet (see plan Section 8 for v2 multi-tenancy).

create table if not exists staff (
  id            serial primary key,
  name          text not null,
  role          text not null check (role in ('owner', 'cashier')),
  pin_hash      text not null,   -- scrypt hash of a numeric PIN, see lib/auth.ts
  created_at    timestamptz not null default now()
);

create table if not exists menu_items (
  id            serial primary key,
  name          text not null,
  category      text not null,
  price_cents   integer not null check (price_cents >= 0),
  is_available  boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists inventory_items (
  id                  serial primary key,
  name                text not null,
  unit                text not null,                -- e.g. "g", "ml", "each"
  current_stock       numeric not null default 0,
  low_stock_threshold numeric not null default 0,
  created_at          timestamptz not null default now()
);

-- What one order of a menu item actually consumes. This is what makes
-- inventory decrement real rather than cosmetic -- selling a latte
-- decrements milk + coffee beans, not a generic "stock count" on the
-- menu item itself.
create table if not exists recipe_lines (
  menu_item_id      integer not null references menu_items(id) on delete cascade,
  inventory_item_id integer not null references inventory_items(id) on delete cascade,
  quantity_used     numeric not null check (quantity_used > 0),
  primary key (menu_item_id, inventory_item_id)
);

create table if not exists orders (
  id              serial primary key,
  status          text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  payment_method  text check (payment_method in ('cash', 'card')),
  staff_id        integer references staff(id),
  created_at      timestamptz not null default now(),
  closed_at       timestamptz
);

create table if not exists order_lines (
  id                serial primary key,
  order_id          integer not null references orders(id) on delete cascade,
  menu_item_id      integer not null references menu_items(id),
  quantity          integer not null check (quantity > 0),
  -- Price is captured at sale time, not looked up live from menu_items,
  -- so a later price change never rewrites historical order totals.
  unit_price_cents  integer not null
);

-- Manual restock entries -- a log of stock-in events, kept separate from
-- a bare UPDATE on inventory_items.current_stock so there's an audit
-- trail of when and how much was restocked.
create table if not exists stock_entries (
  id                  serial primary key,
  inventory_item_id   integer not null references inventory_items(id),
  quantity_added      numeric not null check (quantity_added > 0),
  created_at          timestamptz not null default now()
);

create index if not exists idx_order_lines_order_id on order_lines(order_id);
create index if not exists idx_order_lines_menu_item_id on order_lines(menu_item_id);
create index if not exists idx_orders_created_at on orders(created_at);
create index if not exists idx_stock_entries_inventory_item_id on stock_entries(inventory_item_id);
