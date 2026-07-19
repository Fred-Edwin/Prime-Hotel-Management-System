# Prosper Hotel Management System — Data Model

> Read `00_ARCHITECTURE.md` first if you haven't. This file is the single source of truth for the database schema. If application code and this file disagree, this file wins — update the code, or update this file explicitly and note why in the current phase's `docs/phases/phaseX_context.md` (see `CLAUDE.md`).

---

## 1. Entity overview

```
users               — staff and admin accounts (mirrors Supabase Auth users, plus role/location)
items               — shared item master of SELLABLE menu items (one list, used by both locations)
stock_entries       — daily (restaurant) / weekly (canteen) stock movement per sellable item
ingredients         — raw material catalog (flour, sugar, etc.) — never sold directly, only consumed
ingredient_entries   — daily central-store movement per ingredient (received, used in cooking)
expenses            — operating costs, kept separate from stock/items
staff_meal_entries  — self-service log of menu items staff consumed without paying, attributed per staff member (see §3.5)
delivery_locations  — admin-managed catalog of delivery zones + fixed fees (see §6)
orders              — customer delivery/pickup orders, replaces the client's WhatsApp-coordinated process (see §6)
order_items         — line items per order (see §6)
audit_log           — admin-read-only trail of sensitive admin actions; first pass covers Staff edit/deactivate/reactivate/PIN-reset only (see §2's audit_log section)
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

**Validation rule**: reject a write where `sent_out + quantity_sold + wastage + staff_meals > total_stock` (can't sell/send/waste/eat more than you have). Surface this as a clear inline error, not a silent clamp. Same rule applies to `ingredient_entries`: reject `quantity_used + wastage > opening_stock + received` (staff meals are a `stock_entries`-only concept — ingredients are consumed in cooking, never eaten directly by staff, see §3.2).

Because `quantity_sold` now has two contributors (§3.4), this check must run **after** `public.recalculate_stock_entry()` recomputes the combined total, inside the same transaction — not against just the field the current write-path is touching. A till save that would push the *combined* total over `total_stock` must be rejected even if `till_quantity_sold` alone looks fine, and the same for an order that would push it over given the existing `till_quantity_sold`. Either write-path can be the one that tips it over; the check has to see the whole picture, not just its own contribution.

---

## 3.1 Opening stock carry-forward and the restaurant→canteen supply chain

This section exists because the old Excel workflow's two most time-consuming manual habits — re-copying yesterday's leftover count, and manually reconciling what the store sent to canteen — must be eliminated by the system, not preserved as manual data entry. Getting this wrong reintroduces exactly the busywork this product exists to remove.

### Opening stock is never freely typed

For a given item + location, `opening_stock` on a new entry is **auto-populated from the immediately prior period's `closing_stock`** for that same item + location:

- **Restaurant (daily):** today's `opening_stock` = yesterday's `closing_stock`.
- **Canteen (weekly):** this week's `opening_stock` = last week's `closing_stock`.
- **First-ever entry for an item** (no prior row exists for that item+location): `opening_stock` defaults to `0`, or an admin can set an explicit initial count when introducing a new item mid-operation (a one-time correction, not a recurring input).
- Staff can still see the value on the entry screen (it's meaningful context), but it is **not an editable input field** in the normal flow — the whole point is that nobody re-types it. If a correction is genuinely needed (a miscount was carried forward), that's an admin-level edit to the historical row, per the existing "staff can't edit past entries" RLS rule.

### Canteen's `added_stock` is sourced from the restaurant's `sent_out`, aggregated over the week

The client's actual process: the restaurant's store manager sends a **subset of items** to canteen **every day**; canteen only counts/reconciles stock **weekly**. This is a cadence mismatch the schema must bridge explicitly:

- Only items with `supply_type = 'canteen_supplied'` (see §2 `items.supply_type`) participate in this flow. `restaurant_only` items never appear on canteen's sheet at all; `canteen_independent` items (e.g. cyber, some retail lines) are entirely canteen's own stock with no restaurant-side row ever.
- For a canteen weekly entry covering week W, `added_stock` for each `canteen_supplied` item = **`sum(sent_out)`** across all seven of the restaurant's daily `stock_entries` rows for that item during week W.
- This is a genuine **cross-location read**: canteen staff need to see an aggregate of restaurant data they otherwise have no access to under the location-scoped RLS in §4. The read must be scoped narrowly — canteen can see the **summed `sent_out` figure only**, not the restaurant's full stock_entries rows (not opening/closing stock, not sales, not other items). Implemented as a `security definer` function (e.g. `public.canteen_supplied_total(item_id, week_start, week_end)`), not a broadened table-level RLS policy — see §4 for the concrete function.
- Canteen's `added_stock` is therefore also **not freely typed** for `canteen_supplied` items — it's system-populated the same way `opening_stock` is, for the same reason. It remains a normal editable input for `canteen_independent` items, since those have no restaurant-side source to pull from.

### What this means for the entry screens (detail for `04_PHASE_PLAN.md` Phases 4–5)

- Restaurant staff never see or touch `opening_stock` as an input — it's a read-only context line ("Opening: 36").
- Restaurant's store manager manually enters `added_stock` and `sent_out` on the restaurant entry screen — but as of §3.2, `added_stock` here means "menu items produced today and kept on the restaurant floor," not a raw supplier delivery. Raw ingredient deliveries are tracked separately (§3.2).
- Canteen staff never type `opening_stock` or `added_stock` for `canteen_supplied` items — both are shown read-only, pulled from the carry-forward and aggregation rules above. They do type `added_stock` for `canteen_independent` items, and `quantity_sold` for everything.

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

---

## 3.3 Wastage

Wastage is tracked at **both** stages — finished menu items (`stock_entries`) and raw ingredients (`ingredient_entries`) — because spoilage genuinely happens at both ends: vegetables and other ingredients can go bad before they're ever cooked, and prepared food can go unsold and spoil, or get dropped/broken, after production. This was originally scoped as a Phase 2 nice-to-have (see the old note in §5); it's now V1 scope per direct client input, since without it the numbers don't reconcile with a physical count.

**Correction (Phase 10, post-launch redesign of `/store`):** ingredient wastage entry was moved off the store manager's `/store` screen. `ingredient_entries.wastage`/`wastage_note` still exist and still reduce `closing_stock`/appear as `wastage_value` exactly as described below — only *who enters it and where* changed, not the underlying model. Responsibility for entering ingredient wastage moves to admin; as of this redesign **no screen writes a non-zero ingredient wastage value** — this is a real, currently-open gap (no admin-side wastage entry screen has been built yet), not a design decision to leave wastage uncollected indefinitely.

**Correction (post-launch redesign of `/entry`, same session as the store-manager `/entry` autosave rework):** `stock_entries.wastage` entry was likewise removed from `/entry` entirely — both the store-manager view (`EntryClient.tsx`) and regular staff's view, restaurant and canteen (`CanteenEntryClient.tsx`) alike. `stock_entries.wastage`/`wastage_note`/`wastage_value` still exist and behave exactly as described below; only *who enters it and where* changed. Responsibility for entering it moves to admin via the existing ledger direct-edit path (`PATCH /api/dashboard/ledger/entry`, §3.4's "Admin direct ledger-row edit") — unlike ingredients, this doesn't leave the gap open: the ledger edit screen already existed before this change and keeps working exactly as before, so `stock_entries.wastage_value` remains collectible today, just via a different screen. `save_stock_entry()`/`save_canteen_stock_entry()` were changed so `p_wastage`/`p_wastage_note` default to `null`, meaning "preserve whatever the row already has," instead of always overwriting — this was necessary because these are full-row-overwrite functions and the till-entry batch save route no longer sends a wastage value at all; without this change, an ordinary daily till save would have silently zeroed out any wastage the admin had set via the ledger. The admin ledger edit route is unaffected — its schema still requires a real numeric wastage value on every call, so it keeps setting wastage explicitly. See `20260717093000_preserve_wastage_on_stock_entry_save.sql`.

### Why wastage can't just be folded into "closing stock" or ignored

Without a dedicated `wastage` column, any item that spoils or is discarded has nowhere to go in the model — it's not a sale (`quantity_sold`), not a transfer (`sent_out`), so it would either wrongly inflate `closing_stock` (the system thinks stock is on hand that physically isn't) or force staff to fudge `quantity_sold` to make the physical count match, which corrupts the sales/profit figures. Neither is acceptable — this is exactly the kind of quiet data corruption the rest of this document goes out of its way to prevent.

### Shape: quantity + optional note, no reason enum

- `wastage` (numeric) — the quantity spoiled/discarded/wasted that period, entered by whoever is already logging that row (regular staff or store manager for `stock_entries`; **admin, as of the Phase 10 correction above, for `ingredient_entries`** — no admin-side entry screen exists yet, see the correction note).
- `wastage_note` (nullable text) — optional free-text reason ("left out overnight," "customer return," "dropped tray"). No fixed reason-category enum in V1 — mirrors how `expenses.note` is already free text rather than a rigid taxonomy, and the client hasn't asked for structured wastage reporting by category.

### How wastage affects the numbers

- `closing_stock` is reduced by `wastage` (see the updated formula in §3), so the system's stock figure reconciles with a physical count even after spoilage.
- `wastage_value = wastage * buying_price_snapshot` is a **distinct, visible cost** on the admin dashboard and ledger (`04_PHASE_PLAN.md` Phase 7) — separate from `cost_value` (COGS on what was actually sold) and from `expenses`. This is deliberate: WaPrecious should be able to see "we lost KES X to waste this week," not have that loss silently disappear into a lower closing-stock number she'd have to notice was smaller than expected.
- Net profit's formula (`00_ARCHITECTURE.md`, `04_PHASE_PLAN.md` Phase 7) should be read as: sales_value − cost_value − expenses − wastage_value, so wastage is an explicit deduction, not an invisible one.

---

## 3.4 Two writers, one stock figure: how orders and till sales share `stock_entries` safely

This section exists because `orders` (§6) and the till-sale entry screen (`04_PHASE_PLAN.md` Phase 4) are **two independent flows that both need to affect the same `stock_entries` row** for a given item + location + date. Handled naively (both flows reading the row, computing a new total client-side, and writing it back), this is a textbook lost-update race: a delivery order logged at 11am can be silently erased by a till "Save entry" at 5pm if that save was computed from stock data fetched before 11am. This is exactly the kind of quiet data corruption the rest of this document (opening-stock carry-forward, wastage, price snapshots) already goes out of its way to prevent — the same discipline has to extend to this new write-path.

### The fix: split the column, never overwrite, only increment

- **`stock_entries.till_quantity_sold`** — written *only* by the stock-entries route (Phase 4's stepper/till-strip flow). This is the number a staff member directly taps in. It is fine for this column to be replaced wholesale on each "Save entry," because only one flow ever writes it and only one person is editing a given location's sheet on a given day in practice.
- **`stock_entries.quantity_sold`** — the total sold, `till_quantity_sold + sum(order_items.quantity)` for that item/location/date. This is the figure `closing_stock`, `sales_value`, and `cost_value` are calculated from (§3) — nothing downstream changes.
- **Neither write-path ever sends an absolute "new total" for `quantity_sold`.**

**Implementation note (Phase 6, superseding the originally-planned `recalculate_stock_entry()` call below):** the original plan was for the orders route to call a plain `UPDATE`-only `recalculate_stock_entry(item_id, location, entry_date)` function after inserting `order_items`. Phase 6 found it insufficient and built `public.apply_order_to_stock_entry()` instead — see `20260712080310_orders_write_function.sql`. The reason: `recalculate_stock_entry()`'s `UPDATE` assumes a `stock_entries` row already exists for that item/location/date, which is only true once a till entry has been saved. An order can easily be the **first** write of the period for an item (a delivery placed before the till sheet is ever touched that day) — there is no row to `UPDATE`, and `closing_stock`/`sales_value`/`cost_value`/`closing_stock_value`/`wastage_value` have no column defaults to fall back on. `apply_order_to_stock_entry()` does the same opening-stock-carry-forward-and-upsert work `save_stock_entry()`/`save_canteen_stock_entry()` already do, except it never writes `till_quantity_sold`, `sent_out`, or `wastage` (those remain whatever the till-entry flow last saved, or 0/defaults) — only `quantity_sold` and its downstream values move, always re-derived from a **fresh** sum of `order_items` for that item/location/period (never incremented by "this order's quantity"), so concurrent writers still can't clobber each other. It is also cadence-aware: for a `canteen` order it resolves `order_date` to that week's Monday `entry_date` before touching `stock_entries` (mirroring `save_canteen_stock_entry()`'s convention) and re-derives `added_stock` via `canteen_supplied_total()` for `canteen_supplied` items — otherwise a canteen order would create a stray extra daily row instead of folding into the existing weekly one (a real bug caught during this phase's own live testing, not part of the original design). **`recalculate_stock_entry()` itself was dropped in Phase 8** (`20260713100000_drop_dead_recalculate_stock_entry.sql`) as part of that phase's tech-debt sweep, having been confirmed unused since Phase 6 — no route handler ever called it.

- The **stock-entries route** (Phase 4) writes `till_quantity_sold` directly (client sends the day's absolute stepper values, as originally designed — only one person edits their own location's till sheet, so this remains safe).
- The **orders route** (§6) inserts the order + `order_items`, then calls `apply_order_to_stock_entry()` for each distinct item on the order. It never touches `till_quantity_sold`, `sent_out`, or `wastage`, and never writes `quantity_sold` directly.
- Both routes run their writes inside a single database transaction (a single Postgres function call per save — `save_stock_entry()`/`save_canteen_stock_entry()`/`create_order()` — since PostgREST/the Supabase JS client has no client-driven multi-statement transaction), so a crash or network drop mid-write can't leave `quantity_sold` out of sync with its two inputs.

**Row-locking fix (found post-Phase-6, while writing `scripts/acceptance/phase6-orders.mjs` — see `20260712091633_stock_entry_row_locking.sql`):** the three write functions above (`save_stock_entry`, `save_canteen_stock_entry`, `apply_order_to_stock_entry`) each did a plain, non-locking `SELECT` to check whether a `stock_entries` row already existed for the target item/location/period, computed their oversell check and derived values from that snapshot, then `INSERT ... ON CONFLICT DO UPDATE`. This has a genuine race when two calls are both the **first-ever write** for a brand-new row (e.g. a till save and a delivery order landing at the same moment for an item nobody has touched yet that day): both see "no row," both compute their oversell check from their own inputs only, and both attempt the insert. Postgres serializes the actual row conflict for you, but it does **not** re-run the PL/pgSQL function body for whichever call blocks — the blocked call's `ON CONFLICT DO UPDATE SET` clause still fires using `EXCLUDED` values computed from the stale pre-block snapshot. The observed failure mode was a false oversell rejection (a legitimate order returned `409` even though the combined total was well within stock) — a wrong-rejection bug, not silent data loss, but still a real defect in the exact property this section exists to guarantee. **Fix:** each function now calls `public.lock_stock_entry_row(item_id, location, entry_date)` — a `pg_advisory_xact_lock` keyed on that triple — as its very first statement, before any read. This serializes the whole read-decide-write sequence per row (not just the final `INSERT`'s conflict resolution): a second caller blocks on the lock itself, and by the time it acquires the lock and runs its own `SELECT`, the first caller's row is already committed and visible. The lock is transaction-scoped (no explicit unlock needed) and released automatically when the function's implicit transaction ends, matching the existing "one function call = one transaction" model. Verified via a repeated concurrent-request stress test (till save + order racing on a brand-new row, run 8+ times back to back) — no false rejections after the fix, oversell still correctly rejected when the combined total genuinely exceeds stock.

**Batch-save wrappers (Phase 9 — see `20260713183705_batch_save_functions.sql`):** the client-side entry/store screens save a whole day's/week's sheet in one submit, but before Phase 9 the route handlers (`app/api/stock-entries/route.ts`, `app/api/ingredient-entries/route.ts`) looped over every line and `await`ed one `supabase.rpc()` call per line — a separate network round trip per item. With the real 132-item catalog (Phase 8), a single "Save" tap meant dozens of sequential round trips (the reported "Save feels slow" complaint from live client testing). **Fix:** three new plpgsql wrapper functions — `save_stock_entries_batch()`, `save_canteen_stock_entries_batch()`, `save_ingredient_entries_batch()` — each accepts the whole batch as a `jsonb` array and loops **server-side**, calling the existing single-row `save_stock_entry()`/`save_canteen_stock_entry()`/`save_ingredient_entry()` per line inside one transaction. This is a pure loop relocation (Node process → Postgres), **not** a rewrite of the correctness logic above: the per-row `lock_stock_entry_row()` advisory lock and oversell re-check still fire once per line, exactly as before. Locking stays per-row, not per-batch, so a till save and a concurrent delivery order on a *different* item in the same batch still don't block each other unnecessarily. The one behavior change (an improvement, not a regression): a failure on any line now rolls back the **entire batch** atomically in one transaction, where previously a failed line simply meant the client had made it partway through its own loop before hitting the error — earlier lines in that loop had already independently committed. Verified via `scripts/acceptance/phase9-batch-save.mjs`.

### Admin direct ledger-row edit (docs/backlog/04_admin_ledger_edit.md)

A third caller of `save_stock_entry()`/`save_canteen_stock_entry()`/`save_ingredient_entry()` exists alongside the staff entry-screen save path and the batch-save wrappers above: `PATCH /api/dashboard/ledger/entry`, admin-only, the edit affordance built into the Ledger screen (`app/(admin)/dashboard/ledger/LedgerClient.tsx`). No new tables or functions were added for this — it's a thin route that re-derives quantities through the exact same single-row functions staff writes already use, so none of this section's correctness guarantees (opening-stock carry-forward, oversell re-check, row locking) needed to change.

Three things this route enforces that the ordinary staff save path doesn't need to, because staff only ever save "today"/"this week":

1. **Most-recent-row-only, no cascade.** Before calling the save function, the route checks for a later `entry_date` row for the same `item_id`+`location` (`stock_entries`) or `ingredient_id` (`ingredient_entries`) and rejects with `409` if one exists — editing an older row would silently invalidate the `opening_stock` every row after it was derived from. To correct something further back, the admin edits forward one entry at a time. Deliberately not auto-cascaded (see the backlog doc's resolved design decision — the blast radius of silently rewriting a long dependent chain was judged too large for a first version).
2. **Price snapshots are permanently immutable through this route.** `selling_price_snapshot`/`buying_price_snapshot` are fetched from the existing row (or the current catalog, only for a brand-new "today" row with nothing to preserve) and passed straight back into the save function unchanged — the route's Zod schema doesn't even accept these fields from the client.
3. **`created_by` is preserved as the row's original author**, fetched before the save call and passed back in as `p_created_by` — these save functions only set `created_by` on the initial `INSERT`, so this is a no-op for an existing row's real-world attribution. A brand-new row (no existing entry for that item/date — this is also how admin logs "today's" entry herself, the same form handling both cases per the backlog doc's scope item 5) legitimately gets `created_by` = the admin's own id, since that genuinely is who logged it.

Every successful edit writes an `audit_log` entry (`stock_entry.admin_edit` / `ingredient_entry.admin_edit`, before/after quantities) via `lib/audit.ts` — the audit trail is what records *which admin* made the correction, separately from `created_by` staying the original staff member.

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

Even though both fields belong to the same staffer, this is still built as a dedicated partial-update function — `save_stock_entry_canteen_field()` (`20260717140000_stock_entry_canteen_autosave.sql`), not `save_canteen_stock_entry()` directly — for the same reason the restaurant's two autosave writers each got their own function: two independent debounce timers on two different inputs are still two independent writes that can interleave, and `save_canteen_stock_entry()` unconditionally overwrites both `added_stock`/`till_quantity_sold` together on every call. Unlike the restaurant split, this is **one function** taking both quantity parameters as independently nullable ("omit to preserve the existing row's value") rather than two separate RBAC-gated functions — canteen has no cross-role boundary to enforce between the two fields, so one shared function avoids duplicating the opening-stock/order-total/oversell logic twice. `putCanteenField()` always calls it with exactly one of the two parameters set (`canteenStockEntryFieldSaveSchema` in `lib/validation.ts` enforces this at the route layer) and the other omitted. Same `lock_stock_entry_row()` advisory lock as every other writer in this section. `entry_date` is re-normalized to that week's Monday server-side inside the route handler, never trusted verbatim from the client — same convention as the existing GET/POST canteen paths.

**The two distinct oversell cases (resolved design call, this session):** canteen's single-person-both-fields shape means a `canteen_independent` item's oversell is almost always a genuine one — Anne owns both `added_stock` and `quantity_sold` herself for those, with no other actor in between. But `canteen_supplied` items retain an external dependency even under this redesign: `added_stock` is `canteen_supplied_total()`, a sum of the *restaurant's* daily `sent_out` for that item across the week (§3.1) — an upstream actor entirely separate from Anne. If Anne autosaves a `quantity_sold` for a `canteen_supplied` item before the restaurant has sent anything that week, `added_stock` resolves to 0 and the oversell check fails — not because Anne did anything wrong, but because the restaurant hasn't supplied yet. This is analogous to (but not identical to) the cashier autosave's "store manager hasn't logged today's added stock" case above: same "the failure isn't the current user's fault" shape, different upstream actor (the restaurant's daily sends, not a same-screen store-manager field).

The chosen fix mirrors the cashier autosave's approach — a distinctly-diagnosed rejection instead of the generic oversell message, but **only for `canteen_supplied` items with `added_stock = 0`**; a `canteen_independent` item's oversell always gets the generic message, since there's no upstream actor to blame there. Implemented via a third distinct SQLSTATE:

- **`save_stock_entry_canteen_field()`** raises `errcode 'P0003'` (message `not_yet_supplied: ...`) when `p_is_canteen_supplied` is true, the derived `added_stock` (`canteen_supplied_total()`) is 0, **and** the requested total still exceeds `opening_stock` — critically, exactly the same "opening stock alone might legitimately cover this" carve-out the cashier's `P0002` case uses: selling purely against last week's leftover stock, with nothing sent this week at all, is a normal, expected case and must succeed, not be blocked.
- A genuine oversell — either a `canteen_independent` item's insufficient total, or a `canteen_supplied` item where the restaurant HAS sent something this week (`added_stock > 0`) but the combined total still isn't enough — keeps the existing generic `'oversell'` (`P0001`) exception, same as every other writer.

`lib/errors.ts`'s `describeSaveError()` checks `error.code === "P0003"` (or the `not_yet_supplied` message substring) — surfaced as `"The restaurant hasn't sent this week's supply yet for this item."` — positioned alongside its existing `P0002` check, both before the generic `"oversell"` check, so none of the three rejection cases collide into the wrong message. Regression-checked by `scripts/acceptance/post-launch-canteen-autosave.mjs`, including the concurrent first-writer race (mirroring the row-locking test above), week-Monday normalization of a mid-week `entry_date`, and confirming a genuine `canteen_independent` oversell still gets the original generic message.

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

## 4. Row-Level Security (RLS) policies

RLS must be **enabled on every table**. These policies are the real security boundary — see `00_ARCHITECTURE.md` §5.

```sql
alter table public.users enable row level security;
alter table public.items enable row level security;
alter table public.ingredients enable row level security;
alter table public.ingredient_entries enable row level security;
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
-- reason to see ingredient catalog); only admin can write, same
-- pattern as items
create policy "ingredients_select_restaurant_or_admin" on public.ingredients
  for select using (
    public.is_admin() or public.my_location() = 'restaurant'
  );
