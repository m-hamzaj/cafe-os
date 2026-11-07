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

-- Choices a cashier makes when selling a menu item (Milk: Whole/Oat,
-- Extras: Extra shot). Groups belong to one menu item rather than being
-- shared, because the ingredient effect depends on the item: oat milk
-- replaces 200 ml in a latte but 150 ml in a cappuccino.
create table if not exists menu_option_groups (
  id              serial primary key,
  menu_item_id    integer not null references menu_items(id) on delete cascade,
  name            text not null,
  is_required     boolean not null default false,
  allows_multiple boolean not null default false,
  sort_order      integer not null default 0
);

create table if not exists menu_options (
  id                serial primary key,
  group_id          integer not null references menu_option_groups(id) on delete cascade,
  name              text not null,
  price_delta_cents integer not null default 0,
  sort_order        integer not null default 0
);

-- A switch any staff member can flip when an option runs out. It only stops the option
-- being offered at the counter; see createPaidOrder for why it never blocks a
-- sale. Separate from the create above so existing databases pick it up.
alter table menu_options add column if not exists is_available boolean not null default true;

-- How choosing an option changes what one unit consumes, relative to the
-- item's recipe_lines. Signed: oat milk is Milk -200, Oat milk +200.
create table if not exists option_recipe_adjustments (
  option_id         integer not null references menu_options(id) on delete cascade,
  inventory_item_id integer not null references inventory_items(id) on delete cascade,
  quantity_delta    numeric not null check (quantity_delta <> 0),
  primary key (option_id, inventory_item_id)
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

-- The options chosen on a sold line. Names and price are captured at sale
-- time, like order_lines.unit_price_cents, so editing or deleting an option
-- never rewrites order history. unit_price_cents already includes the deltas.
create table if not exists order_line_options (
  id                serial primary key,
  order_line_id     integer not null references order_lines(id) on delete cascade,
  option_id         integer references menu_options(id) on delete set null,
  group_name        text not null,
  option_name       text not null,
  price_delta_cents integer not null
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

-- Every stock change that isn't a sale or a restock, with the reason, so a
-- correction never silently overwrites the number. Waste subtracts what was
-- thrown away. A count sets stock to what's on the shelf and keeps what the
-- system expected, so the difference (count variance) can be reviewed later.
create table if not exists stock_adjustments (
  id                serial primary key,
  inventory_item_id integer not null references inventory_items(id),
  kind              text not null check (kind in ('waste', 'count')),
  quantity_change   numeric not null,   -- signed: waste is negative, a count is counted minus expected
  expected_stock    numeric not null,   -- current_stock just before this entry
  counted_stock     numeric,            -- what was on the shelf; counts only
  reason            text,               -- required for waste and for a count that doesn't match
  note              text,
  staff_id          integer references staff(id),
  created_at        timestamptz not null default now(),
  check ((kind = 'count') = (counted_stock is not null)),
  check (kind <> 'waste' or (quantity_change < 0 and reason is not null)),
  check (kind <> 'count' or quantity_change = 0 or reason is not null)
);

-- The latest AI summary, so reopening the dashboard doesn't call the model
-- again. Only ever one row: there's one cafe and only the latest summary matters.
create table if not exists insight_summary_cache (
  id            integer primary key default 1 check (id = 1),
  summary       text not null,
  generated_at  timestamptz not null default now()
);

create index if not exists idx_order_lines_order_id on order_lines(order_id);
create index if not exists idx_order_lines_menu_item_id on order_lines(menu_item_id);
create index if not exists idx_orders_created_at on orders(created_at);
create index if not exists idx_stock_entries_inventory_item_id on stock_entries(inventory_item_id);
create index if not exists idx_menu_option_groups_menu_item_id on menu_option_groups(menu_item_id);
create index if not exists idx_menu_options_group_id on menu_options(group_id);
create index if not exists idx_order_line_options_order_line_id on order_line_options(order_line_id);
create index if not exists idx_order_line_options_option_id on order_line_options(option_id);
create index if not exists idx_stock_adjustments_item_created on stock_adjustments(inventory_item_id, created_at);
