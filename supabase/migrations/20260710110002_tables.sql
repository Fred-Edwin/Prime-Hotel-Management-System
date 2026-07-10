-- ============================================================
-- USERS
-- Mirrors auth.users (Supabase-managed). This table holds the
-- business-specific fields Supabase Auth doesn't.
-- ============================================================

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  staff_code text not null unique,   -- short auto-generated code (e.g. "04"), disambiguates duplicate names at login; also used to build the synthetic auth email -- see auth note below
  role user_role not null default 'staff',
  location location_type,  -- null for admin (admin sees both locations)
  is_store_manager boolean not null default false,  -- UI flag only, see 00_ARCHITECTURE.md §5.1 -- NOT a permission tier, no RLS depends on this
  created_at timestamptz not null default now()
);

-- Auth note: Supabase Auth requires an email + password internally.
-- We generate a synthetic internal email of the form
--   user-{staff_code}@prosper.internal
-- and use the PIN as the password. The person never sees this email --
-- the login UI only ever shows Name (+ staff code where names collide)
-- and a PIN field. See lib/auth.ts.

-- ============================================================
-- ITEMS
-- Single shared item master. No per-location duplication.
-- ============================================================

create table public.items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category item_category not null,
  supply_type item_supply_type not null default 'restaurant_only',  -- see §3.1
  buying_price numeric(10,2) not null check (buying_price >= 0),
  selling_price numeric(10,2) not null check (selling_price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index items_active_idx on public.items (active);
create index items_category_idx on public.items (category);
create index items_supply_type_idx on public.items (supply_type);

create trigger items_set_updated_at
  before update on public.items
  for each row execute function public.set_updated_at();

-- ============================================================
-- INGREDIENTS
-- Raw materials (flour, sugar, cooking oil, ...) held at the
-- central store. Never sold directly to a customer -- only
-- consumed in cooking to produce sellable `items`. See §3.2.
-- ============================================================

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null,   -- free-text unit of measure, e.g. "kg", "litre", "bag" -- see §3.2 for why this isn't an enum
  buying_price numeric(10,2) not null check (buying_price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ingredients_active_idx on public.ingredients (active);

create trigger ingredients_set_updated_at
  before update on public.ingredients
  for each row execute function public.set_updated_at();

-- ============================================================
-- INGREDIENT_ENTRIES
-- One row per ingredient, per entry_date, at the central store.
-- Always daily, regardless of the restaurant/canteen cadence
-- split elsewhere -- cooking happens every day. Logged by the
-- store manager only (see §3.2), never by regular staff.
-- ============================================================

create table public.ingredient_entries (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients(id),
  entry_date date not null,

  opening_stock numeric(10,2) not null default 0,   -- system-populated, carried from yesterday's closing -- see §3.1
  received numeric(10,2) not null default 0,        -- delivered by supplier that day, manually entered
  quantity_used numeric(10,2) not null default 0,   -- consumed in cooking that day, manually entered
  wastage numeric(10,2) not null default 0,         -- spoiled before use, e.g. vegetables going bad -- see §3.3
  wastage_note text,                                -- optional free-text reason, see §3.3

  -- snapshotted at time of entry, same rationale as stock_entries price snapshots
  buying_price_snapshot numeric(10,2) not null,

  -- calculated, stored (not generated columns -- see CLAUDE.md)
  closing_stock numeric(10,2) not null,       -- opening + received - quantity_used - wastage
  closing_stock_value numeric(10,2) not null, -- closing_stock * buying_price_snapshot
  wastage_value numeric(10,2) not null,       -- cash value of wasted ingredient -- see §3.3

  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (ingredient_id, entry_date)
);

create index ingredient_entries_date_idx on public.ingredient_entries (entry_date);
create index ingredient_entries_ingredient_idx on public.ingredient_entries (ingredient_id);

create trigger ingredient_entries_set_updated_at
  before update on public.ingredient_entries
  for each row execute function public.set_updated_at();

-- ============================================================
-- STOCK_ENTRIES
-- One row per item, per location, per entry_date.
-- closing_stock / sales_value / cost_value / closing_stock_value
-- are calculated at write time by application logic (Route
-- Handler), not by a live SQL formula column -- see
-- 00_ARCHITECTURE.md rationale for
-- why we snapshot rather than reference items.selling_price live.
--
-- IMPORTANT: opening_stock is NOT a freely-typed field. It is
-- carried forward from the prior period's closing_stock for the
-- same item+location (yesterday's close, for restaurant; last
-- week's close, for canteen). See §3.1 and 00_ARCHITECTURE.md §10
-- for the full rule and why this replaces the old Excel habit of
-- hand-copying yesterday's numbers.
-- ============================================================

create table public.stock_entries (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id),
  location location_type not null,
  entry_date date not null,

  opening_stock numeric(10,2) not null default 0,   -- system-populated, see note above
  added_stock numeric(10,2) not null default 0,     -- restaurant: menu items produced that day and kept on the floor (see §3.2, NOT a supplier delivery); canteen: see §3.1 sourcing rule
  sent_out numeric(10,2) not null default 0,        -- restaurant->canteen transfer; 0 for canteen rows

  -- Till sales only (the stepper flow, Phase 4). NOT the total sold --
  -- see §3.4. Written only by the stock-entries upsert, never touched
  -- by the orders write-path.
  till_quantity_sold numeric(10,2) not null default 0,

  -- Total sold = till_quantity_sold + sum(order_items for this item/
  -- location/date). Stored (not a generated column, per
  -- see CLAUDE.md) and recomputed by the same increment
  -- function both write-paths call -- see §3.4. Never written directly
  -- by either the stock-entries route or the orders route.
  quantity_sold numeric(10,2) not null default 0,

  wastage numeric(10,2) not null default 0,         -- spoiled/discarded, not sold and not sent out -- see §3.3
  wastage_note text,                                -- optional free-text reason, see §3.3

  -- snapshotted prices at time of entry (see rationale above)
  selling_price_snapshot numeric(10,2) not null,
  buying_price_snapshot numeric(10,2) not null,

  -- calculated, stored (not generated columns -- see CLAUDE.md)
  closing_stock numeric(10,2) not null,
  sales_value numeric(10,2) not null,
  cost_value numeric(10,2) not null,
  closing_stock_value numeric(10,2) not null,  -- cash value of unsold stock -- see §3
  wastage_value numeric(10,2) not null,        -- cash value of wasted stock -- see §3.3

  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (item_id, location, entry_date)
);

create index stock_entries_location_date_idx on public.stock_entries (location, entry_date);
create index stock_entries_item_idx on public.stock_entries (item_id);

create trigger stock_entries_set_updated_at
  before update on public.stock_entries
  for each row execute function public.set_updated_at();

-- ============================================================
-- EXPENSES
-- Kept separate from items/stock -- these are operating costs,
-- not inventory. This is the direct fix for the client's
-- original "can't calculate true profit per plate" pain point.
-- ============================================================

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  location location_type not null,
  expense_date date not null,
  category expense_category not null,
  amount numeric(10,2) not null check (amount >= 0),
  note text,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);

create index expenses_location_date_idx on public.expenses (location, expense_date);

-- ============================================================
-- DELIVERY_LOCATIONS
-- Admin-managed catalog of delivery zones and their fixed fees.
-- Staff pick a zone per order rather than typing a fee -- see §6.
-- ============================================================

create table public.delivery_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,             -- e.g. "Estate A", "Ridgeways"
  fee numeric(10,2) not null check (fee >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index delivery_locations_active_idx on public.delivery_locations (active);

create trigger delivery_locations_set_updated_at
  before update on public.delivery_locations
  for each row execute function public.set_updated_at();

-- ============================================================
-- ORDERS / ORDER_ITEMS
-- Replaces the client's WhatsApp-coordinated delivery process --
-- see §6 for the full rationale. An order deducts from the same
-- day's stock_entries.quantity_sold via the increment function in
-- §3.4 (NOT a direct UPDATE from client-submitted totals); it is a
-- second write-path into the existing stock ledger, not a separate
-- untracked record.
--
-- client_request_id exists purely to make order submission
-- idempotent -- see §3.4 "Duplicate-submission protection". A
-- double-tap on "Save order" (flaky network, no visible response)
-- must not create two orders and double-deduct stock.
-- ============================================================

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  location location_type not null,
  order_date date not null,
  customer_name text not null,
  fulfillment_type order_fulfillment_type not null,
  delivery_location_id uuid references public.delivery_locations(id),  -- null for pickup
  delivery_fee_snapshot numeric(10,2) not null default 0,  -- snapshotted from delivery_locations.fee at write time, same rationale as price snapshots elsewhere
  total_amount numeric(10,2) not null,  -- sum(order_items) + delivery_fee_snapshot, calculated in lib/calculations.ts
  client_request_id uuid not null,  -- generated once by the client per submit attempt; same value resent on retry -- see §3.4
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),

  unique (created_by, client_request_id)  -- makes retried submissions a no-op, see §3.4
);

create index orders_location_date_idx on public.orders (location, order_date);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  item_id uuid not null references public.items(id),
  quantity numeric(10,2) not null check (quantity > 0),
  selling_price_snapshot numeric(10,2) not null  -- same snapshot rationale as stock_entries
);

create index order_items_order_idx on public.order_items (order_id);
create index order_items_item_idx on public.order_items (item_id);