create policy "ingredients_admin_write" on public.ingredients
  for insert with check (public.is_admin());
create policy "ingredients_admin_update" on public.ingredients
  for update using (public.is_admin());

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
create policy "ingredient_entries_update_admin_only" on public.ingredient_entries
  for update using (public.is_admin());

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
-- evolved twice after this section was first written:
--  1. 20260711120001_same_day_update_policies.sql widened it to also
--     let a row's own created_by update it on the same day (staff
--     need to re-save/correct a stepper tap without admin help).
--  2. 20260711150001_canteen_current_week_update_policy.sql extended
--     "same day" to "same day, or same ISO week for canteen" to match
--     canteen's weekly cadence.
--  3. 20260717120000_stock_update_location_scoped.sql (post-launch,
--     2026-07-17) replaced the created_by check with a location check
--     -- see below for why.
create policy "stock_update_admin_or_current_period_location" on public.stock_entries
  for update using (
    public.is_admin()
    or (
      location = public.my_location()
      and (
        entry_date = current_date
        or (location = 'canteen' and entry_date = date_trunc('week', current_date)::date)
      )
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

-- EXPENSES: same pattern as stock_entries
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
-- sent_out totals for canteen_supplied items to populate its
-- weekly added_stock (see §3.1). Table-level RLS on stock_entries
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
- **No soft-delete on `stock_entries`/`expenses`.** Historical entries are never deleted, only correctable by admin via update (with the update itself still logged via `updated_at`, and — for `stock_entries`/`ingredient_entries` specifically — via `audit_log` too, see §3.4's "Admin direct ledger-row edit" note). If an audit trail of *changes* (not just current state) becomes a requirement for `expenses` as well, that's a new decision to make explicitly, not something to bolt on silently.
- **`items.supply_type` is deliberate, not speculative.** It exists specifically because the restaurant's central store supplies only a subset of items to canteen daily, while canteen also stocks unrelated items (cyber, some retail) entirely on its own — see §3.1. Don't remove or simplify this enum thinking it's over-engineering; it's load-bearing for the canteen `added_stock` aggregation.
- **No formal recipe / bill-of-materials linking `ingredients` to `items`.** The client only has a rough, informal sense of ingredient-to-dish conversion, not precise recipes — see §3.2. `ingredient_entries.quantity_used` and `stock_entries.added_stock` are independent numbers with no enforced relationship. Don't build automatic yield calculation speculatively; it's a real Phase 2 candidate if the client asks, not a V1 gap to quietly fill in.

---

## 6. Delivery orders — a real replacement for the WhatsApp process, not a speculative add

This section documents a genuine V1 scope addition made after initial planning, per direct client input: Prosper Hotel currently coordinates estate/home deliveries over a WhatsApp group, with no record-of-truth beyond the chat thread. `orders` + `order_items` + `delivery_locations` replace that group as the actual record, while staying deliberately narrow — see the exclusions below.

### What an order is, and isn't

An order is a **single customer transaction** — closer to a receipt than to a stock-entry row. It is distinct from `stock_entries` (location-level daily/weekly aggregates) but **feeds into it**: every item quantity on an order counts toward that day's `stock_entries.quantity_sold` for that item + location. An order is a second write-path into the existing stock ledger, not a parallel untracked record — if it didn't deduct from stock, closing stock and profit would silently stop reconciling with what was actually sold, the exact failure mode wastage tracking (§3.3) already exists to prevent.

**Critically, an order never writes `quantity_sold` directly** — it inserts into `order_items` and then calls `public.apply_order_to_stock_entry()` (Phase 6's atomic upsert function — see §3.4's implementation note for why it replaced the originally-planned plain `recalculate_stock_entry()` call), which always re-derives the combined total from its two source numbers, so the two write-paths can never race and clobber each other. See §3.4 for the full mechanism and why it's necessary (two independent flows writing the same row is a lost-update hazard if handled naively).

- **Walk-in till sales are unaffected.** The existing stepper-based `quantity_sold` entry flow (Phase 4) stays exactly as-is. Orders are only for the delivery/pickup channel that used to go through WhatsApp — not a redesign of the core entry screen, not a replacement for how walk-in sales are logged.
- **Logged as already-completed**, same mental model as a till sale entered at time of sale. No status/workflow field (no pending → fulfilled lifecycle), no rider/driver assignment, no customer accounts or order history beyond the flat log. These are deliberate V1 exclusions — see below.

### `delivery_locations` — admin-managed zone catalog

Prosper Hotel's admin (WaPrecious) sets up named delivery zones, each with a fixed fee (e.g., "Estate A — KES 100"). Staff logging an order pick a zone from this catalog rather than typing a fee themselves — same "don't make staff re-derive a number the system already knows" principle as opening-stock carry-forward (§3.1). `delivery_locations` follows the same admin-CRUD, soft-deactivate pattern as `items`/`ingredients` (§2, §5's no-hard-delete rule applies here too, since past orders reference a zone).

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
