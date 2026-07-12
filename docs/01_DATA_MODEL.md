# Prime Hotel Management System — Data Model

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
delivery_locations  — admin-managed catalog of delivery zones + fixed fees (see §6)
orders              — customer delivery/pickup orders, replaces the client's WhatsApp-coordinated process (see §6)
order_items         — line items per order (see §6)
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
  'beverages', 'snacks', 'meals', 'fruits', 'cyber', 'retail', 'ingredients'
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
  created_at timestamptz not null default now()
);

-- Auth note: Supabase Auth requires an email + password internally.
-- We generate a synthetic internal email of the form
--   user-{staff_code}@prosper.internal
-- and use the PIN as the password. The person never sees this email --
-- the login UI only ever shows Name (+ staff code where names collide)
-- and a PIN field. See `04_PHASE_PLAN.md` Phase 2 for the concrete implementation.

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
```

---

## 3. Calculation rules (implement once, in one place)

These must live in a single shared function/module (see `CLAUDE.md`'s Project Structure section → `lib/calculations.ts`), called from the Route Handler that writes `stock_entries`. Never re-implement this math in more than one place.

```
total_stock          = opening_stock + added_stock
quantity_sold        = till_quantity_sold + sum(order_items.quantity for this item/location/date)
closing_stock        = total_stock - sent_out - quantity_sold - wastage
sales_value          = quantity_sold * selling_price_snapshot
cost_value           = quantity_sold * buying_price_snapshot
closing_stock_value  = closing_stock * buying_price_snapshot
wastage_value        = wastage * buying_price_snapshot
```

`quantity_sold` is never written directly by either write-path (till entry or orders) — it's always recomputed from `till_quantity_sold` plus the order total via `public.recalculate_stock_entry()`, so the two flows can't race and overwrite each other. See §3.4 for the full rationale — this line only exists in this schema because delivery orders (§6) were added after the original design, and "one row, two writers" needed an explicit answer.

`total_stock` itself is **not stored** — it's derivable and only used momentarily during entry/validation. Storing it would be redundant and risks drifting out of sync with its inputs (this is exactly the kind of duplication that caused the buying-price mismatches in the client's old Excel sheet — don't reintroduce that failure mode).

`wastage_value` is always costed at `buying_price_snapshot`, never `selling_price_snapshot` — wasted stock was never sold, so there's no revenue to value it at; the loss is what it cost to acquire/produce, not the margin that would have been made. See §3.3 for the full rationale on why wastage is tracked as a first-class figure rather than folded silently into closing stock.

`closing_stock_value` is the cash value of unsold inventory — it mirrors the "Value of Closing Stock" column WaPrecious already tracks by hand, and is a first-class figure on the admin dashboard (capital currently tied up in stock), not just an internal intermediate.

**Validation rule**: reject a write where `sent_out + quantity_sold + wastage > total_stock` (can't sell/send/waste more than you have). Surface this as a clear inline error, not a silent clamp. Same rule applies to `ingredient_entries`: reject `quantity_used + wastage > opening_stock + received`.

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

- **Store manager only** — same person already responsible for `added_stock`/`sent_out` on the restaurant side. No new role; this is an extension of their existing daily responsibility, not a new permission tier (still just `is_store_manager = true` on a `staff` account, per `00_ARCHITECTURE.md` §5.1).
- Ingredient entry is a **separate screen/route** (`app/(staff)/store/page.tsx` — see `CLAUDE.md`'s Project Structure section), distinct from the daily menu-item entry screen. It is a structurally different ledger (one inflow — `received` — and one consumption path — `quantity_used` — versus items' opening/added/sent/sold shape), so it gets its own screen rather than being squeezed into `/entry` as a sub-section. It's still reachable from the same bottom nav, visible only to the store-manager-flagged user.

---

## 3.3 Wastage

Wastage is tracked at **both** stages — finished menu items (`stock_entries`) and raw ingredients (`ingredient_entries`) — because spoilage genuinely happens at both ends: vegetables and other ingredients can go bad before they're ever cooked, and prepared food can go unsold and spoil, or get dropped/broken, after production. This was originally scoped as a Phase 2 nice-to-have (see the old note in §5); it's now V1 scope per direct client input, since without it the numbers don't reconcile with a physical count.

### Why wastage can't just be folded into "closing stock" or ignored

Without a dedicated `wastage` column, any item that spoils or is discarded has nowhere to go in the model — it's not a sale (`quantity_sold`), not a transfer (`sent_out`), so it would either wrongly inflate `closing_stock` (the system thinks stock is on hand that physically isn't) or force staff to fudge `quantity_sold` to make the physical count match, which corrupts the sales/profit figures. Neither is acceptable — this is exactly the kind of quiet data corruption the rest of this document goes out of its way to prevent.

### Shape: quantity + optional note, no reason enum

- `wastage` (numeric) — the quantity spoiled/discarded/wasted that period, entered by whoever is already logging that row (regular staff or store manager for `stock_entries`; store manager for `ingredient_entries`).
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

**Implementation note (Phase 6, superseding the originally-planned `recalculate_stock_entry()` call below):** the original plan was for the orders route to call a plain `UPDATE`-only `recalculate_stock_entry(item_id, location, entry_date)` function after inserting `order_items`. That function still exists in the schema (defined in `20260710110003_rls_and_functions.sql`) but Phase 6 found it insufficient and built `public.apply_order_to_stock_entry()` instead — see `20260712080310_orders_write_function.sql`. The reason: `recalculate_stock_entry()`'s `UPDATE` assumes a `stock_entries` row already exists for that item/location/date, which is only true once a till entry has been saved. An order can easily be the **first** write of the period for an item (a delivery placed before the till sheet is ever touched that day) — there is no row to `UPDATE`, and `closing_stock`/`sales_value`/`cost_value`/`closing_stock_value`/`wastage_value` have no column defaults to fall back on. `apply_order_to_stock_entry()` does the same opening-stock-carry-forward-and-upsert work `save_stock_entry()`/`save_canteen_stock_entry()` already do, except it never writes `till_quantity_sold`, `sent_out`, or `wastage` (those remain whatever the till-entry flow last saved, or 0/defaults) — only `quantity_sold` and its downstream values move, always re-derived from a **fresh** sum of `order_items` for that item/location/period (never incremented by "this order's quantity"), so concurrent writers still can't clobber each other. It is also cadence-aware: for a `canteen` order it resolves `order_date` to that week's Monday `entry_date` before touching `stock_entries` (mirroring `save_canteen_stock_entry()`'s convention) and re-derives `added_stock` via `canteen_supplied_total()` for `canteen_supplied` items — otherwise a canteen order would create a stray extra daily row instead of folding into the existing weekly one (a real bug caught during this phase's own live testing, not part of the original design). `recalculate_stock_entry()` itself remains unused/dead code as of this phase — a future phase could remove it, but it's harmless left in place and this doc isn't asserting it should be deleted.

- The **stock-entries route** (Phase 4) writes `till_quantity_sold` directly (client sends the day's absolute stepper values, as originally designed — only one person edits their own location's till sheet, so this remains safe).
- The **orders route** (§6) inserts the order + `order_items`, then calls `apply_order_to_stock_entry()` for each distinct item on the order. It never touches `till_quantity_sold`, `sent_out`, or `wastage`, and never writes `quantity_sold` directly.
- Both routes run their writes inside a single database transaction (a single Postgres function call per save — `save_stock_entry()`/`save_canteen_stock_entry()`/`create_order()` — since PostgREST/the Supabase JS client has no client-driven multi-statement transaction), so a crash or network drop mid-write can't leave `quantity_sold` out of sync with its two inputs.

**Row-locking fix (found post-Phase-6, while writing `scripts/acceptance/phase6-orders.mjs` — see `20260712091633_stock_entry_row_locking.sql`):** the three write functions above (`save_stock_entry`, `save_canteen_stock_entry`, `apply_order_to_stock_entry`) each did a plain, non-locking `SELECT` to check whether a `stock_entries` row already existed for the target item/location/period, computed their oversell check and derived values from that snapshot, then `INSERT ... ON CONFLICT DO UPDATE`. This has a genuine race when two calls are both the **first-ever write** for a brand-new row (e.g. a till save and a delivery order landing at the same moment for an item nobody has touched yet that day): both see "no row," both compute their oversell check from their own inputs only, and both attempt the insert. Postgres serializes the actual row conflict for you, but it does **not** re-run the PL/pgSQL function body for whichever call blocks — the blocked call's `ON CONFLICT DO UPDATE SET` clause still fires using `EXCLUDED` values computed from the stale pre-block snapshot. The observed failure mode was a false oversell rejection (a legitimate order returned `409` even though the combined total was well within stock) — a wrong-rejection bug, not silent data loss, but still a real defect in the exact property this section exists to guarantee. **Fix:** each function now calls `public.lock_stock_entry_row(item_id, location, entry_date)` — a `pg_advisory_xact_lock` keyed on that triple — as its very first statement, before any read. This serializes the whole read-decide-write sequence per row (not just the final `INSERT`'s conflict resolution): a second caller blocks on the lock itself, and by the time it acquires the lock and runs its own `SELECT`, the first caller's row is already committed and visible. The lock is transaction-scoped (no explicit unlock needed) and released automatically when the function's implicit transaction ends, matching the existing "one function call = one transaction" model. Verified via a repeated concurrent-request stress test (till save + order racing on a brand-new row, run 8+ times back to back) — no false rejections after the fix, oversell still correctly rejected when the combined total genuinely exceeds stock.

### Duplicate-submission protection (orders)

A cashier double-tapping "Save order" on a flaky connection must not create two orders and double-deduct stock. `orders.client_request_id` (a UUID the client generates once per submit attempt and resends unchanged on any retry) plus `unique (created_by, client_request_id)` makes a retried submission a no-op: the second insert attempt hits the unique constraint, the route handler catches that specific conflict and returns the original order's result instead of erroring. `stock_entries` already gets this for free from its own `unique(item_id, location, entry_date)` upsert key — `orders` did not have an equivalent until now, since it has no natural composite key (a customer can plausibly place two genuinely separate orders on the same day).

### Validation: an order's items must belong to its own location

Nothing in the table structure stops an order from being created with `location = 'restaurant'` while referencing an item that's `canteen_independent` (an item the restaurant never stocks or sells). This must be enforced in the Zod schema / route handler (`lib/validation.ts`), not assumed: for each `order_items` row, reject the write unless the referenced item's `supply_type` is valid for the order's location — `restaurant_only` or `canteen_supplied` items are sellable at `restaurant`; `canteen_supplied` or `canteen_independent` items are sellable at `canteen`. Surface a clear inline error, same standard as the existing "can't sell more than available stock" rule (§3).

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
-- by admin, protects historical entries same as stock_entries
create policy "ingredient_entries_select_restaurant_or_admin" on public.ingredient_entries
  for select using (
    public.is_admin() or public.my_location() = 'restaurant'
  );
create policy "ingredient_entries_insert_restaurant" on public.ingredient_entries
  for insert with check (
    created_by = auth.uid()
    and (public.is_admin() or public.my_location() = 'restaurant')
  );
create policy "ingredient_entries_update_admin_only" on public.ingredient_entries
  for update using (public.is_admin());

-- STOCK_ENTRIES: staff see/write only their own location's rows;
-- admin sees/writes all; nobody can update a row they didn't create
-- unless they're admin (protects historical entries -- see scope doc)
create policy "stock_select_scoped" on public.stock_entries
  for select using (
    public.is_admin() or location = public.my_location()
  );
create policy "stock_insert_scoped" on public.stock_entries
  for insert with check (
    created_by = auth.uid()
    and (public.is_admin() or location = public.my_location())
  );
create policy "stock_update_admin_only" on public.stock_entries
  for update using (public.is_admin());

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
- **No soft-delete on `stock_entries`/`expenses`.** Historical entries are never deleted, only correctable by admin via update (with the update itself still logged via `updated_at`). If an audit trail of *changes* (not just current state) becomes a requirement, that's a new decision to make explicitly, not something to bolt on silently.
- **`items.supply_type` is deliberate, not speculative.** It exists specifically because the restaurant's central store supplies only a subset of items to canteen daily, while canteen also stocks unrelated items (cyber, some retail) entirely on its own — see §3.1. Don't remove or simplify this enum thinking it's over-engineering; it's load-bearing for the canteen `added_stock` aggregation.
- **No formal recipe / bill-of-materials linking `ingredients` to `items`.** The client only has a rough, informal sense of ingredient-to-dish conversion, not precise recipes — see §3.2. `ingredient_entries.quantity_used` and `stock_entries.added_stock` are independent numbers with no enforced relationship. Don't build automatic yield calculation speculatively; it's a real Phase 2 candidate if the client asks, not a V1 gap to quietly fill in.

---

## 6. Delivery orders — a real replacement for the WhatsApp process, not a speculative add

This section documents a genuine V1 scope addition made after initial planning, per direct client input: Prime Hotel currently coordinates estate/home deliveries over a WhatsApp group, with no record-of-truth beyond the chat thread. `orders` + `order_items` + `delivery_locations` replace that group as the actual record, while staying deliberately narrow — see the exclusions below.

### What an order is, and isn't

An order is a **single customer transaction** — closer to a receipt than to a stock-entry row. It is distinct from `stock_entries` (location-level daily/weekly aggregates) but **feeds into it**: every item quantity on an order counts toward that day's `stock_entries.quantity_sold` for that item + location. An order is a second write-path into the existing stock ledger, not a parallel untracked record — if it didn't deduct from stock, closing stock and profit would silently stop reconciling with what was actually sold, the exact failure mode wastage tracking (§3.3) already exists to prevent.

**Critically, an order never writes `quantity_sold` directly** — it inserts into `order_items` and then calls `public.apply_order_to_stock_entry()` (Phase 6's atomic upsert function — see §3.4's implementation note for why it replaced the originally-planned plain `recalculate_stock_entry()` call), which always re-derives the combined total from its two source numbers, so the two write-paths can never race and clobber each other. See §3.4 for the full mechanism and why it's necessary (two independent flows writing the same row is a lost-update hazard if handled naively).

- **Walk-in till sales are unaffected.** The existing stepper-based `quantity_sold` entry flow (Phase 4) stays exactly as-is. Orders are only for the delivery/pickup channel that used to go through WhatsApp — not a redesign of the core entry screen, not a replacement for how walk-in sales are logged.
- **Logged as already-completed**, same mental model as a till sale entered at time of sale. No status/workflow field (no pending → fulfilled lifecycle), no rider/driver assignment, no customer accounts or order history beyond the flat log. These are deliberate V1 exclusions — see below.

### `delivery_locations` — admin-managed zone catalog

Prime Hotel's admin (WaPrecious) sets up named delivery zones, each with a fixed fee (e.g., "Estate A — KES 100"). Staff logging an order pick a zone from this catalog rather than typing a fee themselves — same "don't make staff re-derive a number the system already knows" principle as opening-stock carry-forward (§3.1). `delivery_locations` follows the same admin-CRUD, soft-deactivate pattern as `items`/`ingredients` (§2, §5's no-hard-delete rule applies here too, since past orders reference a zone).

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
