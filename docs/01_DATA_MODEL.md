# Prosper Hotel Management System — Data Model

> Read `00_ARCHITECTURE.md` first if you haven't. This file is the single source of truth for the database schema. If application code and this file disagree, this file wins — update the code, or update this file explicitly and note why in the current phase's `docs/phases/phaseX_context.md` (see `CLAUDE.md`).

---

## 1. Entity overview

```
users               — staff and admin accounts (mirrors Supabase Auth users, plus role/location)
items               — shared item master of SELLABLE menu items (one list, used by both locations)
stock_entries       — daily stock movement per sellable item, both locations
ingredients         — raw material catalog (flour, sugar, etc.) — never sold directly, only consumed
ingredient_entries   — daily central-store movement per ingredient (received, used in cooking)
ingredient_purchases — append-only log of buying events (quantity, actual unit cost, who, when) — see §3.2
expense_categories  — admin-managed catalog of expense category names (rent, electricity, ...) — see §2's EXPENSE_CATEGORIES section
expenses            — operating costs, kept separate from stock/items
staff_meal_entries  — self-service log of menu items staff consumed without paying, attributed per staff member (see §3.5)
delivery_locations  — admin-managed catalog of delivery zones + fixed fees (see §6)
orders              — customer delivery/pickup orders, replaces the client's WhatsApp-coordinated process (see §6)
order_items         — line items per order (see §6)
audit_log           — admin-read-only trail of sensitive admin actions; first pass covers Staff edit/deactivate/reactivate/PIN-reset only (see §2's audit_log section)
app_settings        — single-row, admin-editable business-wide settings; currently just estimated_cost_ratio (see §3.11)
```

Do not add tables speculatively beyond what's listed here (e.g., a generic `locations` table for restaurant/canteen — see §5 for why). `delivery_locations`/`orders`/`order_items` were added deliberately, after initial planning, per direct client input (see §6) — not a speculative addition.

**Why ingredients are a separate concept from items** (see §3.2 for the full flow): the central store receives raw ingredients from suppliers, which the kitchen consumes in cooking to produce finished menu items — sold on the restaurant floor or sent to canteen. An ingredient (flour) and a dish (Chapati) are structurally different things: one is consumed, one is sold; one only has a cost, the other has both a cost and a selling price. Forcing them into one table would mean a meaningless `selling_price` on every ingredient row. The client only has a **rough, informal sense** of how much flour becomes how many Chapatis — V1 deliberately does **not** model a formal recipe/conversion ratio between the two. Ingredient stock and dish production are tracked side by side, not mathematically linked — see §3.2.

---

## 2. Full SQL schema

```sql
-- ============================================================
-- ENUMS
-- ============================================================

create type user_role as enum ('admin', 'staff');
create type location_type as enum ('restaurant', 'canteen');
create type item_category as enum (
  'beverages', 'snacks', 'meals', 'fruits', 'cyber', 'retail', 'ingredients',
  -- Added Phase 8 (supabase/migrations/20260713120000_add_item_categories.sql)
  -- when seeding the client's real catalog (hotel-menu-items.json /
  -- canteen-items.json) surfaced canteen categories the original 7 values
  -- didn't cover. Kept as distinct values rather than collapsed into
  -- 'retail', per explicit client/user decision.
  'stationery', 'dawa', 'sweets', 'biscuits', 'packing_supplies', 'others'
);
create type expense_category as enum ('electricity', 'gas', 'charcoal', 'other');

-- Distinguishes how an item flows between the two locations.
-- See §3.1 for why this exists -- the restaurant's central store
-- supplies a SUBSET of items to canteen daily; canteen also stocks
-- its own items (cyber, some retail) that never touch the restaurant.
create type item_supply_type as enum (
  'restaurant_only',       -- never appears on canteen's sheet
  'canteen_supplied',      -- restaurant sends this to canteen; restaurant logs sent_out daily
  'canteen_independent'    -- canteen stocks/sells this on its own; restaurant never touches it
);

-- ============================================================
-- updated_at TRIGGER
-- Every table below with an `updated_at` column gets this trigger
-- attached. Without it, `updated_at` is just a column app code has
-- to remember to set on every UPDATE -- an implicit contract that
-- silently breaks the first time a future session forgets. Attach
-- once here, forget about it everywhere else.
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

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
  -- Added Phase 9 (supabase/migrations/20260713221946_users_active_soft_deactivate.sql):
  -- soft-deactivate flag, same pattern as items/ingredients/delivery_locations'
  -- `active` column (§5). Hard-delete is unsafe here -- no ON DELETE
  -- CASCADE/SET NULL exists from stock_entries.created_by /
  -- ingredient_entries.created_by / expenses.created_by / orders.created_by,
  -- so removing a users row would either fail on the FK or (if that were
  -- ever loosened) silently orphan historical entries' attribution. A
  -- deactivated account can no longer log in (checked in
  -- app/api/auth/login/route.ts before the Supabase Auth sign-in attempt,
  -- same generic "Name or PIN is incorrect" message as a wrong PIN so a
  -- deactivated staff member can't distinguish the two by probing), but
  -- every past entry they created keeps its correct attribution untouched.
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Auth note: Supabase Auth requires an email + password internally.
-- We generate a synthetic internal email of the form
--   user-{staff_code}@prosper.internal
-- and use the PIN as the password. The person never sees this email --
-- the login UI only ever shows Name (+ staff code where names collide)
-- and a PIN field. See `04_PHASE_PLAN.md` Phase 2 for the concrete implementation.
--
-- PIN length note (Phase 9): Supabase Auth's minimum_password_length (6,
-- see supabase/config.toml, mirrored in the production project) is
-- enforced by admin.updateUserById() (used by the Phase 9 admin PIN-reset
-- feature) but NOT by admin.createUser() (used by staff creation and
-- scripts/seed-staff.ts) -- an asymmetry discovered while building PIN
-- reset. lib/validation.ts's staffCreateSchema/staffPinResetSchema both
-- require exactly 6 digits to match the real, enforced constraint and
-- fail fast with a clear message rather than a confusing 500 from the
-- Auth layer. loginSchema (validating login *input shape*, not creating a
-- credential) deliberately stays a looser 4-6 digit range so it still
-- accepts any already-existing PIN, including dev seed data's legacy
-- 4-digit convention.

-- ============================================================
-- ITEMS
-- Single shared item master. No per-location duplication.
--
-- Items support a real, permanent DELETE as of 2026-07-21 (post-launch
-- client request) -- see "Item hard delete" below the schema block, and
-- delete_item()/item_delete_impact() in
-- supabase/migrations/20260721080000_item_hard_delete.sql. Deactivate
-- (the `active` flag below) remains available and is the safer default
-- for most cases; delete is for when the admin genuinely wants the item
-- and its history gone. (ingredients/delivery_locations/expense_categories
-- gained the same real-delete capability post-launch, 2026-07-23 -- see
-- §5 for the full current picture across the catalog.)
-- ============================================================

create table public.items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category item_category not null,
  supply_type item_supply_type not null default 'restaurant_only',  -- see §3.1
  buying_price numeric(10,2) not null check (buying_price >= 0),
  selling_price numeric(10,2) not null check (selling_price >= 0),
  -- Added Phase 7 (supabase/migrations/20260712120000_low_stock_threshold.sql):
  -- a stock_entries row's closing_stock at or below this value surfaces the
  -- item on the admin dashboard's "Needs attention" section. Admin-editable
  -- on the existing Item Master screen (Phase 3). Was NOT part of the
  -- original schema -- the PRD only described "low stock" qualitatively
  -- (§4.6), with no threshold field to source it from. Defaults to 5.
  low_stock_threshold numeric(10,2) not null default 5 check (low_stock_threshold >= 0),
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
-- ITEM HARD DELETE (post-launch, 2026-07-21)
--
-- A deliberate, explicit exception to §5's "no hard delete" rule,
-- confirmed directly and twice with the client before being built:
-- deleting an item with real history also permanently deletes every
-- stock_entries/order_items (and any order left with no
-- items)/canteen_stock_purchases/staff_meal_entries row that references
-- it, which changes already-closed days' Ledger/dashboard/profit
-- figures retroactively -- the opposite of every other "never rewrite
-- history" guarantee in this schema (price snapshots, no soft-delete on
-- stock_entries/expenses, immutable purchases). ingredients/
-- delivery_locations/expense_categories were extended to the same
-- pattern post-launch, 2026-07-23, each with its own separate explicit
-- client confirmation (see §5) -- this was NOT assumed to extend
-- automatically; each table required asking again.
--
-- DELETE RLS policies (admin-only, no equivalent for staff) added on:
-- items, stock_entries, canteen_stock_purchases, staff_meal_entries,
-- order_items, orders. None of these tables had any delete policy
-- before this -- all were previously either update-only (admin
-- corrections) or fully append-only.
--
-- item_delete_impact(p_item_id) -- read-only, security invoker. Counts
-- and total value of everything a delete would remove: stock_entries
-- rows + their summed sales_value, orders touched (and how many of
-- those would be deleted outright vs. just recalculated),
-- canteen_stock_purchases rows + total_cost, staff_meal_entries count.
-- GET /api/items/[id]/delete-impact surfaces this to the confirm modal
-- BEFORE the admin commits to deleting -- resolved design decision:
-- show real numbers, not a generic "this can't be undone" warning, so
-- the retroactive effect isn't a surprise after the fact.
--
-- delete_item(p_item_id) -- security invoker, so the DELETE policies
-- above are the real enforcement. In order:
--   1. Deletes staff_meal_entries, canteen_stock_purchases, and
--      stock_entries for the item -- no further correction needed for
--      any of these three, they're independent per-item ledgers.
--   2. For every order that has an order_items line for this item:
--      deletes that line, then either deletes the whole order (if it
--      had no other lines -- an orphaned receipt with a stale
--      total_amount is worse than no receipt) or recomputes
--      orders.total_amount from its remaining lines
--      (sum(quantity * selling_price_snapshot) + delivery_fee_snapshot,
--      the same formula lib/calculations.ts's orderTotal() applies at
--      write time, reapplied here as a direct correction).
--   3. Deletes the items row itself.
-- All in one transaction (one function call) -- a partial cascade
-- (e.g. stock_entries gone but the item row still present) can never be
-- observed.
--
-- DELETE /api/items/[id] calls delete_item() and writes an item.delete
-- audit_log entry recording the deleted item's full row plus the
-- impact-preview numbers, since after the delete the row itself is
-- gone and can't be inspected later -- the audit log is the only
-- remaining record of what was deleted and why it mattered.
-- ============================================================

-- ============================================================
-- INGREDIENTS
-- Raw materials (flour, sugar, cooking oil, ...) held at the
-- central store. Never sold directly to a customer -- only
-- consumed in cooking to produce sellable `items`. See §3.2.
-- Supports a real hard delete as of 2026-07-23 -- see "INGREDIENT
-- HARD DELETE" below the ingredient_entries schema block, and §5.
-- ============================================================

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null,   -- free-text unit of measure, e.g. "kg", "litre", "bag" -- see §3.2 for why this isn't an enum
  buying_price numeric(10,2) not null check (buying_price >= 0),
  -- Added Phase 8 (supabase/migrations/20260713110000_ingredient_low_stock_threshold.sql):
  -- mirrors items.low_stock_threshold (Phase 7) -- previously
  -- dashboard_low_stock_ingredients() used a shared hardcoded default-5
  -- constant for every ingredient; now a real, admin-editable per-row value.
  low_stock_threshold numeric(10,2) not null default 5 check (low_stock_threshold >= 0),
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
-- INGREDIENT_PURCHASES
-- Append-only log of buying events -- see "Purchases: who buys,
-- who receives, and how the cost is derived" below, and
-- 00_ARCHITECTURE.md §13 for the architectural commitment.
-- ============================================================

create table public.ingredient_purchases (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients(id),
  purchase_date date not null,
  quantity numeric(10,2) not null check (quantity > 0),
  unit_cost numeric(10,2) not null check (unit_cost >= 0),
  total_cost numeric(10,2) not null,  -- quantity * unit_cost, stored not generated -- see CLAUDE.md
  supplier_note text,                 -- optional free-text, mirrors expenses.note / wastage_note convention

  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now()

  -- No updated_at / update trigger: purchases are immutable once logged,
  -- see "no update/delete policy" note below.
);

create index ingredient_purchases_date_idx on public.ingredient_purchases (purchase_date);
create index ingredient_purchases_ingredient_idx on public.ingredient_purchases (ingredient_id);

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
-- same item+location (yesterday's close, for both restaurant and
-- canteen). See §3.1 and 00_ARCHITECTURE.md §10 for the full rule
-- and why this replaces the old Excel habit of hand-copying
-- yesterday's numbers.
-- ============================================================

create table public.stock_entries (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id),
  location location_type not null,
  entry_date date not null,

  opening_stock numeric(10,2) not null default 0,   -- system-populated, see note above
  added_stock numeric(10,2) not null default 0,     -- restaurant: menu items produced that day and kept on the floor (see §3.2, NOT a supplier delivery); canteen: see §3.1 sourcing rule
  sent_out numeric(10,2) not null default 0,        -- restaurant->canteen transfer; 0 for canteen rows

  -- Till sales only (the stepper flow, `04_PHASE_PLAN.md` Phase 4). NOT the total sold --
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
-- EXPENSE_CATEGORIES
-- Admin-managed category catalog (post-launch addition, 2026-07-21, see
-- 20260721090000_expense_categories_catalog.sql) -- replaces the fixed
-- expense_category enum (electricity/gas/charcoal/other). WaPrecious
-- can add/rename/retire her own categories (rent, salaries, water, ...)
-- through the UI, `active` boolean for the routine case. As of
-- 2026-07-23 it also supports a real hard delete -- see "EXPENSE
-- CATEGORY HARD DELETE" below the schema block, and §5.
-- One shared catalog: both staff's /expenses and admin's
-- /dashboard/expenses category pickers read the same table, so a
-- category WaPrecious adds shows up for staff too.
-- ============================================================

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index expense_categories_active_idx on public.expense_categories (active);

-- ============================================================
-- EXPENSES
-- Kept separate from items/stock -- these are operating costs,
-- not inventory. This is the direct fix for the client's
-- original "can't calculate true profit per plate" pain point.
--
-- location is nullable (post-launch addition, 2026-07-21, see
-- 20260721070000_admin_business_wide_expenses.sql): null = a
-- business-wide expense (rent, salaries, etc.) that isn't attributable
-- to either location -- only admin can write a null-location row, same
-- "null = admin/all locations" convention already used on
-- public.users.location. Staff-authored rows are always non-null,
-- server-derived from the staff member's own session.
--
-- category_id is a live FK into expense_categories (post-launch
-- addition, 2026-07-21, replacing the old `category` enum column) --
-- same "live reference, not a snapshot" choice as stock_entries.item_id:
-- a category's *name* isn't snapshotted onto each expense row, so
-- renaming "Charcoal" to "Fuel" relabels every past entry consistently,
-- the same way renaming an item still shows its new name on old
-- stock_entries rows. (Contrast with prices, which ARE snapshotted --
-- see items/stock_entries -- because a price change must NOT silently
-- change a past day's recorded profit; a category rename carries no
-- such risk, it's just a label.)
-- ============================================================

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  location location_type,  -- null = business-wide, admin-only
  expense_date date not null,
  category_id uuid not null references public.expense_categories(id),
  amount numeric(10,2) not null check (amount >= 0),
  note text,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);

create index expenses_location_date_idx on public.expenses (location, expense_date);
create index expenses_category_id_idx on public.expenses (category_id);

-- ============================================================
-- DELIVERY_LOCATIONS
-- Admin-managed catalog of delivery zones and their fixed fees.
-- Staff pick a zone per order rather than typing a fee -- see §6.
-- Supports a real hard delete as of 2026-07-23 -- see "DELIVERY
-- LOCATION HARD DELETE" below the schema block, and §5.
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

create type order_fulfillment_type as enum ('delivery', 'pickup');

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

-- ============================================================
-- AUDIT LOG
-- Post-launch addition (docs/backlog/03_audit_log.md). First pass
-- scoped to Staff edit/deactivate/PIN-reset only (app/api/staff/[id]/
-- route.ts, app/api/staff/[id]/pin/route.ts) -- not a blanket trigger
-- on every table. Written via an explicit shared helper
-- (lib/audit.ts's writeAuditLog(), which calls the write_audit_log()
-- function below) rather than a database trigger, matching how this
-- codebase already centralizes logic (lib/calculations.ts) instead of
-- hiding it in trigger bodies. See §4 for why writes are restricted
-- to this one function, including for the admin role.
-- ============================================================

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.users(id) on delete restrict,
  action text not null,              -- e.g. 'staff.edit', 'staff.deactivate', 'staff.reactivate', 'staff.pin_reset'
  target_table text not null,        -- e.g. 'users'
  target_id uuid not null,
  changes jsonb,                     -- {before, after} snapshot where applicable; null for pin_reset (never logs the PIN itself)
  created_at timestamptz not null default now()
);

create index audit_log_target_idx on public.audit_log (target_table, target_id);
create index audit_log_actor_idx on public.audit_log (actor_id);
create index audit_log_created_at_idx on public.audit_log (created_at desc);
```

---

## 3. Calculation rules (implement once, in one place)

These must live in a single shared function/module (see `CLAUDE.md`'s Project Structure section → `lib/calculations.ts`), called from the Route Handler that writes `stock_entries`. Never re-implement this math in more than one place.

```
total_stock          = opening_stock + added_stock
quantity_sold        = till_quantity_sold + sum(order_items.quantity for this item/location/date)
staff_meals          = sum(staff_meal_entries.quantity for this item/location/date) -- see §3.5
closing_stock        = total_stock - sent_out - quantity_sold - wastage - staff_meals
sales_value          = quantity_sold * selling_price_snapshot
cost_value           = quantity_sold * buying_price_snapshot
closing_stock_value  = closing_stock * buying_price_snapshot
wastage_value        = wastage * buying_price_snapshot
staff_meal_value     = staff_meals * buying_price_snapshot -- see §3.5; a DISTINCT figure from wastage_value, never folded into it
```

`quantity_sold` is never written directly by either write-path (till entry or orders) — it's always recomputed from `till_quantity_sold` plus the order total, atomically, by whichever of `save_stock_entry()`/`save_canteen_stock_entry()`/`apply_order_to_stock_entry()` the caller invokes (Phase 4-6; see §3.4's implementation note for why these replaced the originally-planned `recalculate_stock_entry()`), so the two flows can't race and overwrite each other. See §3.4 for the full rationale — this line only exists in this schema because delivery orders (§6) were added after the original design, and "one row, two writers" needed an explicit answer.

`total_stock` itself is **not stored** — it's derivable and only used momentarily during entry/validation. Storing it would be redundant and risks drifting out of sync with its inputs (this is exactly the kind of duplication that caused the buying-price mismatches in the client's old Excel sheet — don't reintroduce that failure mode).

`wastage_value` is always costed at `buying_price_snapshot`, never `selling_price_snapshot` — wasted stock was never sold, so there's no revenue to value it at; the loss is what it cost to acquire/produce, not the margin that would have been made. See §3.3 for the full rationale on why wastage is tracked as a first-class figure rather than folded silently into closing stock.

`closing_stock_value` is the cash value of unsold inventory — it mirrors the "Value of Closing Stock" column WaPrecious already tracks by hand, and is a first-class figure on the admin dashboard (capital currently tied up in stock), not just an internal intermediate.

Per-row `cost_value` above (`quantity_sold * buying_price_snapshot`) is still the correct, unchanged figure for **item-level** questions — the Item Master profit-by-date-range column (§3.6) and the admin ledger both still use it, since "how profitable was this specific item" is a genuinely different question from "what did the whole business's stock movement cost this period." The admin **dashboard's** top-line COGS is a separate, period-level calculation layered on top of these same rows — see §3.8.

**Validation rule**: reject a write where `sent_out + quantity_sold + wastage + staff_meals > total_stock` (can't sell/send/waste/eat more than you have). Surface this as a clear inline error, not a silent clamp. Same rule applies to `ingredient_entries`: reject `quantity_used + wastage > opening_stock + received` (staff meals are a `stock_entries`-only concept — ingredients are consumed in cooking, never eaten directly by staff, see §3.2).

Because `quantity_sold` now has two contributors (§3.4), this check must run **after** `public.recalculate_stock_entry()` recomputes the combined total, inside the same transaction — not against just the field the current write-path is touching. A till save that would push the *combined* total over `total_stock` must be rejected even if `till_quantity_sold` alone looks fine, and the same for an order that would push it over given the existing `till_quantity_sold`. Either write-path can be the one that tips it over; the check has to see the whole picture, not just its own contribution.

---

## 3.1 Opening stock carry-forward and the restaurant→canteen supply chain

This section exists because the old Excel workflow's two most time-consuming manual habits — re-copying yesterday's leftover count, and manually reconciling what the store sent to canteen — must be eliminated by the system, not preserved as manual data entry. Getting this wrong reintroduces exactly the busywork this product exists to remove.

### Opening stock is never freely typed

For a given item + location, `opening_stock` on a new entry is **auto-populated from the immediately prior period's `closing_stock`** for that same item + location:

- **Both restaurant and canteen (daily, as of the 2026-07-20 daily-cadence conversion — see below):** today's `opening_stock` = yesterday's `closing_stock`.
- **First-ever entry for an item** (no prior row exists for that item+location): `opening_stock` defaults to `0`, or an admin can set an explicit initial count when introducing a new item mid-operation (a one-time correction, not a recurring input).
- Staff can still see the value on the entry screen (it's meaningful context), but it is **not an editable input field** in the normal flow — the whole point is that nobody re-types it. If a correction is genuinely needed (a miscount was carried forward), that's an admin-level edit to the historical row, per the existing "staff can't edit past entries" RLS rule.

### Canteen's `added_stock` is a same-day mirror of the restaurant's `sent_out`

**Post-launch conversion (2026-07-20):** canteen originally tracked stock weekly — every write normalized `entry_date` to that week's Monday, and a canteen entry's `added_stock` for a `canteen_supplied` item was the *sum* of the restaurant's daily `sent_out` figures across all seven days of that week. This caused real, confirmed client confusion (WaPrecious expected canteen's `opening_stock` to carry over day to day like restaurant's does, but under the weekly model it only updated once every 7 days) and a real defect (the admin dashboard's "Today" period toggle silently showed canteen as zero stock movement on every non-Monday day). **Canteen now converts to daily, matching restaurant's shape exactly** — see `docs/phases/postlaunch_canteen_daily_context.md` for the full change record.

- Only items with `supply_type = 'canteen_supplied'` (see §2 `items.supply_type`) participate in this flow. `restaurant_only` items never appear on canteen's sheet at all; `canteen_independent` items (e.g. cyber, some retail lines) are entirely canteen's own stock with no restaurant-side row ever.
- For a canteen daily entry on date D, `added_stock` for each `canteen_supplied` item = the restaurant's `sent_out` for that item on that **same calendar day** D — a same-day 1:1 mirror, not a week-range sum.
- This is a genuine **cross-location read**: canteen staff need to see a figure from restaurant data they otherwise have no access to under the location-scoped RLS in §4. The read must be scoped narrowly — canteen can see the **`sent_out` figure only**, not the restaurant's full stock_entries rows (not opening/closing stock, not sales, not other items). Implemented as a `security definer` function, `public.canteen_supplied_total(item_id, p_week_start, p_week_end)` — the parameter names are a naming holdover from the weekly-era implementation, not a hint that it still sums a range; every caller now passes a same-day range (`p_week_start = p_week_end = the target date`), which collapses the function's `sum()` to at most one row. See §4 for the concrete function.
- Canteen's `added_stock` is therefore also **not freely typed** for `canteen_supplied` items — it's system-populated the same way `opening_stock` is, for the same reason. It remains a normal editable input for `canteen_independent` items, since those have no restaurant-side source to pull from.

**Historical rows are frozen, not migrated.** Existing canteen `stock_entries` rows dated to a past Monday (each representing what was, at the time, a whole week's movement) were left exactly as they are — no `UPDATE`/backfill/split was run against them. Only new writes from 2026-07-20 onward use a real daily `entry_date`. A canteen item's row history may therefore contain a genuine mix: old rows dated only to past Mondays, and new rows dated to any real day. `recompute_stock_entry_chain()` (§3.4) treats each existing row as simply "the next period" regardless of the gap between rows, so this transition needs no special handling — don't build migration tooling for it.

### What this means for the entry screens (detail for `04_PHASE_PLAN.md` Phases 4–5)

- Restaurant staff never see or touch `opening_stock` as an input — it's a read-only context line ("Opening: 36").
- Restaurant's store manager manually enters `added_stock` and `sent_out` on the restaurant entry screen — but as of §3.2, `added_stock` here means "menu items produced today and kept on the restaurant floor," not a raw supplier delivery. Raw ingredient deliveries are tracked separately (§3.2).
- Canteen staff never type `opening_stock` or `added_stock` for `canteen_supplied` items — both are shown read-only, pulled from the carry-forward and same-day mirroring rules above. They do type `added_stock` for `canteen_independent` items, and `quantity_sold` for everything.

**Correction (post-launch client-reported bug fix, 2026-07-22):** the carry-forward rule above was correctly implemented in every *write*-path RPC (`save_stock_entry()` and friends, all deriving a brand-new row's `opening_stock` from `select closing_stock ... order by entry_date desc limit 1`), but `GET /api/stock-entries` — the route that renders the entry screen's initial page load — never did this lookup. It only fetched rows already saved *today*, so any item nobody had touched yet that day showed `opening_stock: 0` on-screen, even though real carried-forward stock existed. Client report: canteen's entry screen "not showing opening stock items." Hit canteen hardest (Anne's screen is usually untouched at the start of each day) but affected restaurant identically before the store manager's first save of the day. Fixed by adding the same carry-forward lookup to the `GET` handler, returned as a computed `opening_stock` map (keyed by `item_id`, not a real `stock_entries` column) alongside the existing `entries` array; `EntryClient.tsx`/`CanteenEntryClient.tsx` fall back to this map when no saved-today row exists yet. The identical bug also existed on `GET /api/ingredient-entries` (`/store`, §3.2) and was fixed the same way in the same pass.

---

## 3.2 The central store: ingredients in, menu items out

This section exists because an earlier draft of this model conflated two different things under "added_stock": raw ingredient deliveries, and finished menu items released to the restaurant floor. They are not the same event, and conflating them would have left WaPrecious with no visibility into ingredient stock at all — a real number she currently tracks by hand (how much flour, sugar, etc. is left) and a real cost input into what a plate actually costs to produce.

### The real flow

1. **Central store** holds raw ingredients — flour, sugar, cooking oil, and similar — received from suppliers. Tracked in `ingredients` + `ingredient_entries`, always **daily** (cooking happens every day regardless of the restaurant/canteen reporting cadence split elsewhere in this doc).
2. **Production (cooking)**: each day, the store manager records how much of each ingredient was **used** (`ingredient_entries.quantity_used`) — this is consumption, not a sale, and has no `sales_value` of its own.
3. That cooking produces some quantity of finished, sellable menu items (e.g., "40 Chapatis"). The store manager records this **directly as a plain quantity** — how many of each menu item are newly available today — with **no system-enforced formula** connecting ingredient quantity used to menu items produced.
4. Of that day's production, some portion is sent to canteen (`stock_entries.sent_out`, restaurant row) and the rest becomes the restaurant floor's `added_stock` for the day (`stock_entries.added_stock`, restaurant row) — this is the split described in §3.1's "restaurant→canteen supply chain," now correctly understood as a split of *today's kitchen output*, not of a supplier delivery.

### Deliberately no formal recipe/conversion ratio (V1)

The client has a **rough, informal sense** of how much of an ingredient becomes how many plates of a dish (e.g., "roughly 10kg flour → 40 Chapatis") but not a precise, enforced recipe. Building a bill-of-materials system that auto-calculates menu item output from ingredient usage would be over-engineering relative to what the client actually has and asked for. **Do not build this** unless explicitly requested later — it's a deliberate V1 omission, not an oversight (see §5).

Concretely, this means:
- `ingredient_entries.quantity_used` and `stock_entries.added_stock` (restaurant, that day) are **entered as two independent numbers** by the store manager. The system does not validate one against the other.
- WaPrecious still gets real value from this: ingredient stock-on-hand and its cash value (`ingredient_entries.closing_stock_value`) are visible on the dashboard/ledger, and menu item production/profit is tracked exactly as before. What's missing is only the automatic cross-check between the two — a reasonable, explicit trade-off given the client's own informal mental model.

### Who logs ingredient entries, and where

- **Store manager only, for `received`/`quantity_used`** — same person already responsible for `added_stock`/`sent_out` on the restaurant side. No new role; this is an extension of their existing daily responsibility, not a new permission tier (still just `is_store_manager = true` on a `staff` account, per `00_ARCHITECTURE.md` §5.1).
- Ingredient entry is a **separate screen/route** (`app/(staff)/store/page.tsx` — see `CLAUDE.md`'s Project Structure section), distinct from the daily menu-item entry screen. It is a structurally different ledger (one inflow — `received` — and one consumption path — `quantity_used` — versus items' opening/added/sent/sold shape), so it gets its own screen rather than being squeezed into `/entry` as a sub-section. It's still reachable from the same bottom nav, visible only to the store-manager-flagged user. As of the Phase 10 redesign, `/store` autosaves each field independently (`PUT /api/ingredient-entries`, one ingredient/one field per call) instead of a single batched daily save — see `00_ARCHITECTURE.md` §12 for why wastage is no longer part of this screen's payload.
- **`wastage`/`wastage_note` are NOT entered on `/store` as of the Phase 10 redesign** — see the correction in §3.3 below. `/store`'s per-field autosave (`PUT /api/ingredient-entries`) always writes `wastage: 0, wastage_note: null`. The older multi-line batch save (`POST /api/ingredient-entries` → `save_ingredient_entries_batch()`) still accepts `wastage` in its payload and remains available for any future admin-side wastage entry point, but nothing in the current UI calls it with a non-zero wastage value.

### Purchases: who buys, who receives, and how the cost is derived

Post-launch correction — see `00_ARCHITECTURE.md` §13 for the full architectural commitment; this subsection has the concrete mechanics. The original V1 model conflated "buying" with "receiving": `ingredient_entries.received` was a single typed-in quantity per day, priced from a static `ingredients.buying_price` catalog field nobody actually entered *at the moment of purchase*. The client's real process is different — **WaPrecious (admin) makes the purchase** (deals with the supplier, knows the actual price paid), while **the store manager physically receives the delivery** at the central store. Both roles need to be able to log a buying event, and the price genuinely varies purchase to purchase.

- **`ingredient_purchases` is append-only for everyone except admin correcting a genuine mistake** (schema above) — one row per buying event: `quantity`, `unit_cost` (this specific delivery's actual price, typed by whoever logs it), optional `supplier_note`, `created_by`, `created_at`. Still no *update* policy at all — a wrong price/quantity is corrected via a follow-up purchase, not edited in place. **Delete is admin-only** (post-launch addition, 2026-07-21, client request — see "Deleting a purchase" below) for the case where the row shouldn't have existed at all (wrong ingredient, duplicate entry), as distinct from a correction to an otherwise-legitimate purchase.
- **Both admin and the store manager can insert a purchase** — a deliberate, confirmed permission symmetry (unlike `quantity_used`, which stays store-manager-only, per "Who logs ingredient entries" above). Admin logs purchases on `/dashboard/purchases`; the store manager logs them via a "Log purchase" action on `/store`, which replaces the old plain "received" quantity field. Both call the same `record_ingredient_purchase()` function.
- **`record_ingredient_purchase(p_ingredient_id, p_purchase_date, p_quantity, p_unit_cost, p_created_by, p_supplier_note)`** is the single write path for both entry points:
  1. Locks the ingredient/date row (`lock_ingredient_entry_row()`, same advisory lock `save_ingredient_entry()` already uses) so two purchases landing for the same ingredient on the same day can't race each other's average-cost recalculation.
  2. Derives current quantity-on-hand: today's `opening_stock + received` if a row already exists for that date, otherwise the most recent prior day's `closing_stock`.
  3. Inserts the `ingredient_purchases` row.
  4. Recalculates `ingredients.buying_price` as a **weighted average**: `(qty_on_hand × old_avg + purchase_qty × purchase_unit_cost) ÷ (qty_on_hand + purchase_qty)`. This blends the new purchase's price into the existing average proportional to quantity — it does not simply replace the old price, which would misprice stock still on the shelf from an earlier, cheaper (or pricier) purchase. If there's no stock on hand yet, the new average is just this purchase's price. This is standard small-business inventory costing, not true per-batch FIFO — matching how WaPrecious already thinks about cost ("flour is about 120/kg right now"), not more precision than the business has ever tracked by hand.
  5. Calls `save_ingredient_entry()` with `received` incremented **additively** by the purchase quantity (never overwritten) and the fresh average as `buying_price_snapshot`, so `quantity_used`/`wastage` on that day's row are preserved exactly as `save_ingredient_entry()`'s existing "preserve, don't zero" convention already does for wastage (`20260717093000_preserve_wastage_on_stock_entry_save.sql`).
- **This also fixes a same-day data-loss bug in the old model**: `ingredient_entries` upserts one row per ingredient per day, so two purchases landing the same day (e.g. admin buys one delivery, the store manager receives a separate one later) would previously have had the second write silently clobber the first's `received` and `buying_price_snapshot`. Folding purchases in additively removes this failure mode entirely — every purchase is preserved as its own permanent `ingredient_purchases` row regardless of how many land on the same day.
- **`ingredient_entries.buying_price_snapshot` keeps its existing immutability guarantee** (see §3.4's "Admin direct ledger-row edit" note) — a historical day's snapshot is still never rewritten after the fact by anything except the admin ledger-edit route. Only the *source* of the price being snapshotted changed: a real computed running average instead of a static, manually-typed catalog field.
- **`ingredients.buying_price` remains manually editable by admin on `/ingredients` at any time** — a deliberate, confirmed override/correction path (e.g. fixing a fat-fingered unit cost), not removed by this change. It just now has a second, automatic writer (`record_ingredient_purchase()`) alongside the existing manual one.
- **`ingredients`' UPDATE RLS policy had to be widened, not just `ingredient_entries`/`ingredient_purchases`'s.** `record_ingredient_purchase()` is `security invoker` (this project's standing write-function convention), so its `update ingredients set buying_price = ...` runs as whichever user called it — a real bug shipped initially and caught by direct testing: `ingredients_admin_update` was admin-only, so a store-manager-logged purchase silently failed to update the catalog price (RLS matched zero rows, no error thrown — the purchase and `ingredient_entries.buying_price_snapshot` still saved correctly, masking the failure). Fixed in `20260719163000_ingredients_update_restaurant_scoped.sql` by widening the UPDATE policy to admin-or-restaurant-location, same shape as `ingredient_entries`/`ingredient_purchases`.
- **Stock-on-hand visibility** (quantity + current average cost + value, per ingredient) is a new read surfaced by `GET /api/ingredient-purchases`, powering `/dashboard/purchases` for admin — derived from each ingredient's latest `ingredient_entries.closing_stock` and current `buying_price`, not a new stored figure.

### Deleting a purchase (post-launch addition, 2026-07-21)

Client request (WaPrecious, via `/dashboard/purchases`): she needed to remove a purchase logged in error, not just correct its price going forward. A plain `DELETE` would leave two things silently wrong — `ingredients.buying_price` (a running weighted average the purchase already blended into) and that period's `ingredient_entries.received` (which the purchase's quantity was already folded into) — so this is a purpose-built reversal, not a generic delete. See `supabase/migrations/20260721060000_purchase_delete.sql`.

- **`DELETE /api/ingredient-purchases/[id]`, admin-only** — unlike logging a purchase (admin or store manager), removing one is an admin-only correction, matching the ledger admin-edit route's scope. Enforced at both the route (`requireAdmin()`) and RLS (`ingredient_purchases_delete_admin`, `for delete using (is_admin())`) — the new DELETE policy, no equivalent for staff/store-manager at all.
- **`delete_ingredient_purchase(p_purchase_id)`** — `security invoker`, so the DELETE RLS policy above is the real enforcement, not this function's own logic:
  1. Locks the ingredient/date row (`lock_ingredient_entry_row()`, same lock every other write to this row already takes).
  2. Deletes the `ingredient_purchases` row.
  3. Subtracts the purchase's `quantity` back out of that date's `ingredient_entries.received` (floored at 0), then calls `recompute_ingredient_entry_chain()` (§3.4's historical-edit-cascade machinery, unchanged, reused as-is) to re-derive `opening_stock`/`closing_stock`/values forward from that date. If this reveals a downstream oversell (e.g. more was already `quantity_used` than remains once the purchase's quantity is removed), the whole delete rolls back atomically — same guarantee an admin ledger edit gives.
  4. Calls `rebuild_ingredient_buying_price()`, which recomputes `ingredients.buying_price` from scratch by replaying every *remaining* `ingredient_purchases` row for that ingredient in chronological order through the same weighted-average formula `record_ingredient_purchase()` applies incrementally. This is a full replay, not an algebraic inverse of the single deleted purchase — inverting one step is only correct if no later purchase for the same ingredient already blended into the average, which can't be assumed in general (an admin might delete an older purchase, not just the most recent one). Purchase volume per ingredient is small for a single-business app, so a full replay is cheap.
- **Canteen sibling: `DELETE /api/canteen-purchases/[id]` / `delete_canteen_stock_purchase()`** — identical shape, `stock_entries.added_stock` (location = `canteen`) instead of `ingredient_entries.received`, `recompute_stock_entry_chain()` instead of the ingredient chain function, `rebuild_canteen_item_buying_price()` instead of the ingredient version. Also admin-only, matching that logging a canteen purchase is already admin-only (no store-manager-equivalent role at canteen).
- **Deliberately narrow, not a general "undo."** These two functions exist for exactly this one correction; they are not exposed as a reusable delete-any-row primitive, and no other append-only table (`orders`, `expenses`) gained a delete path from this change.

### Inline "add new" from the purchase form (post-launch addition, 2026-07-21)

Client request (WaPrecious): logging a purchase for something not yet in the catalog required leaving `/dashboard/purchases`, creating it on `/ingredients` or `/items` first, then coming back — an unnecessary detour for what's usually a one-off "I'm buying this for the first time" moment.

- **No new table or write path.** `PurchaseModal` (ingredients) and `CanteenPurchaseModal` (canteen-independent items) each gained a `forceNew` mode: opened via a dedicated **"Add new ingredient" / "Add new item"** button (above the Stock on hand table on both `/dashboard/purchases` tabs; above the ingredient list on `/store`), the modal skips straight to a blank form — **name + unit** for a new ingredient, **name + selling price** for a new canteen item (buying price/unit cost is already being typed as part of the purchase itself, so it isn't asked twice). Category for a new item defaults to `others` and `supply_type` is forced to `canteen_independent` (the only kind this modal ever purchases against); `low_stock_threshold` defaults to `5`, same as every other catalog-creation path. Logging a purchase for something that *already* exists keeps using the existing row-based entry point (`fixedIngredient`/`fixedItem`, opened from a specific stock-on-hand/store row) — the two are mutually exclusive modal modes, not one form trying to do both.
- **Superseded design, corrected same-day by direct client feedback (a screenshot of the live picker):** the first version of this feature put a `"+ Add new…"` option at the bottom of the modal's existing ingredient/item picker dropdown — meaning adding something new required scrolling past every already-catalogued ingredient/item first. The client's point was simple and correct: logging a purchase for something that already exists already has its own entry point (every stock-on-hand/store row already opens the modal knowing which one), so a *second*, page-level entry point had no reason to also be a picker — its only job is the "I'm adding something new" case. Replaced the picker (and the `ingredients`/`items` list props that fed it) with the `forceNew` boolean described above; removed the now-unused `Select`/`SelectOption` picker UI from both modal components entirely.
- **Submit order: create the catalog row first, then log the purchase against its new id** — a plain client-side two-step (`POST /api/ingredients` or `POST /api/items`, then the existing `POST /api/ingredient-purchases`/`POST /api/canteen-purchases`), not a new combined RPC. If the catalog-creation call fails, the purchase is never attempted — no risk of a purchase pointing at a row that doesn't exist.
- **`POST /api/ingredients` permission widened to match who can already log an ingredient purchase.** It was `requireAdmin()`-only; the store manager can log purchases (`canLogPurchases()` in `app/api/ingredient-purchases/route.ts`) but couldn't have used the inline "add new" path without this, since `PurchaseModal` is shared between admin's `/dashboard/purchases` and the store manager's `/store` screen. New `canCreateIngredient()` gate in `app/api/ingredients/route.ts` mirrors `canLogPurchases()` exactly (admin, or restaurant staff with `is_store_manager`). Editing/deactivating an ingredient on `/ingredients` itself stays admin-only, untouched.
- **`POST /api/items` unchanged (still `requireAdmin()`-only)** — `CanteenPurchaseModal` is admin-only end to end already (no store-manager-equivalent role at canteen), so there is no symmetry gap to fix there.
- **`ingredients`' INSERT RLS policy also had to be widened, not just the route handler.** Same class of bug as the UPDATE-policy fix already documented above (`20260719163000_ingredients_update_restaurant_scoped.sql`) — `ingredients_admin_write` was `for insert with check (is_admin())`, so a store-manager insert was rejected outright even after the route's own `canCreateIngredient()` check was widened. Caught by direct `curl` testing (login as Janiffer, `POST /api/ingredients`, got a 500), not assumed. Fixed the same way, in `20260721110000_ingredients_insert_restaurant_scoped.sql`: replaced `ingredients_admin_write` with `ingredients_admin_or_restaurant_insert` (`is_admin() or my_location() = 'restaurant'`).

### Canteen's own stock purchases (post-launch addition) — the same fix, for canteen_independent items

Direct client input: admin wanted the same "log a real purchase, get a real weighted-average cost" capability for canteen's own stock (`items.supply_type = 'canteen_independent'` — cyber, retail lines canteen buys and sells with no restaurant-side counterpart) that ingredients already got above. Before this, `canteen_independent` items' `added_stock` was just a plain number Anne typed on `/entry` each week (§3.1), with `items.buying_price` a static, admin-typed catalog field never actually tied to a real buying event — the exact problem `ingredient_purchases` fixed for ingredients, now recurring on the canteen side.

- **`canteen_stock_purchases` is a new, append-only table**, same shape as `ingredient_purchases`: one row per buying event (`item_id`, `quantity`, `unit_cost`, `total_cost`, optional `supplier_note`, `created_by`, `created_at`). No update policy — corrected operationally (a follow-up purchase), not edited in place, same convention as `orders`/`expenses`. Delete is admin-only, same post-launch addition as `ingredient_purchases` — see "Deleting a purchase" above.
- **Scoped to `canteen_independent` items only, enforced by a database trigger** (`check_canteen_stock_purchase_item()`), not just application-layer validation — a check-constraint-style rejection (errcode `23514`) fires if `item_id` doesn't reference a `canteen_independent` item. This is deliberate and load-bearing: `canteen_supplied` items' `added_stock` must only ever come from the restaurant's `sent_out`, aggregated via `canteen_supplied_total()` (§3.1) — letting admin also inject stock there via a purchase would double-count against that aggregation and break the single-source-of-truth guarantee the restaurant→canteen link depends on.
- **Admin-only**, both insert and select — unlike ingredient purchases, there is no store-manager-equivalent role at canteen who physically receives deliveries. WaPrecious is the only person who buys canteen's own stock, so this doesn't need ingredient purchases' admin-or-store-manager symmetry.
- **`record_canteen_stock_purchase(p_item_id, p_purchase_date, p_quantity, p_unit_cost, p_created_by, p_supplier_note)`** is the single write path, called from `/dashboard/canteen-purchases`:
  1. Confirms `item_id` is `canteen_independent` (defense in depth alongside the trigger above).
  2. Uses `p_purchase_date` as-is — the real date submitted, since the 2026-07-20 daily-cadence conversion (§3.1). **Before that conversion**, this step silently normalized whatever date the admin picked down to that week's Monday, discarding the real date server-side even though the client already sent it correctly — a real, user-visible bug, not just an internal calc detail. Historical purchase records made before the fix still show Monday dates (frozen, not backfilled, same principle as §3.1's frozen `stock_entries` rows) while new ones show real dates — a visible, if minor, inconsistency in the purchase history list, expected going forward.
  3. Locks the item/day's `stock_entries` row via `lock_stock_entry_row(item_id, 'canteen', purchase_day)` — the **same** advisory lock `save_stock_entry_canteen_field()` itself takes, so a purchase and a concurrent autosave from Anne's `/entry` screen touching the same item/day correctly serialize against each other, rather than racing.
  4. Derives quantity-on-hand (that day's `opening_stock + added_stock` if a row already exists, otherwise the prior day's `closing_stock`) and recalculates `items.buying_price` as a weighted average — identical formula to `record_ingredient_purchase()`.
  5. Calls `save_stock_entry_canteen_field()` with `added_stock` incremented **additively** by the purchase quantity (never overwritten) and the fresh average as `buying_price_snapshot`, `till_quantity_sold` omitted so it's preserved — reusing that function's existing oversell/lock/opening-stock logic rather than duplicating it, exactly how `record_ingredient_purchase()` reuses `save_ingredient_entry()`.
- **Stock-on-hand visibility** (quantity + current average cost + value, per `canteen_independent` item) is surfaced by `GET /api/canteen-purchases`, powering the "Canteen Stock" tab on `/dashboard/purchases` (a source-tab toggle alongside "Ingredients" on the same screen, not a separate route — the two datasets are structurally identical but never need to appear in the same table) — derived from each item's latest canteen `stock_entries.closing_stock` and current `buying_price`, same pattern as the ingredients tab.
- **`stock_entries.buying_price_snapshot`'s existing immutability guarantee is unchanged** — only the *source* of the price snapshotted for `canteen_independent` items changed, from a static catalog field to a real computed weighted average.

---

## 3.3 Wastage

Wastage is tracked at **both** stages — finished menu items (`stock_entries`) and raw ingredients (`ingredient_entries`) — because spoilage genuinely happens at both ends: vegetables and other ingredients can go bad before they're ever cooked, and prepared food can go unsold and spoil, or get dropped/broken, after production. This was originally scoped as a Phase 2 nice-to-have (see the old note in §5); it's now V1 scope per direct client input, since without it the numbers don't reconcile with a physical count.

**Correction (Phase 10, post-launch redesign of `/store`):** ingredient wastage entry was moved off the store manager's `/store` screen. `ingredient_entries.wastage`/`wastage_note` still exist and still reduce `closing_stock`/appear as `wastage_value` exactly as described below — only *who enters it and where* changed, not the underlying model. Responsibility for entering ingredient wastage moves to admin; as of this redesign **no screen writes a non-zero ingredient wastage value** — this is a real, currently-open gap (no admin-side wastage entry screen has been built yet), not a design decision to leave wastage uncollected indefinitely.

**Correction (post-launch redesign of `/entry`, same session as the store-manager `/entry` autosave rework):** `stock_entries.wastage` entry was likewise removed from `/entry` entirely — both the store-manager view (`EntryClient.tsx`) and regular staff's view, restaurant and canteen (`CanteenEntryClient.tsx`) alike. `stock_entries.wastage`/`wastage_note`/`wastage_value` still exist and behave exactly as described below; only *who enters it and where* changed. Responsibility for entering it moves to admin via the existing ledger direct-edit path (`PATCH /api/dashboard/ledger/entry`, §3.4's "Admin direct ledger-row edit") — unlike ingredients, this doesn't leave the gap open: the ledger edit screen already existed before this change and keeps working exactly as before, so `stock_entries.wastage_value` remains collectible today, just via a different screen. `save_stock_entry()`/`save_canteen_stock_entry()` were changed so `p_wastage`/`p_wastage_note` default to `null`, meaning "preserve whatever the row already has," instead of always overwriting — this was necessary because these are full-row-overwrite functions and the till-entry batch save route no longer sends a wastage value at all; without this change, an ordinary daily till save would have silently zeroed out any wastage the admin had set via the ledger. The admin ledger edit route is unaffected — its schema still requires a real numeric wastage value on every call, so it keeps setting wastage explicitly. See `20260717093000_preserve_wastage_on_stock_entry_save.sql`.

**Correction (post-launch client-reported bug fix, 2026-07-22):** the `/entry` wastage removal above left a real bug behind — restaurant's "Available" figure (`EntryClient.tsx`/`CanteenEntryClient.tsx`, both `remainingStockFor()`) was computed as `opening_stock + added_stock − quantity_sold [− sent_out]`, with no `wastage` term at all, even though `wastage` is entered elsewhere (the admin ledger) and was already present on the same `stock_entries` row the entry screen fetches. Client report: opening stock 8, 8 logged as wastage, "Available" still showed 8 — confirmed as a genuine display bug, not a mislabeling. Fixed by subtracting `savedEntries[itemId]?.wastage ?? 0` in both screens' `remainingStockFor()`, and by correcting the store-manager "Sent to canteen" stepper's `max` (previously also ignored wastage, which could have let a store manager over-send past physical stock) to derive from the corrected `remaining` figure instead of recomputing its own wastage-blind total. No schema/RPC change — `closing_stock`'s own formula already correctly included wastage (`lib/calculations.ts`); only the client-side "Available" label was wrong.

### Why wastage can't just be folded into "closing stock" or ignored

Without a dedicated `wastage` column, any item that spoils or is discarded has nowhere to go in the model — it's not a sale (`quantity_sold`), not a transfer (`sent_out`), so it would either wrongly inflate `closing_stock` (the system thinks stock is on hand that physically isn't) or force staff to fudge `quantity_sold` to make the physical count match, which corrupts the sales/profit figures. Neither is acceptable — this is exactly the kind of quiet data corruption the rest of this document goes out of its way to prevent.

### Shape: quantity + optional note, no reason enum

- `wastage` (numeric) — the quantity spoiled/discarded/wasted that period, entered by whoever is already logging that row (regular staff or store manager for `stock_entries`; **admin, as of the Phase 10 correction above, for `ingredient_entries`** — no admin-side entry screen exists yet, see the correction note).
- `wastage_note` (nullable text) — optional free-text reason ("left out overnight," "customer return," "dropped tray"). No fixed reason-category enum in V1 — mirrors how `expenses.note` is already free text rather than a rigid taxonomy, and the client hasn't asked for structured wastage reporting by category.

### How wastage affects the numbers

- `closing_stock` is reduced by `wastage` (see the updated formula in §3), so the system's stock figure reconciles with a physical count even after spoilage.
- `wastage_value = wastage * buying_price_snapshot` is a **distinct, visible cost** on the admin dashboard and ledger (`04_PHASE_PLAN.md` Phase 7) — separate from `cost_value` (COGS on what was actually sold) and from `expenses`. This is deliberate: WaPrecious should be able to see "we lost KES X to waste this week," not have that loss silently disappear into a lower closing-stock number she'd have to notice was smaller than expected.
- Net profit's formula (`00_ARCHITECTURE.md`, `04_PHASE_PLAN.md` Phase 7) should be read as: sales_value − cost_value − expenses − wastage_value, so wastage is an explicit deduction, not an invisible one.

**Correction (§3.10, 2026-07-22):** `wastage_value` is no longer subtracted in `net_profit`'s formula — see §3.10 for why (COGS already reflects it via reduced closing stock; subtracting it again double-counted it). `wastage_value` remains a distinct, visible figure, just reporting-only now, not a profit deduction.

---

## 3.4 Two writers, one stock figure: how orders and till sales share `stock_entries` safely

This section exists because `orders` (§6) and the till-sale entry screen (`04_PHASE_PLAN.md` Phase 4) are **two independent flows that both need to affect the same `stock_entries` row** for a given item + location + date. Handled naively (both flows reading the row, computing a new total client-side, and writing it back), this is a textbook lost-update race: a delivery order logged at 11am can be silently erased by a till "Save entry" at 5pm if that save was computed from stock data fetched before 11am. This is exactly the kind of quiet data corruption the rest of this document (opening-stock carry-forward, wastage, price snapshots) already goes out of its way to prevent — the same discipline has to extend to this new write-path.

### The fix: split the column, never overwrite, only increment

- **`stock_entries.till_quantity_sold`** — written *only* by the stock-entries route (Phase 4's stepper/till-strip flow). This is the number a staff member directly taps in. It is fine for this column to be replaced wholesale on each "Save entry," because only one flow ever writes it and only one person is editing a given location's sheet on a given day in practice.
- **`stock_entries.quantity_sold`** — the total sold, `till_quantity_sold + sum(order_items.quantity)` for that item/location/date. This is the figure `closing_stock`, `sales_value`, and `cost_value` are calculated from (§3) — nothing downstream changes.
- **Neither write-path ever sends an absolute "new total" for `quantity_sold`.**

**Implementation note (Phase 6, superseding the originally-planned `recalculate_stock_entry()` call below):** the original plan was for the orders route to call a plain `UPDATE`-only `recalculate_stock_entry(item_id, location, entry_date)` function after inserting `order_items`. Phase 6 found it insufficient and built `public.apply_order_to_stock_entry()` instead — see `20260712080310_orders_write_function.sql`. The reason: `recalculate_stock_entry()`'s `UPDATE` assumes a `stock_entries` row already exists for that item/location/date, which is only true once a till entry has been saved. An order can easily be the **first** write of the period for an item (a delivery placed before the till sheet is ever touched that day) — there is no row to `UPDATE`, and `closing_stock`/`sales_value`/`cost_value`/`closing_stock_value`/`wastage_value` have no column defaults to fall back on. `apply_order_to_stock_entry()` does the same opening-stock-carry-forward-and-upsert work `save_stock_entry()`/`save_canteen_stock_entry()` already do, except it never writes `till_quantity_sold`, `sent_out`, or `wastage` (those remain whatever the till-entry flow last saved, or 0/defaults) — only `quantity_sold` and its downstream values move, always re-derived from a **fresh** sum of `order_items` for that item/location/period (never incremented by "this order's quantity"), so concurrent writers still can't clobber each other. It is also cadence-aware for `canteen_supplied` items: for a `canteen` order, `entry_date` is `order_date` as-is (both locations daily, since the 2026-07-20 conversion — §3.1), and `added_stock` is re-derived via `canteen_supplied_total()` for `canteen_supplied` items, now resolving to a same-day figure rather than a week-range sum. **Before the daily-cadence conversion**, this function resolved a canteen order's `order_date` to that week's Monday `entry_date` (mirroring `save_canteen_stock_entry()`'s old weekly convention) — a real bug had made this necessary at the time (otherwise a canteen order would create a stray extra daily row instead of folding into the existing weekly one), caught during Phase 6's own live testing. **`recalculate_stock_entry()` itself was dropped in Phase 8** (`20260713100000_drop_dead_recalculate_stock_entry.sql`) as part of that phase's tech-debt sweep, having been confirmed unused since Phase 6 — no route handler ever called it.

- The **stock-entries route** (Phase 4) writes `till_quantity_sold` directly (client sends the day's absolute stepper values, as originally designed — only one person edits their own location's till sheet, so this remains safe).
- The **orders route** (§6) inserts the order + `order_items`, then calls `apply_order_to_stock_entry()` for each distinct item on the order. It never touches `till_quantity_sold`, `sent_out`, or `wastage`, and never writes `quantity_sold` directly.
- Both routes run their writes inside a single database transaction (a single Postgres function call per save — `save_stock_entry()`/`save_canteen_stock_entry()`/`create_order()` — since PostgREST/the Supabase JS client has no client-driven multi-statement transaction), so a crash or network drop mid-write can't leave `quantity_sold` out of sync with its two inputs.

**Row-locking fix (found post-Phase-6, while writing `scripts/acceptance/phase6-orders.mjs` — see `20260712091633_stock_entry_row_locking.sql`):** the three write functions above (`save_stock_entry`, `save_canteen_stock_entry`, `apply_order_to_stock_entry`) each did a plain, non-locking `SELECT` to check whether a `stock_entries` row already existed for the target item/location/period, computed their oversell check and derived values from that snapshot, then `INSERT ... ON CONFLICT DO UPDATE`. This has a genuine race when two calls are both the **first-ever write** for a brand-new row (e.g. a till save and a delivery order landing at the same moment for an item nobody has touched yet that day): both see "no row," both compute their oversell check from their own inputs only, and both attempt the insert. Postgres serializes the actual row conflict for you, but it does **not** re-run the PL/pgSQL function body for whichever call blocks — the blocked call's `ON CONFLICT DO UPDATE SET` clause still fires using `EXCLUDED` values computed from the stale pre-block snapshot. The observed failure mode was a false oversell rejection (a legitimate order returned `409` even though the combined total was well within stock) — a wrong-rejection bug, not silent data loss, but still a real defect in the exact property this section exists to guarantee. **Fix:** each function now calls `public.lock_stock_entry_row(item_id, location, entry_date)` — a `pg_advisory_xact_lock` keyed on that triple — as its very first statement, before any read. This serializes the whole read-decide-write sequence per row (not just the final `INSERT`'s conflict resolution): a second caller blocks on the lock itself, and by the time it acquires the lock and runs its own `SELECT`, the first caller's row is already committed and visible. The lock is transaction-scoped (no explicit unlock needed) and released automatically when the function's implicit transaction ends, matching the existing "one function call = one transaction" model. Verified via a repeated concurrent-request stress test (till save + order racing on a brand-new row, run 8+ times back to back) — no false rejections after the fix, oversell still correctly rejected when the combined total genuinely exceeds stock.

**Batch-save wrappers (Phase 9 — see `20260713183705_batch_save_functions.sql`):** the client-side entry/store screens save a whole day's/week's sheet in one submit, but before Phase 9 the route handlers (`app/api/stock-entries/route.ts`, `app/api/ingredient-entries/route.ts`) looped over every line and `await`ed one `supabase.rpc()` call per line — a separate network round trip per item. With the real 132-item catalog (Phase 8), a single "Save" tap meant dozens of sequential round trips (the reported "Save feels slow" complaint from live client testing). **Fix:** three new plpgsql wrapper functions — `save_stock_entries_batch()`, `save_canteen_stock_entries_batch()`, `save_ingredient_entries_batch()` — each accepts the whole batch as a `jsonb` array and loops **server-side**, calling the existing single-row `save_stock_entry()`/`save_canteen_stock_entry()`/`save_ingredient_entry()` per line inside one transaction. This is a pure loop relocation (Node process → Postgres), **not** a rewrite of the correctness logic above: the per-row `lock_stock_entry_row()` advisory lock and oversell re-check still fire once per line, exactly as before. Locking stays per-row, not per-batch, so a till save and a concurrent delivery order on a *different* item in the same batch still don't block each other unnecessarily. The one behavior change (an improvement, not a regression): a failure on any line now rolls back the **entire batch** atomically in one transaction, where previously a failed line simply meant the client had made it partway through its own loop before hitting the error — earlier lines in that loop had already independently committed. Verified via `scripts/acceptance/phase9-batch-save.mjs`.

### Admin direct ledger-row edit (docs/backlog/04_admin_ledger_edit.md)

A third caller of `save_stock_entry()`/`save_canteen_stock_entry()`/`save_ingredient_entry()` exists alongside the staff entry-screen save path and the batch-save wrappers above: `PATCH /api/dashboard/ledger/entry`, admin-only, the edit affordance built into the Ledger screen (`app/(admin)/dashboard/ledger/LedgerClient.tsx`). No new tables or functions were added for this — it's a thin route that re-derives quantities through the exact same single-row functions staff writes already use, so none of this section's correctness guarantees (opening-stock carry-forward, oversell re-check, row locking) needed to change.

Three things this route enforces that the ordinary staff save path doesn't need to, because staff only ever save "today" (both locations, since the 2026-07-20 daily-cadence conversion — §3.1):

1. **Historical edits cascade forward instead of being blocked (post-launch redesign, 2026-07-20).** Originally this route rejected editing anything but the most-recent row for an item/location or ingredient with a `409` — see "Historical edit cascade" below for why that changed and what replaced it.
2. **Price snapshots are permanently immutable through this route.** `selling_price_snapshot`/`buying_price_snapshot` are fetched from the existing row (or the current catalog, only for a brand-new "today" row with nothing to preserve) and passed straight back into the save function unchanged — the route's Zod schema doesn't even accept these fields from the client. The cascade recompute (below) reuses this same rule: it only ever touches quantities and their derived values, never a price snapshot.
3. **`created_by` is preserved as the row's original author**, fetched before the save call and passed back in as `p_created_by` — these save functions only set `created_by` on the initial `INSERT`, so this is a no-op for an existing row's real-world attribution. A brand-new row (no existing entry for that item/date — this is also how admin logs "today's" entry herself, the same form handling both cases per the backlog doc's scope item 5) legitimately gets `created_by` = the admin's own id, since that genuinely is who logged it.

Every successful edit writes an `audit_log` entry (`stock_entry.admin_edit` / `ingredient_entry.admin_edit`, before/after quantities, plus the full cascade of rows it recomputed) via `lib/audit.ts` — the audit trail is what records *which admin* made the correction, separately from `created_by` staying the original staff member.

#### Historical edit cascade (post-launch redesign, 2026-07-20)

The original version of this route only allowed editing the single most-recent row for an item/location or ingredient, rejecting anything older with a `409` ("edit forward from the most recent one instead") — because every row's `opening_stock` is derived, at write time, from the *previous* row's `closing_stock` (`save_stock_entry()` etc., above), and nothing re-derived a *later* row after an earlier one changed. Editing day 1 of a 10-day chain without recomputing days 2–10 would leave every later `opening_stock`/`closing_stock`/`sales_value`/`cost_value`/`closing_stock_value`/`wastage_value` silently wrong. In practice this meant a real data-entry mistake found days later couldn't be fixed at its source at all.

The fix: `supabase/migrations/20260720100000_historical_ledger_edit_cascade.sql` adds `recompute_stock_entry_chain(item_id, location, from_date)` and `recompute_ingredient_entry_chain(ingredient_id, from_date)`, which walk forward from an edited row through every existing later row for that item/location (or ingredient), in date order, re-deriving `opening_stock` (= prior row's `closing_stock`) → `closing_stock` and the value fields from each row's own already-stored inputs and price snapshots. `PATCH /api/dashboard/ledger/entry` calls the top-level `recompute_stock_entry_cascade()` (stock) / `recompute_ingredient_entry_chain()` (ingredients) right after the edited row's own save succeeds — a no-op when the edited row was already the latest, so this is strictly a superset of the old behavior, not a different code path for the common case.

**Cross-location cascade.** A `canteen_supplied` item's restaurant `sent_out` feeds the canteen's `added_stock` via `canteen_supplied_total()` (§3.1) — but only when the canteen row is itself (re)saved. So `recompute_stock_entry_cascade()` also detects when the edited row is `restaurant` + `canteen_supplied` and `sent_out` changed, and cascades from there. **As of the 2026-07-20 daily-cadence conversion**, this is a same-day 1:1 check, not a week-range loop: if a canteen row exists with `entry_date` exactly equal to the edited restaurant row's date, its `added_stock` is re-pulled from `canteen_supplied_total()` (now a same-day figure) and cascaded forward from there — a restaurant edit that falls within an old, frozen weekly canteen period (§3.1) correctly finds no same-day canteen row and touches nothing, by design; no special-casing needed. **Before the conversion**, this looped over every canteen week whose `[entry_date, entry_date+6]` range overlapped the edited date, re-deriving each from a week-range `canteen_supplied_total()` call — replaced because once canteen is daily there's no week window left to loop over.

**Resolved design decisions:**
- **Unrestricted historical range** — no cutoff (e.g. "current month only"). Any past row is editable, matching "we need to fix mistakes whenever we find them" over adding an artificial closed-books boundary V1 doesn't need.
- **Atomic reject on a downstream oversell.** If recomputing would make any later row's demand (`sent_out + quantity_sold + wastage` for stock, `quantity_used + wastage` for ingredients) exceed its now-recomputed available stock — a historical correction revealing a would-be oversell days or weeks later — the *entire* cascade rolls back in one transaction (`raise exception ... using errcode = 'P0001'`, the same `oversell` message shape `describeSaveError()` already parses) rather than landing an impossible negative closing stock partway through the chain. The admin has to resolve the downstream conflict first, then retry the original edit.
- **Confirmation UI shows count + date range only**, not a full before/after preview of every affected row — `GET /api/dashboard/ledger/entry/impact` is a read-only pre-check (counts later rows + finds the max date, no recompute) that `LedgerClient`'s edit modal calls when opened; if the count is `> 0`, the first "Save" click becomes "Continue" and reveals a warning ("This will also recalculate N later entries for this item, through `<date>`.") before a second click actually submits. Judged sufficient sanity-check weight for this action without the bigger UI lift of a full row-by-row diff.

**Row locking**, extended to match: `recompute_stock_entry_chain`/`recompute_ingredient_entry_chain` take the same `pg_advisory_xact_lock` (`lock_stock_entry_row`/`lock_ingredient_entry_row`, §3.4 above) for every row in the affected range up front, before reading any of them — so a concurrent staff write (till save, order, store-manager save) landing mid-cascade is serialized against it exactly like the ordinary single-row save path already is, not a new locking model.

### Store-manager per-field autosave on `/entry` (post-launch redesign)

A fourth writer of `stock_entries` was added alongside the till-entry batch save, the batch-save wrappers, and the admin ledger edit above: `PUT /api/stock-entries`, store-manager-only, autosaves "Added stock"/"Sent to canteen" one field at a time as the store manager types (mirroring `/store`'s `PUT /api/ingredient-entries` autosave). This is **not** implemented by calling `save_stock_entry()` directly — that function unconditionally overwrites `till_quantity_sold` on every call (`excluded.till_quantity_sold` in its `ON CONFLICT DO UPDATE`), which is safe for its one original caller (the till-entry batch save, the only writer of that field, sending the day's absolute stepper value each time) but would silently revert a concurrent till save if a fourth caller fetched the row, read a stale `till_quantity_sold`, and passed it straight back in — a genuine lost-update race, the exact failure mode this whole section exists to prevent.

Instead, a dedicated function — `save_stock_entry_store_manager_fields()` (`20260717090000_stock_entry_store_manager_autosave.sql`) — mirrors how `apply_order_to_stock_entry()` already solves the identical problem for orders: it reads `till_quantity_sold`/`wastage`/`wastage_note` from the existing row (or defaults a brand-new row to 0/null) and preserves them unchanged, only ever writing `added_stock`/`sent_out`. Locked via the same `lock_stock_entry_row()` advisory lock as every other writer, so this is a safely-serialized fourth writer, not a new race. Regular staff's `till_quantity_sold` field is completely unaffected — it still only ever goes through the batch `POST` path described above.

**RLS fix: any same-location staffer can update a same-day row, not just its original creator (post-launch, 2026-07-17):** the store-manager autosave above assumes any restaurant staffer's write can be the first one to touch a given item's row on a given day, and any other restaurant staffer's write can safely land on that same row afterward. But `stock_entries`'s RLS `UPDATE` policy originally gated on `created_by = auth.uid()` — whoever's write created the row became its sole owner, and the RLS layer (not the plpgsql functions above) then rejected every other same-location staffer's `ON CONFLICT DO UPDATE` on that row for the rest of the day, surfaced to the client as a confusing "you can only save today's entry" 403. Found live-testing the store-manager screens (Janiffer autosaving `added_stock`, then Sarah trying to log a till sale on the same item, both real restaurant staff). **Fix (`20260717120000_stock_update_location_scoped.sql`):** the UPDATE policy now checks `location = my_location()` instead of `created_by = auth.uid()` — see §4's policy listing below for the exact clause. `created_by` itself is unchanged; it still records whoever's write actually created the row, it just stopped being the gate on who else may update it. Regression-checked by `scripts/acceptance/post-launch-stock-entry-multi-writer-rls.mjs`.

### Cashier per-field autosave on `/entry` (post-launch redesign)

A fifth writer of `stock_entries` was added alongside the till-entry batch save, the batch-save wrappers, the admin ledger edit, and the store-manager autosave above: `PUT /api/stock-entries`'s cashier branch (regular, non-store-manager restaurant staff), autosaving `till_quantity_sold` one item at a time as the cashier types, mirroring the store manager's own autosave and mounted on the exact same route (dispatched by `user.is_store_manager` in `app/api/stock-entries/route.ts`'s `PUT` handler — `putStoreManagerField()` vs. `putCashierField()`, kept as two explicitly separate functions with separate schemas rather than one undifferentiated handler, since the two roles must never be able to write each other's fields through this route). The restaurant's batch `POST` path (till-entry, Phase 4's original design) still exists and still works, but after this redesign nothing in the UI calls it for restaurant cashiers — `EntryClient.tsx`'s cashier branch autosaves exclusively through the new `PUT` branch, same as the store manager's fields already did.

`putCashierField()` calls a dedicated function, `save_stock_entry_cashier_field()` (`20260717130000_stock_entry_cashier_autosave.sql`), not `save_stock_entry()` directly — same "don't clobber a concurrent writer's field" rationale as the store-manager function: it reads `added_stock`/`sent_out`/`wastage`/`wastage_note` from the existing row (or defaults a brand-new row to 0/null, carrying `opening_stock` forward from the prior period exactly as every other writer does) and preserves them unchanged, only ever writing `till_quantity_sold`. Same `lock_stock_entry_row()` advisory lock as every other writer in this section.

**The first-writer false-oversell bug, and its fix (found and fixed the same session as this redesign):** because `added_stock` is "preserve if not provided" (this section's Phase 10 correction, above), if a cashier is the very first person of the day to touch a given item's row — no row exists yet, and the store manager hasn't logged today's "Added stock" yet either — `added_stock` resolves to 0, so `total_stock = opening_stock + 0`. Any `till_quantity_sold` that exceeds `opening_stock` alone then gets rejected as an oversell, even though the cashier didn't oversell anything — it's a data-ordering/timing issue (the store manager just hasn't gotten to their screen yet), not user error, and the generic "That's more than the available stock available" message misdiagnoses it as one.

The chosen fix (not the alternative of silently allowing the sale against `opening_stock` alone, which was explicitly considered and rejected — a silent allowance here would let a genuine oversell against `opening_stock` slip through unflagged) is to **detect this specific case and block with a distinctly-diagnosed message** instead of the generic oversell one: "Ask the store manager to log today's added stock first." The distinguishing condition is `added_stock = 0` **and** the requested total exceeds `opening_stock` (carried forward from the prior period, not just today's row) — critically, this is *not* the same as "no row exists yet" or "`added_stock` is 0": selling purely against a legitimate `opening_stock` carried forward from yesterday, with no `added_stock` logged today at all, is a completely normal, expected case (an item nobody restocked today but still has leftover stock to sell) and must succeed, not be blocked. Only when even `opening_stock` alone can't cover the requested sale does this distinct rejection apply.

This is implemented at two call sites, both fixed consistently (the same root cause affects both, since both ultimately hit `save_stock_entry()`'s "preserve added_stock" semantics):

- **`save_stock_entry_cashier_field()`** (the new PUT autosave, above) raises a distinct SQLSTATE (`P0002`, message `not_yet_stocked: ...`) instead of the generic `oversell` (`P0001`) exception when this specific condition is met — computed inside the same transaction, after the same carry-forward/lock logic every other writer uses, so it can't misdiagnose a case where `opening_stock` alone is genuinely sufficient.
- **The restaurant batch `POST /api/stock-entries` path** (still reachable, still used by nothing in the current UI but not removed) gets an equivalent **route-level pre-check** in `app/api/stock-entries/route.ts`, run before the batch RPC call: for each line with no `added_stock` logged today, it looks up `opening_stock` (today's row if one exists, else the prior period's `closing_stock` via the same carry-forward query every write-path uses) and rejects with the same specific message if the requested sale would exceed it. Kept as a route-level check rather than duplicated into `save_stock_entry()` itself, since that function is also called by the admin ledger edit path, where "ask the store manager" isn't the right framing for an admin correcting a historical row.

`lib/errors.ts`'s `describeSaveError()` checks for `error.code === "P0002"` (or the `not_yet_stocked` message substring, for the route-level pre-check's plain `NextResponse.json` path) *before* its existing `"oversell"` check, so the two rejection cases never collide into the same message. Regression-checked by `scripts/acceptance/post-launch-cashier-autosave.mjs`, including the concurrent first-writer race (mirroring the row-locking test above) and confirming a *genuine* oversell (`added_stock > 0` but still insufficient) still gets the original generic message, not this new one.

### Canteen per-field autosave on `/entry` (post-launch redesign)

A sixth writer of `stock_entries` was added alongside the till-entry batch save, the batch-save wrappers, the admin ledger edit, the store-manager autosave, and the cashier autosave above: `PUT /api/stock-entries`'s canteen branch (`putCanteenField()`, dispatched by `user.location === "canteen"` in `app/api/stock-entries/route.ts`'s `PUT` handler, alongside — not replacing — the restaurant's `is_store_manager`-gated `putStoreManagerField()`/`putCashierField()` split). This is structurally different from the restaurant's two autosave writers: canteen has no store-manager concept (`is_store_manager` is restaurant-only, `00_ARCHITECTURE.md` §5.1) — **one person (Anne) owns both fields on the same screen**, `quantity_sold` (every item) and `added_stock` (`canteen_independent` items only; `canteen_supplied` items' `added_stock` stays server-derived via `canteen_supplied_total()`, never accepted from the client, per §3.1). Both fields autosave independently, each on its own debounce timer, replacing `CanteenEntryClient.tsx`'s old batch Save-button flow.

Even though both fields belong to the same staffer, this is still built as a dedicated partial-update function — `save_stock_entry_canteen_field()` (`20260717140000_stock_entry_canteen_autosave.sql`), not `save_canteen_stock_entry()` directly — for the same reason the restaurant's two autosave writers each got their own function: two independent debounce timers on two different inputs are still two independent writes that can interleave, and `save_canteen_stock_entry()` unconditionally overwrites both `added_stock`/`till_quantity_sold` together on every call. Unlike the restaurant split, this is **one function** taking both quantity parameters as independently nullable ("omit to preserve the existing row's value") rather than two separate RBAC-gated functions — canteen has no cross-role boundary to enforce between the two fields, so one shared function avoids duplicating the opening-stock/order-total/oversell logic twice. `putCanteenField()` always calls it with exactly one of the two parameters set (`canteenStockEntryFieldSaveSchema` in `lib/validation.ts` enforces this at the route layer) and the other omitted. Same `lock_stock_entry_row()` advisory lock as every other writer in this section. `entry_date` is used as-is (both locations daily, since the 2026-07-20 conversion — §3.1) inside the route handler — same convention as the existing GET/POST canteen paths. **Before the conversion**, `entry_date` was re-normalized to that week's Monday server-side here.

**The two distinct oversell cases (resolved design call):** canteen's single-person-both-fields shape means a `canteen_independent` item's oversell is almost always a genuine one — Anne owns both `added_stock` and `quantity_sold` herself for those, with no other actor in between. But `canteen_supplied` items retain an external dependency even under this redesign: `added_stock` is `canteen_supplied_total()`, the *restaurant's* `sent_out` for that item on the same day (§3.1) — an upstream actor entirely separate from Anne. If Anne autosaves a `quantity_sold` for a `canteen_supplied` item before the restaurant has sent anything that day, `added_stock` resolves to 0 and the oversell check fails — not because Anne did anything wrong, but because the restaurant hasn't supplied yet today. This is analogous to (but not identical to) the cashier autosave's "store manager hasn't logged today's added stock" case above: same "the failure isn't the current user's fault" shape, different upstream actor (the restaurant's daily sends, not a same-screen store-manager field).

The chosen fix mirrors the cashier autosave's approach — a distinctly-diagnosed rejection instead of the generic oversell message, but **only for `canteen_supplied` items with `added_stock = 0`**; a `canteen_independent` item's oversell always gets the generic message, since there's no upstream actor to blame there. Implemented via a third distinct SQLSTATE:

- **`save_stock_entry_canteen_field()`** raises `errcode 'P0003'` (message `not_yet_supplied: ...`) when `p_is_canteen_supplied` is true, the derived `added_stock` (`canteen_supplied_total()`) is 0, **and** the requested total still exceeds `opening_stock` — critically, exactly the same "opening stock alone might legitimately cover this" carve-out the cashier's `P0002` case uses: selling purely against yesterday's leftover stock, with nothing sent today at all, is a normal, expected case and must succeed, not be blocked.
- A genuine oversell — either a `canteen_independent` item's insufficient total, or a `canteen_supplied` item where the restaurant HAS sent something today (`added_stock > 0`) but the combined total still isn't enough — keeps the existing generic `'oversell'` (`P0001`) exception, same as every other writer.

`lib/errors.ts`'s `describeSaveError()` checks `error.code === "P0003"` (or the `not_yet_supplied` message substring) — surfaced as `"The restaurant hasn't sent today's supply yet for this item."` (updated from "this week's supply" as part of the daily-cadence conversion — the underlying check is now same-day, so the old wording would be actively wrong, not just stale copy) — positioned alongside its existing `P0002` check, both before the generic `"oversell"` check, so none of the three rejection cases collide into the wrong message. Regression-checked by `scripts/acceptance/post-launch-canteen-autosave.mjs` and `scripts/acceptance/post-launch-canteen-daily-cadence.mjs`, including the concurrent first-writer race (mirroring the row-locking test above), same-day linkage confirmation, and confirming a genuine `canteen_independent` oversell still gets the original generic message.

### Duplicate-submission protection (orders)

A cashier double-tapping "Save order" on a flaky connection must not create two orders and double-deduct stock. `orders.client_request_id` (a UUID the client generates once per submit attempt and resends unchanged on any retry) plus `unique (created_by, client_request_id)` makes a retried submission a no-op: the second insert attempt hits the unique constraint, the route handler catches that specific conflict and returns the original order's result instead of erroring. `stock_entries` already gets this for free from its own `unique(item_id, location, entry_date)` upsert key — `orders` did not have an equivalent until now, since it has no natural composite key (a customer can plausibly place two genuinely separate orders on the same day).

### Validation: an order's items must belong to its own location

Nothing in the table structure stops an order from being created with `location = 'restaurant'` while referencing an item that's `canteen_independent` (an item the restaurant never stocks or sells). This must be enforced in the Zod schema / route handler (`lib/validation.ts`), not assumed: for each `order_items` row, reject the write unless the referenced item's `supply_type` is valid for the order's location — `restaurant_only` or `canteen_supplied` items are sellable at `restaurant`; `canteen_supplied` or `canteen_independent` items are sellable at `canteen`. Surface a clear inline error, same standard as the existing "can't sell more than available stock" rule (§3).

---

## 3.5 Staff meals (docs/backlog/02_staff_meals.md)

**Status:** design confirmed with the human 2026-07-19, implemented same session.

### The problem

Restaurant staff sometimes eat menu items from stock without it being a paying sale — the client explicitly frames this as a business expense, not something to hide inside wastage or leave unreconciled against a physical count.

### Why this is a separate table, not a `stock_entries` column

Unlike `wastage` (entered by whoever already fills in that day's stock sheet — regular staff, store manager, or admin), staff meals are **self-service**: each staff member logs their own claim, attributed to them (confirmed required — the admin sees who ate what, not just a total). That attribution requirement, plus the fact that multiple different staff members can claim against the same item on the same day, rules out a `stock_entries` column the same way `wastage`/`staff_consumption`-as-a-column would have (one row per item/location/date has no room for "which of several staff members"). `staff_meal_entries` is its own table instead — many rows per item/location/date, one per claim.

### Shape: item + quantity, not a free-text cash amount

Confirmed with the human: a staff member picks the actual menu item and a quantity, like a lightweight order — **not** a free-text description with a self-estimated shilling amount (the alternative considered and rejected). `value = quantity * buying_price_snapshot` is derived automatically, same costing rule as `wastage_value` (never `selling_price_snapshot` — no sale occurred, so there's no margin to value it at, only the cost of what was consumed). This also means a claim correctly reduces the item's `closing_stock` by a real, price-snapshotted quantity, keeping stock reconciliation against a physical count intact — the same reason wastage tracking became V1 scope in the first place.

```sql
create table public.staff_meal_entries (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id),
  location location_type not null,
  meal_date date not null,
  quantity numeric(10,2) not null check (quantity > 0),
  buying_price_snapshot numeric(10,2) not null,
  value numeric(10,2) not null,             -- quantity * buying_price_snapshot
  note text,                                -- optional, e.g. "lunch"
  staff_id uuid not null references public.users(id),   -- who ate it
  created_by uuid not null references public.users(id), -- normally == staff_id
  created_at timestamptz not null default now()
);
```

See `20260719150000_staff_meal_entries.sql` for the full migration (table, RLS, `staff_meals_total()`, dashboard aggregation functions).

### Location scoping

Same as every other write path (`stock_entries`/`expenses`/`orders`) — a staff member can only log/read claims against their **own** location's items and stock, not "restaurant only regardless of staff location" (a plausible alternative reading of the client's phrasing, explicitly considered and rejected in favor of consistency with the rest of the schema).

### How staff meals affect the numbers — a third contributor to `closing_stock`, alongside `wastage`

`staff_meals` (the sum of `staff_meal_entries.quantity` for an item/location/period, via `public.staff_meals_total()` — the exact same "narrow, re-derived aggregate" pattern `canteen_supplied_total()` already established) becomes a third term in `closing_stock`'s formula and the oversell check, alongside `wastage` (see the updated formula in §3). **Critically, `staff_meal_value` is never folded into `wastage_value`** — wastage means spoiled/lost, staff meals means consumed on purpose for a legitimate business reason; conflating them would make the wastage dashboard figure lie about actual spoilage. They are two distinct, separately visible dashboard/ledger lines. `net_profit`'s formula (`lib/calculations.ts` `netProfit()`) gains a fifth term: `sales_value − cost_value − expenses − wastage_value − staff_meal_value`.

**Correction (§3.10, 2026-07-22):** `staff_meal_value` is no longer subtracted in `net_profit`'s formula — see §3.10. It remains a distinct, visible figure (now alongside complimentary meals and stock adjustments in the "Non-Sales Stock Consumption" section), just reporting-only, not a profit deduction.

### The six `stock_entries` writers all needed updating

Because `staff_meals` participates in `closing_stock` and the oversell check, and because (per §3.4) there is no single shared SQL helper for that arithmetic — each of the six writer functions computes it inline — every one of them needed the same one-line addition (`v_staff_meals := public.staff_meals_total(...)`, folded into its existing oversell check and `closing_stock`/`closing_stock_value` arithmetic): `save_stock_entry()`, `save_canteen_stock_entry()`, `apply_order_to_stock_entry()`, `save_stock_entry_store_manager_fields()`, `save_stock_entry_cashier_field()`, `save_stock_entry_canteen_field()`. See `20260719151000_stock_entries_staff_meals.sql`. None of their parameter signatures changed shape (staff meals are never passed in as an argument — always re-derived from `staff_meal_entries` inside the function, same discipline `quantity_sold` already follows for `order_items`), so this was a `create or replace` in place, not a drop-and-recreate.

`staff_meal_entries` writes themselves go through a dedicated write function, `create_staff_meal_entry()` (`20260719151000_stock_entries_staff_meals.sql`, note parameter made optional in `20260719152000_staff_meal_entry_note_optional.sql`) — not through any of the six `stock_entries` writer functions above, and not through `lock_stock_entry_row()` directly by the caller (the function itself takes that lock internally, on the resolved entry_date, so a claim landing concurrently with a till save/order on the same item/period is serialized exactly like every other writer pair in §3.4). Mirrors `create_order()`'s shape: insert the claim row, then force a `stock_entries` recompute for that item/location/period in the SAME transaction, so the oversell check re-runs against the combined total (till + orders + wastage + THIS claim) before anything commits — the same atomicity guarantee orders already get, not an "insert now, let some later unrelated write notice the oversell" gap.

### Available-stock display (post-launch UX-audit fix, `staff_meal_available_stock()`)

A real bug found live-testing this feature: the staff-facing picker's first version only showed "Available: X" when *today's* `stock_entries` row already existed — the common case is no row exists yet (nobody has logged a till sale or store-manager field for that item today), so the picker showed no availability signal at all and let staff submit a quantity the server then correctly rejected with a 409. The fix is `public.staff_meal_available_stock(p_location, p_as_of_date)` (`20260719160000_staff_meal_available_stock.sql`), a `security invoker` function returning each sellable item's current effective stock — reusing `create_staff_meal_entry()`'s own opening-stock-carry-forward logic (most recent `stock_entries` row's `closing_stock`, which is already net of every same-day claim) rather than re-deriving a second, incomplete version of that math client-side (CLAUDE.md's "no calculation logic duplicated" rule).

**`available` is `NULL`, not `0`, when an item has no `stock_entries` row at all** (this or any prior period) — deliberately distinct from a real row showing a confirmed 0 remaining. A brand-new item, or one nobody has logged a till sale for yet today, has *unknown* stock, not *confirmed-empty* stock; collapsing the two into a bare 0 would make every such item permanently unclaimable in the picker until its first till sale of the day, which isn't how staff actually use this screen (a staff meal can legitimately be the first stock-touching action of the day for an item). The client (`StaffMealsClient.tsx`) treats `null` as "don't cap, don't show an Available label" — the same fallback `OrdersClient.tsx` already uses for its own "no row yet" case. The server's real oversell check in `create_staff_meal_entry()` remains the actual enforcement either way; this is a UX cap on top of it, not a replacement.

### Screens

- **Staff-facing**: a new "Staff meals" tab on the existing `/expenses` screen (not a new standalone route/nav item) — search-and-tap-to-select item picker (not a native `<select>` — a real restaurant location has ~70 sellable items, which makes a dropdown unusable on mobile), category filter chips, live cost + available-stock display per item, quantity stepper capped at available stock, optional note, submitted as the logged-in staff member (`staff_id = created_by = auth.uid()`).
- **Admin-facing**: an itemized table (who, what item, quantity, value, date) on `/dashboard/ledger`, alongside the existing wastage breakdown — same reporting-lens pattern as the rest of that screen. A `staffMealValue` figure also appears on the main dashboard, distinct from `wastageValue`.

### Explicitly not in scope

- Any payroll/deduction logic tied to consumption value.
- Formal meal-plan/allowance rules (e.g. "each staff gets X per day free").

---

## 3.6 Item Master profit-by-date-range column (post-launch addition, 2026-07-21)

The `/items` (Item Master) table has always shown a static per-unit **Margin %** column, computed from an item's *current* `buying_price`/`selling_price` — useful for pricing decisions, but not "how much money has this item actually made." WaPrecious asked for a second, date-range-scoped **Profit** column showing real KES profit earned by each item.

`public.items_profit_by_range(p_from, p_to, p_location)` (`20260721100000_items_profit_by_range.sql`) computes, per item:

```
profit = sum(sales_value) - sum(cost_value) - sum(wastage_value)
```

summed over each `stock_entries` row's already-snapshotted `sales_value`/`cost_value`/`wastage_value` for that date range (and location, if filtered) — **never** the item's current `buying_price`/`selling_price`, so a past price change doesn't silently distort a range that spans it. Matches the existing `dashboard_stock_summary`/`dashboard_item_ledger` functions' `security invoker` + set-based-aggregation-in-SQL convention (`20260712121500_dashboard_aggregation_functions.sql`) rather than introducing a new pattern; the only difference from `dashboard_item_ledger` is that this one groups/aggregates per item across the whole range instead of returning one row per item per day, since the Item Master table needs one total per item, not a daily breakdown.

Exposed via `GET /api/items/profit?from=&to=&location=`, admin-only. The `/items` page's date-range picker defaults to today and is independent of the Margin column, which always reflects the item's current price regardless of the picked range.

---

## 3.7 Dashboard: restaurant/canteen/ingredients closing stock shown separately (post-launch addition, 2026-07-21)

Client observation (WaPrecious, testing the live demo): the dashboard's single combined "Closing Stock Value" figure looked, at a glance, like it "equaled today's purchases" — actually just a coincidence of testing on a quiet day with no sales logged yet (`closing_stock = opening_stock + added_stock` when `quantity_sold = wastage = 0`, per §3's core formula). Working through it surfaced a real, separate product gap: the combined figure was summing three conceptually distinct stock pools into one number, obscuring a distinction that matters to how the client actually thinks about the two locations — **restaurant menu-item stock should trend toward 0** under the "cook it, send it, sell it" model (§3.2), while **canteen genuinely carries a standing, shop-style stock balance** (§3.1/§3.2's `canteen_independent` items especially). Ingredients (raw materials, §3.2) are a third pool again, never sold directly, so folding them into "restaurant" also obscured whether a near-zero restaurant figure was really about menu items or just an artifact of ingredient stock being large.

**`dashboard_stock_summary(p_from, p_to)` and `dashboard_ingredient_summary(p_from, p_to)`** (`20260721120000_dashboard_stock_quantity_columns.sql`) were extended with quantity columns, alongside their existing money columns:

- `dashboard_stock_summary`: added `opening_stock`, `added_stock`, `sent_out`, `closing_stock` (per location).
- `dashboard_ingredient_summary`: added `opening_stock`, `received`, `closing_stock` (ingredients have no location split or `sent_out` — no restaurant→canteen equivalent for raw materials).

Aggregation rule, consistent with the existing `closing_stock_value` handling in these same functions: **`opening_stock`/`closing_stock` are point-in-time balances** — each item's/ingredient's *earliest*/*latest* row within the date range respectively (summing across days would double-count carried-forward stock) — while **`added_stock`/`sent_out`/`received` are genuine period sums** (real flows that occurred during the range, safe to add up).

`GET /api/dashboard/summary` (`app/api/dashboard/summary/route.ts`) now returns:
- `byLocation.restaurant`/`byLocation.canteen` — **menu-item stock only** (`stock_entries`), each with the new quantity fields plus `closingStockValue` no longer including ingredients (previously `byLocation.restaurant.closingStockValue` silently folded ingredient stock value in — see the corrected code comment in the route file).
- A new top-level `ingredients` block — `closingStockValue`, `wastageValue`, `openingStock`, `received`, `closingStock` — kept separate from `byLocation.restaurant`, matching the client's mental model above. Ingredients still have no sales/cost/expenses/net-profit of their own (never sold directly), so this block is stock-figures-only, not a third P&L column.
- `combined.closingStockValue`/`combined.wastageValue` and `byLocation.restaurant.netProfit`'s inputs are unchanged — ingredient wastage/closing-stock-value still fold into the combined figure and into restaurant's own net-profit calculation exactly as before (ingredients' cost only ever surfaces via the restaurant's P&L, since they're never sold directly). Only `byLocation.restaurant.closingStockValue` itself stopped including ingredients — a correction, not a new omission, since that particular fold-in was never something the client had asked for or been shown as intentional.

The admin dashboard (`app/(admin)/dashboard/DashboardClient.tsx`) now shows this split visibly rather than just in the API response:
- Hero band: two tiles, "Closing stock (Restaurant)" and "Closing stock (Canteen)", replacing the old single combined "Closing stock value" tile.
- "Location performance comparison" table: added a "Closing stock value" row (money) to the existing Restaurant/Canteen table, plus a new quantity-only table (Opening/Added/Sent to canteen/Closing stock, in units) and a separate single-column "Ingredients (central store)" card — restaurant-only, so it doesn't fit the two-location table shape.

**Carried forward:** this is purely a read-side/display change — no write path, no RLS policy, and no schema table changed. `stock_entries`/`ingredient_entries`/their calculation rules (§3, `lib/calculations.ts`) are untouched; only the two `dashboard_*()` aggregation functions gained columns and the dashboard route/UI surfaced them.

### Follow-up: "Sold"/"Used" rows and the canteen "Sent to canteen" label (same day)

Sanity-checking the new Stock Movement table against a real screenshot surfaced two more readability problems, both fixed in the same round:

- **The table omitted `quantity_sold`/`quantity_used`**, the figures that actually explain most of the gap between opening+added and closing stock. Without them, e.g. "opening 19 + added 0 = 19" against "closing 16" looked like 3 units had silently vanished. `dashboard_stock_summary`/`dashboard_ingredient_summary` were extended again (`20260721130000_dashboard_stock_sold_used_columns.sql`) with `quantity_sold` (stock_entries — already includes both till and order-driven sales, §3.4) and `quantity_used` (ingredient_entries), added to the API response as `byLocation.*.quantitySold`/`ingredients.quantityUsed` and shown as a "Sold (units)"/"Used (units)" row in their respective tables — so opening + added − sent − sold(−wastage) now visibly accounts for closing stock instead of leaving an unexplained gap.
- **Canteen's "Sent to canteen" cell showed a bare "—"**, which reads as missing/broken data rather than "doesn't apply here" (canteen never sends stock anywhere — its `added_stock` for `canteen_supplied` items is a same-day mirror of this same restaurant figure, §3.1, so showing it again under Canteen would double-count rather than inform). Changed to an explicit muted note, "N/A — mirrors restaurant" (`styles.comparisonNote` in `dashboard.module.css`), so the reason is stated rather than implied.

---

## 3.8 Dashboard COGS switched to the client's periodic-inventory formula (post-launch change, 2026-07-21)

**Client-directed change, not an engineering judgment call.** WaPrecious has always calculated COGS on her Excel sheet as:

```
COGS = Opening Stock Value + Added Stock Value − Closing Stock Value
```

This is the standard periodic-inventory shortcut — it infers cost of goods sold from the change in inventory value over a period, rather than costing each sale directly. The app's dashboard previously computed COGS differently (`sum(quantity_sold * buying_price_snapshot)` — see §3's per-row `cost_value`), which only agrees with her formula when nothing leaves stock except sales. Since wastage and staff meals also reduce stock (§3.3, §3.5), the two methods can diverge. Raised to the client directly; she confirmed she wants her own formula used on the dashboard, not the sold-based one.

**She also confirmed a second, non-obvious instruction**: her "closing stock" should be items' closing stock **plus** ingredients' closing stock, added together into one combined figure — not scoped to menu items alone. Concretely, for the *whole* COGS calculation (not just the closing-stock term), items' and ingredients' opening/added/closing **values** are summed together before the single subtraction, i.e.:

```
COGS = (Opening Value_items + Opening Value_ingredients)
     + (Added Value_items + Added Value_ingredients)
     − (Closing Value_items + Closing Value_ingredients)
```

**Known, accepted overlap — not a bug.** Items and ingredients are separate, unlinked stock pools with no recipe/yield formula between them (§3.2 — deliberate V1 scope decision). An in-house-cooked menu item (e.g. Chapati) carries its own `buying_price_snapshot`, entered as a flat catalog estimate, **and** the ingredients that went into cooking it (flour, etc.) are tracked and costed separately. Combining both pools' values into one COGS means that cost is counted twice for such items — once via the item's own price, once via the ingredient it consumed. This mirrors exactly how her one-sheet Excel process worked (everything was "stock" on one list, no separate items/ingredients split), so the overlap isn't a regression relative to what she's used to — it's a structural side effect of this app's schema splitting items and ingredients into two tables that Excel never had. Flagged to the client; she chose to proceed as-is rather than have `buying_price` zeroed out for cooked items.

**Implementation:**
- `lib/calculations.ts` — new `periodicCogs({ openingStockValue, addedStockValue, closingStockValue })`, a pure combining step (same convention as `netProfit()`). Callers are responsible for summing items+ingredients values before calling it, same division of responsibility as `netProfit()`'s wastage-value parameter.
- `dashboard_stock_summary(p_from, p_to)` / `dashboard_ingredient_summary(p_from, p_to)` (`20260721140000_dashboard_periodic_cogs_columns.sql`) gained `opening_stock_value` and `added_stock_value`/`received_value` — genuine period-correct **values**, not just the quantities §3.7 already added. `opening_stock_value` follows the same point-in-time rule as `opening_stock` (each item's/ingredient's *earliest* row in the range, priced at that same row's own `buying_price_snapshot` — never today's catalog price). `added_stock_value`/`received_value` are real period sums, each row costed at its own snapshot price, same pattern as the existing `cost_value`/`wastage_value` columns (so a mid-period price change is captured correctly, never "latest price × total quantity").
- `app/api/dashboard/summary/route.ts` — `combined.costValue` is `periodicCogs()` over items (both locations) + ingredients combined. `byLocation.restaurant.costValue` folds in ingredients (restaurant's own central store, §3.2); `byLocation.canteen.costValue` is items-only (canteen has no ingredients). All three net-profit calls now receive this periodic cost instead of the old sold-based sum.
- **The dashboard's daily trend chart is deliberately unchanged** — `dashboard_daily_trend()` still returns the old `sum(quantity_sold * buying_price_snapshot)` per day. Periodic COGS only means something over a real range; a single day's opening/added/closing swings don't represent "cost of what moved that day," so applying this formula per-day would produce a spiky, misleading line rather than a meaningful one.
- Per-row `cost_value` (`stock_entries`/`ingredient_entries` themselves) is untouched — still `quantity_sold * buying_price_snapshot`, still correct and still used by the Item Master profit-by-date-range column (§3.6) and the admin ledger. Only the admin dashboard's top-line COGS/net-profit figures changed.

**Carried forward:** like §3.7, this is a read-side/aggregation change — no write path, no RLS policy, and no `stock_entries`/`ingredient_entries` schema change. If a future phase reintroduces a formal recipe/yield link between ingredients and items (currently out of scope, §3.2), this double-counting would need revisiting at that point — noting it here so it isn't rediscovered as a surprise.

---

## 3.9 Dashboard "Today" false-zero bug: closing stock must carry forward per item, not per location (post-launch bug fix, 2026-07-22)

**Client-reported bug** (WaPrecious): the admin dashboard's "Today" period showed "Closing Stock (Restaurant)," "Closing Stock (Canteen)," and every other stock-derived figure as **KES 0**, first thing in the morning, before any staff member had saved a stock entry for that day yet. Her expectation, in her own words: "If no sales have been made, I expect the previous day's Closing Stock to automatically appear on the dashboard as the current Opening Stock, and the Closing Stock should remain unchanged until there are sales or additional stock movements." Week/Month periods (which always include days with real entries) showed correct nonzero numbers — only a period with zero rows in range was affected.

### Root cause

`dashboard_stock_summary(p_from, p_to)` and `dashboard_ingredient_summary(p_from, p_to)` (§3.7, §3.8) were plain `where entry_date >= p_from and entry_date <= p_to` queries, `stock_summary` additionally `group by location`. **If zero rows exist in that date range for a location (or, for ingredients, the whole table), the query returns zero ROWS for that location — not a row with `closing_stock = 0`.** `app/api/dashboard/summary/route.ts` then does `restaurantStock?.closing_stock ?? 0` (same pattern for every other field, every location) — so "no row returned" silently became a displayed `0`, visually indistinguishable from "every unit of stock genuinely sold out." This affected every value/quantity column these two functions return for an affected location: `closing_stock`, `closing_stock_value`, `opening_stock`, `opening_stock_value`, `sales_value`, `cost_value`, etc.

This was a real correctness bug, not a client misunderstanding of what "closing stock" means — §3.1 already establishes that `opening_stock` carries forward from the prior period's `closing_stock` at the row-write level; this aggregation-layer bug just never carried that same idea into the dashboard's summary queries.

### The fix must be per item, not per location

A location can have some items entered for today and others not yet — each item needs its own independent fallback, not a location-wide "does anything exist in range" check. `20260722060000_dashboard_carry_forward_closing_stock.sql` rewrites both functions around a **per-item universe**: every `(item_id, location)` pair (ingredients: every `ingredient_id`) that has **ever** appeared in `stock_entries`/`ingredient_entries` — a plain `distinct`, not date-bounded. An item genuinely never entered at all correctly still contributes nothing (there is no "last known value" for it to carry forward, and it was never included in range under the old logic either).

For each item/location in that universe:

- **`closing_stock`/`closing_stock_value`** (point-in-time, period-end): the latest row **at or before `p_to`** — the `p_from` lower bound is dropped for this lookup specifically. An item with no row inside `[p_from, p_to]` now carries forward its last known closing stock instead of vanishing from the sum.
- **`opening_stock`/`opening_stock_value`** (point-in-time, period-start): the **closing** stock of the latest row **strictly before `p_from`** when one exists — falling back to the same "latest at or before `p_to`" lookup `closing_stock` uses when no earlier row exists at all (an item first touched mid-period has no prior balance, so its earliest known state is correctly both its opening and current figure — it had no stock before it existed).
- **Genuine period-sum columns** (`added_stock`, `added_stock_value`, `sent_out`, `quantity_sold`, `sales_value`, `cost_value`, `wastage_value` for stock; `received`, `received_value`, `quantity_used`, `wastage_value` for ingredients) are **unchanged** — real flows that occurred inside `[p_from, p_to]`, correctly zero for an item with no activity that period. Only the point-in-time balance columns needed the carry-forward fix; summing a genuine flow across a range an item had no activity in was never the bug.

This preserves §3.7's/§3.8's existing point-in-time-vs-period-sum distinction exactly — it extends the *carry-forward reach* of the point-in-time lookups (no longer bounded below by `p_from`), it does not change which columns are point-in-time vs. summed.

**Correction found in review, before this reached either hosted project:** the migration's first draft read the prior row's own `opening_stock` column for the `opening_stock` fallback (a same-name, wrong-column mistake) instead of that row's `closing_stock`. The prior row's `opening_stock` is what was on the shelf when *that* day started, before *that* day's own sales/wastage/etc. — reading it re-derives the prior day's cost movement instead of representing "nothing has moved since the last known close." Concretely, this made `costValue` compute a nonzero, sometimes **negative**, figure on a genuinely quiet "Today" (opening_stock_value ≠ closing_stock_value for the same fallback item, purely due to the wrong column, even though nothing had actually moved). Caught by comparing a live "Today" API response against expected values before deployment — fixed in the same migration file prior to being handed to the human to apply, so `prosper-hotel-dev`/`prime-hotel-demo` only ever received the corrected version.

### Why this doesn't touch COGS or the trend chart

`periodicCogs()` (`lib/calculations.ts`, §3.8) is unchanged — it already just combines whatever `opening_stock_value`/`added_stock_value`/`closing_stock_value` the aggregation functions hand it. Because the "Today" bug meant those inputs were false zeros, `combined.costValue` on a fresh morning was *also* silently wrong before this fix (a real `periodicCogs()` computed against three zeros collapses to zero) — this fix corrects that as a side effect, without changing the formula itself. `dashboard_daily_trend()` (the trend chart, §3.8) is untouched — it never had this bug, since it already returns one row per calendar day with activity and was never expected to backfill a day with none.

**Carried forward:** read-side/aggregation-only change — no write path, no RLS policy, no `stock_entries`/`ingredient_entries` schema change, no change to either function's returned column set (`lib/supabase/types.ts` needed no update). If a future column is added to either function, the same per-item-universe CTE structure (`universe` → `closing`/`opening_before` → `opening` → `period_sums` → final combine) should be extended rather than reverting to the old flat `group by` shape, or this bug class will resurface for that new column.

**Regression, same day (2026-07-23), caught in the live demo, not this doc's fault:** `20260723170000_dashboard_summary_estimated_values.sql` needed to add a `wastage_estimated_value` output column to `dashboard_stock_summary()`, which under Postgres requires a `DROP FUNCTION` + full `CREATE OR REPLACE` (column changes can't be done in place). The `CREATE` body it used was pasted from a version of the function that predated this section's carry-forward fix — reverting `dashboard_stock_summary()` to the old flat `group by location` shape with no `universe`/`closing`/`carry_forward` CTEs, exactly the warning in the paragraph above. `20260723180000_unconditional_estimated_value.sql` (§3.11) then needed its own `DROP FUNCTION` on the same function (to drop that same column again), and copied the body forward from `20260723170000` — propagating the same already-broken version rather than reintroducing it fresh. Symptom: the admin dashboard's aggregate "Closing Stock (Restaurant/Canteen)" figures showed a false `KES 0` for any period with zero `stock_entries` rows actually dated inside it — e.g. "Today" before it rolls over — while ingredient closing stock stayed correct, since `dashboard_ingredient_summary()` was untouched by either migration and kept its carry-forward body throughout. Fixed by `20260723200000_restore_stock_summary_carry_forward.sql`, which re-applies this section's CTE body verbatim on top of the current (post-estimated-value-drop) column set. **Lesson:** any future migration that needs to `DROP FUNCTION` + recreate one of these two functions for an unrelated reason (e.g. another column addition/drop) must diff its new body against this section's CTE structure before applying, not copy from an older snapshot — and a later migration touching the same function must diff against the CURRENT repo state, not blindly forward whatever the previous migration in the chain happened to contain.

**Investigated alongside the above, turned out NOT to be a bug:** the Ledger screen's PER-ROW `closing_stock_value`/`sales_value`/`cost_value` columns (`/dashboard/ledger`, `dashboard_item_ledger()`) also showed `KES 0` for rows with nonzero `closing_stock` quantities. `dashboard_item_ledger()` was never touched by any 2026-07-23 migration — it's a straight passthrough of `stock_entries.sales_value`/`cost_value`/`closing_stock_value` (`20260712121500_dashboard_aggregation_functions.sql`) — so this pointed at the stored row values, not an aggregation-function bug. A direct SQL check against `prime-hotel-demo`'s `stock_entries` confirmed: `buying_price_snapshot = 0.00` on every affected row, in exact lockstep with `items.buying_price = 0.00` for those same items (Chapati, Mukimo *, Porridge *, Samosa, etc.) — this is precisely §3.10's documented client-driven zeroing of `buying_price` on in-house-cooked menu items, working as intended, not a regression. "Ugali Beef" was the one row in the sample with a genuine nonzero `buying_price_snapshot` (20.00) and correspondingly nonzero `closing_stock_value` — confirming the formula itself is fine. No fix needed here.

---

## 3.10 Net profit stops double-counting wastage/staff meals; unified "Non-Sales Stock Consumption" (client-directed change, 2026-07-22, see `docs/backlog/05_stock_consumption.md`)

**The problem.** §3.8 switched dashboard COGS to WaPrecious's own periodic-inventory formula (`Opening Stock Value + Added Stock Value − Closing Stock Value`). Because wastage and staff meals both reduce `closing_stock` (§3.3, §3.5), their cost was **already** embedded in that COGS figure via a lower closing-stock value. But `netProfit()` also subtracted `wastageValue`/`staffMealValue` as separate terms — double-counting their cost against net profit. She also flagged the same overlap one level down and resolved it herself at the data level, by zeroing `items.buying_price` for ingredient-cooked menu items (no schema change required for that half).

**The fix — `netProfit()` drops wastage/staff-meal terms entirely:**

```
net_profit = sales_value − cost_value − expenses
```

Wastage, staff meals, and the two new categories below are now **reporting-only** — visible for stock-control purposes, never subtracted from profit (COGS already carries their cost via reduced closing stock).

### Two new consumption categories: complimentary meals and stock adjustments

Alongside the existing `wastage` (a `stock_entries`/`ingredient_entries` column pair, §3.3) and `staff_meal_entries` (§3.5), two new tables were added, both mirroring `staff_meal_entries`'s exact shape — item + quantity + optional note + staff attribution, `value = quantity * buying_price_snapshot`, own-location RLS:

- **`complimentary_meal_entries`** — menu items given away free (e.g. to a guest/visitor). Same shape and reasoning as staff meals, just a different real-world reason. Quantity is always positive.
- **`stock_adjustment_entries`** — a catch-all claim for reconciling a physical-count mismatch. **Signed** (see below) — the one category that isn't consumption-only.

`closing_stock`'s formula gains two more terms, alongside `wastage` and `staff_meals`:

```
closing_stock = total_stock − sent_out − quantity_sold − wastage − staff_meals − complimentary_meals − stock_adjustments
```

Same treatment in the oversell check (`lib/calculations.ts`'s `isStockEntryOversold()`). All six existing `stock_entries` writer functions (`save_stock_entry`, `save_canteen_stock_entry`, `apply_order_to_stock_entry`, `save_stock_entry_store_manager_fields`, `save_stock_entry_cashier_field`, `save_stock_entry_canteen_field`) got the same mechanical addition `staff_meals_total()` already established in §3.5 — two more `_total()` lookups (`complimentary_meals_total()`, `stock_adjustments_total()`), folded into the same arithmetic. Two new write functions, `create_complimentary_meal_entry()`/`create_stock_adjustment_entry()`, mirror `create_staff_meal_entry()` exactly: insert the claim row, then force a same-transaction `stock_entries` recompute, oversell re-check including the new claim's own quantity. See `20260722070000_complimentary_meal_and_stock_adjustment_entries.sql` and `20260722080000_stock_entries_complimentary_meals_and_adjustments.sql`.

### Stock adjustments are SIGNED (follow-up, same session)

**Client feedback, raised immediately after the first pass shipped:** physical recounts at Prosper Hotel sometimes find **more** stock than the system shows, not just less — a consumption-only (positive-quantity) model couldn't represent a surplus.

**Sign convention:** `stock_adjustment_entries.quantity` is signed — **positive = shortfall** (removes stock, same direction every other consumption category uses), **negative = surplus** (adds stock back). This is the least invasive option available: `closing_stock`'s formula above needed **no shape change** — subtracting a negative number already adds it back arithmetically — and the oversell check needed **no change either**, since a negative (surplus) adjustment only ever shrinks the check's left-hand side (can never cause a false rejection), while a positive (shortfall) adjustment is still capped exactly as before. None of the six writer functions' oversell arithmetic needed touching. Only `stock_adjustment_entries`'s column constraint (`check (quantity <> 0)`, was `check (quantity > 0)`) and `create_stock_adjustment_entry()`'s `value` derivation changed — see `20260722110000_signed_stock_adjustments.sql`, which also fixed a real bug found while regenerating `lib/supabase/types.ts`: `create_complimentary_meal_entry()`/`create_stock_adjustment_entry()`'s `p_note` parameter was declared without a `default null`, the same defect `20260719152000_staff_meal_entry_note_optional.sql` had already fixed once for `create_staff_meal_entry()` — Postgres requires optional parameters to trail required ones, so fixing this required dropping and recreating both functions with `p_note` moved to the end.

`value = quantity * buying_price_snapshot` still works signed: a shortfall gets a positive (cost) value, a surplus gets a negative value.

### UI: one shared component, an optional signed mode

`StockConsumptionClient.tsx` (`app/(staff)/expenses/`) is one shared component behind all three self-service `/expenses` tabs (Staff meals, Complimentary meals, Stock adjustments) — originally `StaffMealsClient.tsx` (§3.5), generalized once a second and third category needed the identical item-picker/stepper/running-list pattern rather than duplicating ~400 lines twice more. It takes a `signed` prop, used only by the Stock Adjustments tab: when set, a two-option toggle ("Remove" / "Add" — relabeled from "Missing stock" / "Found extra", 2026-07-22, client request for simpler wording) appears above the quantity stepper. "Remove" behaves exactly like every other category (capped at available stock, sent as a positive quantity). "Add" has **no upper cap** — you can't oversell by finding more stock than the system shows — and negates the quantity before sending it, so the server-side sign convention is set once at the UI layer, not re-derived per caller. The other two tabs never pass `signed`, so they're unaffected.

### Unified ledger presentation, not a unified table

Wastage (sourced from `stock_entries`/`ingredient_entries` columns, no per-claim identity) and the three per-claim tables (staff meals, complimentary meals, stock adjustments) don't share one row shape — forcing them into one physical table would mean nullable-heavy columns or losing wastage's per-item-per-day shape. Instead, `dashboard_stock_consumption_ledger(p_from, p_to, p_location)` (`20260722090000_dashboard_stock_consumption_ledger.sql`) returns a tagged union: one row shape with a `category: 'wastage' | 'staff_meal' | 'complimentary_meal' | 'stock_adjustment'` discriminant plus common displayable fields (date, item/ingredient name, location, quantity, value, note, staff name where applicable — null for wastage, which has no per-claim attribution). This replaced the admin ledger's old standalone "Staff meals" section with one "Non-Sales Stock Consumption" section, filterable by category chips. A signed `stock_adjustment` row is labeled distinctly in the ledger ("Stock adjustment (surplus)" / "Stock adjustment (shortfall)") and shown with an explicit `+`/`−` prefix rather than a bare number that would misread as always-a-loss.

### Dashboard summary

`app/api/dashboard/summary/route.ts` computes a `stockConsumption` block (`total` + `wastageValue`/`staffMealValue`/`complimentaryMealValue`/`stockAdjustmentValue`) on `combined` and on each `byLocation` entry, replacing the old separate `wastageValue`/`staffMealValue` fields that used to feed `netProfit()`. None of these four values are passed to `netProfit()` anymore — it only ever receives `salesValue`/`costValue`/`expenses`. The admin dashboard displays this as its own "Non-Sales Stock Consumption" comparison table, separate from the P&L comparison table above it, plus a new **"Total closing stock"** hero metric (client request, same session) — restaurant + canteen + ingredients summed into one figure, shown alongside (not replacing) the three existing split tiles. No backend change was needed for that last card: `combined.closingStockValue` was already computed this way (§3.7).

**Naming:** the section/UI label is **"Non-Sales Stock Consumption"** — a client-requested correction to the working title "Stock Consumption" used during the initial build (client feedback: the plain name didn't make clear this is stock that moved without a sale). Only the *display* label changed; the internal identifier (`stockConsumption` field name throughout the API/SQL/TypeScript, `dashboard_stock_consumption_ledger()` function name) was deliberately left as-is.

**Confirmed decision: a surplus stock adjustment DOES flow through to raise net profit, symmetric with how a shortfall lowers it (2026-07-22).** A stock adjustment (either direction) never touches `sales_value` directly — its only effect on money is indirect, through `closing_stock` feeding `periodicCogs()`. A shortfall lowers closing stock → raises COGS → lowers net profit; a surplus raises closing stock → lowers COGS → raises net profit. This was raised explicitly as a judgment call (a surplus often reflects a *past* recording error being corrected today — a delivery never logged, a miscounted prior recount — not new value genuinely earned in the current period) and confirmed: treat both directions symmetrically, no special-casing, matching how wastage and staff meals already only affect profit indirectly via COGS. If this ever needs revisiting (e.g. surpluses should be excluded from net profit and shown as a pure reconciliation figure instead), that's a real design change to `periodicCogs()`'s inputs, not a quick tweak.

**Display fix, same session:** `DashboardClient.tsx`'s comparison table and hero metric card initially showed `stockAdjustmentValue`/`stockConsumption.total` via a bare `money()` call, which rendered a surplus (negative value) as e.g. `KES -100` — reading as a loss when a staff member had just logged a `+10 Added` (surplus) entry. Added `moneySigned()`, used only for `stockAdjustmentValue` and any total that includes it (the other three consumption categories are never negative, so they keep plain `money()`), which shows an explicit `+` prefix for a negative value — mirroring the sign convention `LedgerClient.tsx`'s Non-Sales Stock Consumption section already used.

**Explicitly not in scope:** any payroll/deduction logic tied to consumption value; a formal reason-code taxonomy for stock adjustments beyond free-text `note` (same "no reason enum" precedent as `wastage_note`); any change to how ingredient wastage is entered (still an open gap per §3.3's Phase 10 correction, unrelated to this work).

**Carried forward:** `netProfit()`'s signature is now `{ salesValue, costValue, expenses }` only — any future caller must not reintroduce a wastage/staff-meal/consumption term into it. If ingredient wastage entry (§3.3's open gap) is ever built, it plugs into this same reporting-only "Non-Sales Stock Consumption" model, not into net profit.

---

## 3.11 Non-sales stock consumption valued at a flat 60%-of-selling-price rule (client feedback, 2026-07-23)

**The problem.** §3.10 noted that WaPrecious had zeroed `items.buying_price` for most/all ingredient-cooked menu items, at the data level, to avoid double-counting cost between menu-item-level and ingredient-level cost tracking (the same overlap `periodicCogs()`'s doc comment describes — an in-house-cooked item's own `buying_price` and the ingredient cost that produced it both contributing to COGS otherwise). That was and remains the right call, and net profit is correctly unaffected by it (§3.10). But `wastage_value`/`staff_meal_entries.value`/`complimentary_meal_entries.value`/`stock_adjustment_entries.value` were all `quantity * buying_price_snapshot` — with `buying_price_snapshot = 0`, every one of these figures collapsed to KES 0 for those items, even though real physical stock is genuinely moving (a wasted plate of chapati, a staff meal, a complimentary soda). WaPrecious wants visibility into how much non-sales stock is being consumed — a real KES estimate, not a bare zero — **without this touching profit calculations in any way.**

**First pass (same day, superseded within the session):** a dual-value model — kept the real buying-price-based `*_value` columns as-is, and added a parallel `*_estimated_value` column/set of fields that substituted `selling_price * estimated_cost_ratio` *only* when `buying_price` was 0. Direct client correction, reviewing the live dashboard: *"I dont want to assume she zeroed them all. Can we have it as this. All non sales stock values are computed by multiplying with 60% of the selling price - simple."* Confirmed: the rule should be **unconditional**, not branched on `buying_price`, and the dual-value UI (two numbers that would now always be equal) should collapse back to one. The paragraphs below describe the rule as it actually shipped — the dual-value/`effective_unit_cost()`/`*_estimated_value`-column approach was fully replaced, not layered underneath this.

**The rule, as shipped:**

```
value = quantity * selling_price_snapshot * estimated_cost_ratio
```

applied **unconditionally** to every wastage/staff-meal/complimentary-meal/stock-adjustment entry, regardless of what `buying_price` is for that item. This is the entirety of `stock_entries.wastage_value`, `staff_meal_entries.value`, `complimentary_meal_entries.value`, and `stock_adjustment_entries.value` now — there is no other formula, no buying-price branch, no separate "estimated" column sitting alongside a "real" one.

- `app_settings` (single-row, `id boolean primary key default true`, `check (id)`) still holds the one field: `estimated_cost_ratio numeric(4,3)` (default `0.600`), admin-editable via `PATCH /api/settings`, readable by any authenticated user via `GET /api/settings`. RLS unchanged: `select` for any logged-in user, `update` admin-only. `public.estimated_cost_ratio()` (a narrow read of that row) is still the one place every writer function reads it from. See `20260723110000_app_settings_estimated_cost_ratio.sql`.
- **Still snapshotted at entry write time**, same discipline as every other price in this schema (§ "Prices are snapshotted..." in the project's own constraints) — a later change to `estimated_cost_ratio` must not retroactively alter a past day's already-recorded `wastage_value`/`value`.
- `public.effective_unit_cost()` — the buying-price-fallback helper from the first pass — is **dropped**. There's no longer a "use buying price if present, else fall back" branch, so every call site is a direct `selling_price * estimated_cost_ratio()`. Same on the TypeScript side: `lib/calculations.ts`'s `effectiveUnitCost()` is removed; `calculateStockEntryTotals()` computes `wastageValue` directly as `wastage * sellingPriceSnapshot * estimatedCostRatio`.
- All six `stock_entries` writer functions (`save_stock_entry`, `save_canteen_stock_entry`, `apply_order_to_stock_entry`, `save_stock_entry_store_manager_fields`, `save_stock_entry_cashier_field`, `save_stock_entry_canteen_field`) and the three per-claim writer functions (`create_staff_meal_entry`, `create_complimentary_meal_entry`, `create_stock_adjustment_entry`) were rewritten so their `value`/`wastage_value` derivation is the unconditional formula above, with no other change to their oversell/closing-stock arithmetic. See `20260723180000_unconditional_estimated_value.sql`.
- The now-redundant parallel columns from the first pass — `stock_entries.wastage_estimated_value`, `staff_meal_entries.estimated_value`, `complimentary_meal_entries.estimated_value`, `stock_adjustment_entries.estimated_value` — are **dropped**. No backfill was needed or attempted for the columns being dropped, nor for the surviving `value`/`wastage_value` columns' new formula on rows written before this migration (consistent with this schema's general "we don't rewrite history, only new entries follow new rules" posture elsewhere — confirmed with the human, who did not want retroactive correction).
- `dashboard_stock_consumption_ledger()` (the unified tagged-union ledger, §3.10) and `dashboard_stock_summary()`/`dashboard_staff_meal_summary()`/`dashboard_complimentary_meal_summary()`/`dashboard_stock_adjustment_summary()` all dropped their `estimated_value`/`wastage_estimated_value` output columns, back to just `value`/`wastage_value`. Each of these return-shape changes required an explicit `drop function` before `create or replace` (Postgres's `42P13: cannot change return type of existing function` otherwise) — see `20260723180000_unconditional_estimated_value.sql` for the working pattern.

**`buying_price_snapshot`, `cost_value`, `closing_stock_value`, COGS (`periodicCogs()`), and net profit (`netProfit()`) are untouched by any of this** — restated explicitly because it's the invariant that matters most here. They keep using the real (possibly-zero) buying price exactly as before this whole feature existed; this change is scoped entirely to the four non-sales-consumption value columns.

**UI:** `LedgerClient.tsx`'s Non-Sales Stock Consumption table is back to a single "Value" column (no "Estimated value" column — there's only one figure now). The settings entry point is still there, relabeled "Cost ratio settings" (was "Estimated value settings") since "estimated value" as a concept distinct from "value" no longer exists; its modal copy no longer mentions zero-buying-price items. `DashboardClient.tsx`'s comparison table dropped the secondary "est. KES X" line under each cell (`.comparisonEstimated` CSS removed as unused) — each cell shows one number, which is now correctly non-zero for every item.

**Explicitly not in scope:** any per-item override of the ratio (one global admin-editable rate, not per-item — unchanged from the first pass); any change to `buying_price` itself (the zeroing WaPrecious already did at the data level is untouched and correct).

**Carried forward:** any future consumption category (if one is ever added alongside wastage/staff meals/complimentary meals/stock adjustments) should value itself the same unconditional way — `quantity * selling_price_snapshot * estimated_cost_ratio()` — not reintroduce a buying-price branch or a parallel estimated column. `netProfit()`/`periodicCogs()`'s inputs remain exactly `{ salesValue, costValue, expenses }` / `{ openingStockValue, addedStockValue, closingStockValue }` — no consumption-category value, real or estimated, may ever be added to either.

---

## 4. Row-Level Security (RLS) policies

RLS must be **enabled on every table**. These policies are the real security boundary — see `00_ARCHITECTURE.md` §5.

```sql
alter table public.users enable row level security;
alter table public.items enable row level security;
alter table public.ingredients enable row level security;
alter table public.ingredient_entries enable row level security;
alter table public.ingredient_purchases enable row level security;
alter table public.stock_entries enable row level security;
alter table public.expenses enable row level security;

-- Helper: is the current user an admin?
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Helper: what location is the current user scoped to? (null = admin/all)
create or replace function public.my_location()
returns location_type
language sql
security definer
stable
as $$
  select location from public.users where id = auth.uid();
$$;

-- USERS: everyone can read their own row; only admin can read/write all
create policy "users_select_own_or_admin" on public.users
  for select using (id = auth.uid() or public.is_admin());
create policy "users_admin_write" on public.users
  for all using (public.is_admin());

-- ITEMS: everyone (staff + admin) can read; only admin can write
create policy "items_select_all" on public.items
  for select using (true);
create policy "items_admin_write" on public.items
  for insert with check (public.is_admin());
create policy "items_admin_update" on public.items
  for update using (public.is_admin());

-- INGREDIENTS: restaurant staff + admin can read (canteen has no
-- reason to see ingredient catalog); only admin can insert a new
-- ingredient (catalog management stays admin-only, same pattern as
-- items). UPDATE is wider than INSERT: admin's manual price edits on
-- /ingredients need it, but so does record_ingredient_purchase()
-- (20260719161000_ingredient_purchases.sql) recalculating buying_price
-- as a weighted average -- that function is security invoker (this
-- project's standing convention), so it runs as whichever user called
-- it, and a store-manager-logged purchase needs its own UPDATE to
-- actually take effect, not just admin's. See
-- 20260719163000_ingredients_update_restaurant_scoped.sql -- this
-- replaced an admin-only UPDATE policy that silently no-op'd (zero
-- rows matched under RLS, no error) whenever the store manager logged
-- a purchase, discovered by direct testing.
create policy "ingredients_select_restaurant_or_admin" on public.ingredients
  for select using (
    public.is_admin() or public.my_location() = 'restaurant'
  );
-- Added 20260721110000_ingredients_insert_restaurant_scoped.sql: widened
-- from admin-only to admin-or-restaurant, same shape as the UPDATE
-- policy below -- needed so the store manager can use PurchaseModal's
-- inline "+ Add new ingredient" flow (see §3.2's "Inline 'add new'"
-- section), not just admin creating on /ingredients directly.
create policy "ingredients_admin_or_restaurant_insert" on public.ingredients
  for insert with check (
    public.is_admin() or public.my_location() = 'restaurant'
  );
create policy "ingredients_admin_or_restaurant_update" on public.ingredients
  for update using (
    public.is_admin() or public.my_location() = 'restaurant'
  );

-- INGREDIENT_ENTRIES: restaurant staff + admin can read; only the
-- authenticated user themself can insert (app-level check further
-- restricts this to the store-manager-flagged user -- see
-- 00_ARCHITECTURE.md §5.1, this is a UI/route-handler check, not
-- a separate RLS-enforced role, consistent with how store-manager
-- responsibilities are handled everywhere else); no update except
-- by admin, protects historical entries same as stock_entries.
-- `created_by = auth.uid() or public.is_admin()` (not created_by =
-- auth.uid() alone) -- see stock_insert_scoped below for why: Postgres
-- re-validates an INSERT policy's WITH CHECK on the DO UPDATE branch of
-- ON CONFLICT too, not just genuine inserts, so admin's ledger-row edit
-- (docs/backlog/04_admin_ledger_edit.md, PATCH /api/dashboard/ledger/entry)
-- would otherwise be rejected purely for preserving the row's original
-- created_by while editing as a different auth.uid().
create policy "ingredient_entries_select_restaurant_or_admin" on public.ingredient_entries
  for select using (
    public.is_admin() or public.my_location() = 'restaurant'
  );
create policy "ingredient_entries_insert_restaurant" on public.ingredient_entries
  for insert with check (
    (created_by = auth.uid() or public.is_admin())
    and (public.is_admin() or public.my_location() = 'restaurant')
  );
-- Same-day update is admin-or-restaurant-location (not "only the
-- original creator"), matching stock_update_location_scoped
-- (20260717120000) -- so a purchase logged by one restaurant staffer
-- doesn't lock a same-day row against a second, different restaurant
-- staffer's write (e.g. admin's purchase creates today's row, the
-- store manager's separate purchase the same day must still be able
-- to update it). See 20260719162000_ingredient_entries_update_location_scoped.sql.
create policy "ingredient_entries_update_admin_or_same_day_location" on public.ingredient_entries
  for update using (
    public.is_admin()
    or (public.my_location() = 'restaurant' and entry_date = current_date)
  );

-- INGREDIENT_PURCHASES: same shape as ingredient_entries above --
-- restaurant-location-scoped read/insert, admin sees/inserts
-- everywhere. No update/delete policy at all: purchases are an
-- append-only log, not an editable row -- a logging mistake is a
-- business problem for admin to resolve operationally (e.g. a
-- corrective follow-up purchase), not a UI edit path, matching how
-- orders/expenses are never retroactively edited either.
create policy "ingredient_purchases_select_restaurant_or_admin" on public.ingredient_purchases
  for select using (
    public.is_admin() or public.my_location() = 'restaurant'
  );
create policy "ingredient_purchases_insert_restaurant" on public.ingredient_purchases
  for insert with check (
    (created_by = auth.uid() or public.is_admin())
    and (public.is_admin() or public.my_location() = 'restaurant')
  );

-- STOCK_ENTRIES: staff see/write only their own location's rows;
-- admin sees/writes all; nobody can update a row they didn't create
-- unless they're admin (protects historical entries -- see scope doc).
-- `created_by = auth.uid() or public.is_admin()`, not created_by =
-- auth.uid() alone (discovered/fixed while building admin ledger-row
-- editing, docs/backlog/04_admin_ledger_edit.md): save_stock_entry()/
-- save_canteen_stock_entry() upsert via INSERT ... ON CONFLICT DO
-- UPDATE, and Postgres evaluates the INSERT policy's WITH CHECK on the
-- DO UPDATE branch too -- not just the separate UPDATE policy below --
-- so admin correcting an existing row while preserving its original
-- created_by (a different id than auth.uid(), by design -- see §3.4's
-- "Admin direct ledger-row edit" note) was rejected with a false "new
-- row violates row-level security policy" until this was widened.
create policy "stock_select_scoped" on public.stock_entries
  for select using (
    public.is_admin() or location = public.my_location()
  );
create policy "stock_insert_scoped" on public.stock_entries
  for insert with check (
    (created_by = auth.uid() or public.is_admin())
    and (public.is_admin() or location = public.my_location())
  );
-- Note: the UPDATE policy actually shipped is NOT admin-only -- it
-- evolved several times after this section was first written:
--  1. 20260711120001_same_day_update_policies.sql widened it to also
--     let a row's own created_by update it on the same day (staff
--     need to re-save/correct a stepper tap without admin help).
--  2. 20260711150001_canteen_current_week_update_policy.sql extended
--     "same day" to "same day, or same ISO week for canteen" to match
--     canteen's then-weekly cadence.
--  3. 20260717120000_stock_update_location_scoped.sql (post-launch,
--     2026-07-17) replaced the created_by check with a location check
--     -- see below for why.
--  4. 20260720120000_canteen_daily_cadence.sql (post-launch, 2026-07-20)
--     dropped the canteen-week OR branch entirely, once canteen's
--     period became a day (matching restaurant) -- keeping it would
--     have let a canteen staffer keep updating a stale week-Monday row
--     all week even under the new daily model, contradicting the point
--     of the conversion. See §3.1 and
--     docs/phases/postlaunch_canteen_daily_context.md.
create policy "stock_update_admin_or_current_period_location" on public.stock_entries
  for update using (
    public.is_admin()
    or (
      location = public.my_location()
      and entry_date = current_date
    )
  );
-- Gated by LOCATION, not by created_by = auth.uid(): a same-day/same-
-- week row is editable by admin, or by ANY staffer scoped to that
-- row's own location -- not just whoever's write happened to create
-- it. Fixed post-launch (2026-07-17) after live testing found the
-- prior created_by-scoped version let whichever restaurant staffer's
-- write created today's row for an item become its sole owner --
-- every OTHER same-location staffer (store manager vs. cashier, or
-- cashier vs. cashier) was then blocked with a raw RLS 403 from
-- writing that same item/day, breaking the "two writers, one stock
-- figure" invariant this very doc describes in §3.4: Janiffer's
-- added_stock/sent_out autosave and any cashier's till-sale save are
-- meant to land on the same row regardless of who touches it first.
-- Regression-checked by scripts/acceptance/post-launch-stock-entry-
-- multi-writer-rls.mjs.

-- EXPENSE_CATEGORIES: same triad as items/ingredients -- everyone
-- (staff + admin) can read (staff need this for their own /expenses
-- category picker), only admin can write (20260721090000_expense_categories_catalog.sql).
-- A DELETE policy was added post-launch, 2026-07-23 -- see
-- 20260723100000_expense_category_hard_delete.sql and §5.
create policy "expense_categories_select_all" on public.expense_categories
  for select using (true);
create policy "expense_categories_admin_write" on public.expense_categories
  for insert with check (public.is_admin());
create policy "expense_categories_admin_update" on public.expense_categories
  for update using (public.is_admin());

-- EXPENSES: same pattern as stock_entries. The is_admin() branch on
-- insert doesn't reference location at all, so it already permits admin
-- to insert any location value including null (business-wide) -- no
-- policy change was needed when location became nullable, see
-- 20260721070000_admin_business_wide_expenses.sql.
create policy "expenses_select_scoped" on public.expenses
  for select using (
    public.is_admin() or location = public.my_location()
  );
create policy "expenses_insert_scoped" on public.expenses
  for insert with check (
    created_by = auth.uid()
    and (public.is_admin() or location = public.my_location())
  );
create policy "expenses_update_admin_only" on public.expenses
  for update using (public.is_admin());
-- Admin-only delete (post-launch addition, 2026-07-21) -- a mistaken/
-- duplicate entry can be removed outright, not just corrected via
-- update. Unlike ingredient_purchases/canteen_stock_purchases, an
-- expense has no derived value (weighted-average cost, stock quantity)
-- to unwind on delete -- only summed at read time by
-- dashboard_expenses_summary() -- so this is a plain RLS-gated delete,
-- no companion cleanup RPC needed.
create policy "expenses_delete_admin_only" on public.expenses
  for delete using (public.is_admin());

-- STAFF_MEAL_ENTRIES: same location-scoped pattern as expenses, plus
-- self-attribution (a staff member can only log a claim as themselves --
-- see §3.5)
alter table public.staff_meal_entries enable row level security;

create policy "staff_meal_entries_select_scoped" on public.staff_meal_entries
  for select using (
    public.is_admin() or location = public.my_location()
  );
create policy "staff_meal_entries_insert_scoped" on public.staff_meal_entries
  for insert with check (
    created_by = auth.uid()
    and staff_id = auth.uid()
    and (public.is_admin() or location = public.my_location())
  );
create policy "staff_meal_entries_update_admin_only" on public.staff_meal_entries
  for update using (public.is_admin());

-- DELIVERY_LOCATIONS: everyone (staff + admin) can read, same
-- pattern as items; only admin can write
alter table public.delivery_locations enable row level security;

create policy "delivery_locations_select_all" on public.delivery_locations
  for select using (true);
create policy "delivery_locations_admin_write" on public.delivery_locations
  for insert with check (public.is_admin());
create policy "delivery_locations_admin_update" on public.delivery_locations
  for update using (public.is_admin());

-- ORDERS: same location-scoped pattern as stock_entries/expenses
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

create policy "orders_select_scoped" on public.orders
  for select using (
    public.is_admin() or location = public.my_location()
  );
create policy "orders_insert_scoped" on public.orders
  for insert with check (
    created_by = auth.uid()
    and (public.is_admin() or location = public.my_location())
  );
create policy "orders_update_admin_only" on public.orders
  for update using (public.is_admin());

-- ORDER_ITEMS: no location column of its own -- scoped via a join
-- back to the parent order's location, same principle as every
-- other location boundary in this schema
create policy "order_items_select_scoped" on public.order_items
  for select using (
    exists (
      select 1 from public.orders
      where orders.id = order_items.order_id
        and (public.is_admin() or orders.location = public.my_location())
    )
  );
create policy "order_items_insert_scoped" on public.order_items
  for insert with check (
    exists (
      select 1 from public.orders
      where orders.id = order_items.order_id
        and orders.created_by = auth.uid()
        and (public.is_admin() or orders.location = public.my_location())
    )
  );

-- ============================================================
-- AUDIT LOG: admin-read-only, and -- unlike every other table above --
-- no role can write to it directly, including admin. Writes only
-- happen through write_audit_log() below, a security definer function
-- called explicitly by route handlers (lib/audit.ts) -- never a plain
-- table insert. This is the entire point of an audit trail: if the
-- admin role could edit or delete entries through the client, the log
-- couldn't be trusted as a record of what the admin actually did.
-- ============================================================
alter table public.audit_log enable row level security;

create policy "audit_log_select_admin_only" on public.audit_log
  for select using (public.is_admin());

-- No insert/update/delete policy exists for any role. All writes go
-- through this function instead, which bypasses RLS via security
-- definer specifically so it can write regardless of RLS -- callers
-- never insert into audit_log directly.
create or replace function public.write_audit_log(
  p_actor_id uuid,
  p_action text,
  p_target_table text,
  p_target_id uuid,
  p_changes jsonb default null
)
returns void
language plpgsql
security definer
as $$
begin
  insert into public.audit_log (actor_id, action, target_table, target_id, changes)
  values (p_actor_id, p_action, p_target_table, p_target_id, p_changes);
end;
$$;

-- ============================================================
-- Cross-location exception: canteen needs the RESTAURANT's
-- sent_out figure for canteen_supplied items to populate its
-- daily added_stock (see §3.1). Table-level RLS on stock_entries
-- stays fully location-scoped -- do NOT widen the select policy
-- above to let canteen read restaurant rows directly. Instead,
-- expose only the narrow aggregate through a security definer
-- function, so canteen staff can never see the restaurant's
-- opening/closing stock, sales, or unrelated items.
-- ============================================================
create or replace function public.canteen_supplied_total(
  p_item_id uuid,
  p_week_start date,
  p_week_end date
)
returns numeric
language sql
security definer
stable
as $$
  select coalesce(sum(sent_out), 0)
  from public.stock_entries
  where item_id = p_item_id
    and location = 'restaurant'
    and entry_date >= p_week_start
    and entry_date <= p_week_end
    and exists (
      select 1 from public.items
      where id = p_item_id and supply_type = 'canteen_supplied'
    );
$$;

-- Callable by any authenticated canteen staff member or admin --
-- enforced in the route handler that calls it (canteen location
-- check), not by a table grant, since the function itself only
-- ever returns a single summed number, never full rows.
```

**Important for whichever phase implements this** (`04_PHASE_PLAN.md` Phase 2): test RLS by logging in as a `staff` account scoped to `restaurant` and confirming a query for `canteen` rows returns empty — not by reading the policy and assuming it works. Also test `canteen_supplied_total()` returns the correct sum when called as canteen staff, and confirm canteen staff still cannot query `stock_entries` directly for restaurant rows even though the function works. Also confirm canteen staff cannot read `ingredients`/`ingredient_entries` at all (empty result, not an error) — ingredient tracking is restaurant-only. See the acceptance criteria in `04_PHASE_PLAN.md`'s Phase 2 section.

### 4.1 Schema-level grants (not just RLS)

RLS policies alone are not sufficient — Postgres requires baseline `GRANT` privileges on top of them, and this is easy to miss because a dashboard-created Supabase project applies these invisibly, while a project built by hand-writing migrations (as this one is) does not get them for free. `anon`, `authenticated`, and `service_role` all need `usage` on the `public` schema plus table/sequence/routine grants; `service_role`'s `rolbypassrls = true` bypasses RLS checks specifically, but does **not** imply table-level grants — the two mechanisms are independent, and a role can pass every RLS check and still be refused at the grant layer underneath it. See `supabase/migrations/20260710110004_grants.sql` for the concrete statements (`grant all on all tables/sequences/routines in schema public`, plus matching `alter default privileges` so future migrations' new objects inherit the same grants automatically). Discovered in Phase 2 when the service-role staff-seeding script failed with `permission denied for table users` despite correct RLS policies and `service_role` RLS bypass — see `docs/phases/phase2_context.md` for the full story.

---

## 5. Deliberate omissions (don't "fix" these without checking the immediately-previous phase's `docs/phases/phaseX_context.md` first — see `CLAUDE.md`)

- **No `locations` table.** Only two locations will ever exist for this business (per discovery); a `location_type` enum is simpler and sufficient. If a third location is ever added, that's a deliberate future migration, not an oversight.
- **No debtor/credit ledger table.** Explicitly Phase 2 per the scope document. Don't add it speculatively.
- **Wastage is V1, not Phase 2 — this reverses an earlier decision.** It was originally deferred, but client input made clear it's needed now: without it, closing stock silently doesn't reconcile with a physical count after spoilage. See §3.3 for the full column-level treatment on both `stock_entries` and `ingredient_entries`. No separate wastage table — it's columns on the existing entry tables, not its own ledger, since a wastage event is always tied to a specific item/ingredient's entry for that period.
- **No soft-delete/delete on `stock_entries`.** Historical entries are never deleted, only correctable by admin via update (with the update itself logged via both `updated_at` and `audit_log`, see §3.4's "Admin direct ledger-row edit" note). **`expenses` is an explicit, narrower exception** (post-launch addition, 2026-07-21): admin can both edit (`expenses_update_admin_only`) and outright delete (`expenses_delete_admin_only`) an expense row, logged to `audit_log` either way — see the EXPENSES RLS section above. This diverges from `stock_entries` because an expense carries no derived value elsewhere (no weighted-average cost, no stock quantity) for a delete to leave inconsistent; don't infer from this that `stock_entries`/`ingredient_purchases`-style tables should also gain a general delete without the same reasoning applying.
- **`items`, `ingredients`, `delivery_locations`, and `expense_categories` all support real hard delete — the deactivate-only pattern is no longer the default for the catalog.** `items` gained this first (post-launch, 2026-07-21, direct client confirmation — see `supabase/migrations/20260721080000_item_hard_delete.sql`). `ingredients`, `delivery_locations`, and `expense_categories` followed (post-launch, 2026-07-23, separately confirmed — see `supabase/migrations/20260723080000_ingredient_hard_delete.sql`, `20260723090000_delivery_location_hard_delete.sql`, `20260723100000_expense_category_hard_delete.sql`), triggered by a real incident: an ingredient called "Smokies" was mistakenly tracked as both a menu item and a raw ingredient, and the client wanted the erroneous row gone entirely, not just deactivated. Each table's delete is admin-only, requires a real impact preview (`<table>_delete_impact()`) and type-the-name-to-confirm in the UI, and permanently removes history that references it:
  - `items` — deletes `stock_entries`/`canteen_stock_purchases`/`staff_meal_entries` and either deletes or recomputes `orders`/`order_items` (see the "ITEM HARD DELETE" block above the `items` schema).
  - `ingredients` — deletes `ingredient_entries`/`ingredient_purchases` (`staff_meal_entries.item_id` references `items`, not `ingredients`, so it's out of scope here).
  - `delivery_locations` — `orders.delivery_location_id` is nullable ("null for pickup"), so deleting a zone just nulls out that reference on any order that used it; the order, its fee, and its total are untouched. Materially smaller blast radius than the other three.
  - `expense_categories` — `expenses.category_id` is not null with no nullable escape, so deleting a category also deletes every expense filed under it.

  **Staff (`users`) accounts were explicitly excluded from this round** (client asked, 2026-07-23; considered and declined — not simply unconsidered): `created_by`/`staff_id` is a not-null FK on ~9 tables (`stock_entries`, `ingredient_entries`, `orders`, `expenses`, `ingredient_purchases`, `canteen_stock_purchases`, `staff_meal_entries`, and the complimentary-meal/stock-adjustment entry tables), and `audit_log.actor_id` is `on delete restrict` — a deliberate existing guard against ever deleting a referenced user. A full cascade would delete that staff member's entire transaction history business-wide, a categorically larger blast radius than any single catalog row. If this is revisited, the shape discussed and not yet built was: block the delete entirely unless the account has zero `created_by`/`staff_id`/`audit_log` rows anywhere (i.e. it only ever succeeds for an account that was created but never actually used) — not a cascade. Staff accounts remain deactivate/reactivate/PIN-reset-only, no delete route, until a future explicit request revisits this.
- **`items.supply_type` is deliberate, not speculative.** It exists specifically because the restaurant's central store supplies only a subset of items to canteen daily, while canteen also stocks unrelated items (cyber, some retail) entirely on its own — see §3.1. Don't remove or simplify this enum thinking it's over-engineering; it's load-bearing for the canteen `added_stock` aggregation.
- **No formal recipe / bill-of-materials linking `ingredients` to `items`.** The client only has a rough, informal sense of ingredient-to-dish conversion, not precise recipes — see §3.2. `ingredient_entries.quantity_used` and `stock_entries.added_stock` are independent numbers with no enforced relationship. Don't build automatic yield calculation speculatively; it's a real Phase 2 candidate if the client asks, not a V1 gap to quietly fill in.

---

## 6. Delivery orders — a real replacement for the WhatsApp process, not a speculative add

This section documents a genuine V1 scope addition made after initial planning, per direct client input: Prosper Hotel currently coordinates estate/home deliveries over a WhatsApp group, with no record-of-truth beyond the chat thread. `orders` + `order_items` + `delivery_locations` replace that group as the actual record, while staying deliberately narrow — see the exclusions below.

### What an order is, and isn't

An order is a **single customer transaction** — closer to a receipt than to a stock-entry row. It is distinct from `stock_entries` (location-level daily aggregates) but **feeds into it**: every item quantity on an order counts toward that day's `stock_entries.quantity_sold` for that item + location. An order is a second write-path into the existing stock ledger, not a parallel untracked record — if it didn't deduct from stock, closing stock and profit would silently stop reconciling with what was actually sold, the exact failure mode wastage tracking (§3.3) already exists to prevent.

**Critically, an order never writes `quantity_sold` directly** — it inserts into `order_items` and then calls `public.apply_order_to_stock_entry()` (Phase 6's atomic upsert function — see §3.4's implementation note for why it replaced the originally-planned plain `recalculate_stock_entry()` call), which always re-derives the combined total from its two source numbers, so the two write-paths can never race and clobber each other. See §3.4 for the full mechanism and why it's necessary (two independent flows writing the same row is a lost-update hazard if handled naively).

- **Walk-in till sales are unaffected.** The existing stepper-based `quantity_sold` entry flow (Phase 4) stays exactly as-is. Orders are only for the delivery/pickup channel that used to go through WhatsApp — not a redesign of the core entry screen, not a replacement for how walk-in sales are logged.
- **Logged as already-completed**, same mental model as a till sale entered at time of sale. No status/workflow field (no pending → fulfilled lifecycle), no rider/driver assignment, no customer accounts or order history beyond the flat log. These are deliberate V1 exclusions — see below.

### `delivery_locations` — admin-managed zone catalog

Prosper Hotel's admin (WaPrecious) sets up named delivery zones, each with a fixed fee (e.g., "Estate A — KES 100"). Staff logging an order pick a zone from this catalog rather than typing a fee themselves — same "don't make staff re-derive a number the system already knows" principle as opening-stock carry-forward (§3.1). `delivery_locations` supports admin-CRUD, deactivate/reactivate, **and** a real hard delete (post-launch, 2026-07-23 — see §5) — deleting a zone nulls out `delivery_location_id` on any past order that used it (nullable FK, "null for pickup") rather than deleting or rewriting the order itself.

- `fee` is **snapshotted onto the order** at write time (`orders.delivery_fee_snapshot`), same rationale as every other price snapshot in this schema (§3) — a later fee change at a zone must not silently alter a past order's recorded total.
- Pickup orders have no delivery zone (`delivery_location_id` is null, `delivery_fee_snapshot` is `0`).

### `orders` / `order_items` shape

- One `orders` row per customer transaction: `customer_name` (free text — a person, not a catalog entry), `location` (restaurant or canteen, scoped exactly like `stock_entries`/`expenses` — see §4), `fulfillment_type` (`delivery`/`pickup`), `delivery_location_id` + `delivery_fee_snapshot` (delivery only), `total_amount`, `client_request_id` (idempotency key, see §3.4), `created_by`, `order_date`.
- One or more `order_items` child rows per order (item_id, quantity, `selling_price_snapshot`) — mirrors a real receipt with multiple lines, rather than flattening a multi-item delivery into repeated rows that would duplicate customer/delivery context per item.
- `total_amount = sum(order_items.quantity * selling_price_snapshot) + delivery_fee_snapshot`, calculated in `lib/calculations.ts` alongside the existing stock/profit formulas (§3) — not a second calculations module.
- **Validation**: every `order_items.item_id` must be sellable at the order's `location` (`restaurant_only`/`canteen_supplied` items for a restaurant order; `canteen_supplied`/`canteen_independent` items for a canteen order) — enforced in `lib/validation.ts`, see §3.4.
- **Duplicate-submission protection**: `client_request_id` + `unique(created_by, client_request_id)` makes a retried "Save order" tap a no-op instead of a double-booked order — see §3.4.

### Deliberate V1 exclusions (don't build these without checking the immediately-previous phase's `docs/phases/phaseX_context.md` first — see `CLAUDE.md`)

- **No order status/lifecycle** (pending, out for delivery, fulfilled). Orders are logged after the fact as completed transactions.
- **No rider/driver assignment or delivery tracking.**
- **No customer accounts, repeat-customer lookup, or order history UI beyond the flat ledger.**
- **No WhatsApp API integration.** This is a manual replacement for the WhatsApp group as record-of-truth, not an automation of WhatsApp itself.
- These are real Phase 2 candidates if the client asks for them later — not gaps to quietly close now.
