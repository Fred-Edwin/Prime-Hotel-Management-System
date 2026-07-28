-- ============================================================
-- Asset register (utensils, cookware, equipment) — post-launch
-- feature (client feedback, 2026-07-28): "They have some inventory
-- assets used in the business like utensils that need to be
-- accounted for."
--
-- Structurally distinct from items (sold) and ingredients (consumed
-- into a dish): an asset is durable equipment the business owns
-- indefinitely — nothing is "sold" or "used up" daily, so this does
-- NOT follow the stock_entries/ingredient_entries daily-reconciliation
-- pattern (no opening/closing carry-forward, no daily row at all).
-- It follows the simpler ingredient_purchases append-only-log shape
-- (see 20260719161000_ingredient_purchases.sql), but without that
-- table's weighted-average-cost/daily-row-folding machinery, since
-- there's no companion daily entry table to fold into.
--
-- Confirmed with the client (via the human) that this covers three
-- jobs: (1) a catalog of what's owned, (2) a breakage/loss figure
-- over time, distinct from COGS/wastage/expenses, (3) equipment
-- purchases counted as a real cost, shown as their OWN dashboard
-- line rather than folded into the recurring electricity/gas/rent
-- expenses total — a one-off equipment buy shouldn't distort that
-- trend.
--
-- SCOPE (confirmed with the human, deliberately different from
-- ingredients' restaurant-only scoping): utensils/equipment exist at
-- BOTH locations (canteen has cups/spoons too), unlike ingredients
-- which are genuinely restaurant-only by business model. So:
--   - Catalog visibility: own-location + shared(null) + admin-sees-all
--     — same shape as items/stock_entries, not ingredients.
--   - Logging a LOSS (breakage/theft): any staff member, at their own
--     location — no store-manager gate. Anne can log a broken canteen
--     cup herself with no restaurant store manager to lean on.
--   - Logging a PURCHASE / managing the catalog (add/edit an asset,
--     set unit cost): admin + restaurant store manager only — same
--     population as ingredients/ingredient_purchases, since that's who
--     actually buys equipment in practice. Enforced at the route layer
--     (canManageAssets(), mirrors canCreateIngredient()/canLogPurchases())
--     — RLS itself only distinguishes event_type, see below.
-- ============================================================

create type asset_event_type as enum ('purchase', 'loss');

-- ============================================================
-- ASSETS
-- Catalog of durable equipment. Mirrors ingredients' shape (name,
-- a free-text category rather than an enum — same rationale as
-- ingredients.unit, the client's own category vocabulary shouldn't be
-- hardcoded into a fixed list), plus a nullable location (shared/
-- business-wide assets, same convention as expenses.location).
-- ============================================================

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  location location_type,  -- null = shared/business-wide, visible at both locations
  unit_cost numeric(10,2) not null check (unit_cost >= 0),
  low_stock_threshold numeric(10,2) check (low_stock_threshold >= 0),  -- nullable: optional, unlike items/ingredients
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index assets_active_idx on public.assets (active);
create index assets_location_idx on public.assets (location);

create trigger assets_set_updated_at
  before update on public.assets
  for each row execute function public.set_updated_at();

-- ============================================================
-- ASSET_EVENTS
-- Append-only log of purchase/loss events. Quantity-on-hand is
-- ALWAYS derived (sum of purchases minus sum of losses), never
-- stored — same "derive, don't cache" convention already used for
-- ingredients'/items' on-hand figures (01_DATA_MODEL.md §3.2/§3).
--
-- unit_cost_snapshot/total_cost are only meaningful for 'purchase'
-- rows (a loss has no unit cost paid at the time of the loss itself —
-- its reporting VALUE is derived at query time from the asset's
-- current unit_cost, see dashboard_asset_losses_total() below, since
-- a loss figure is informational/reporting-only, not a
-- profit-affecting price that must be frozen the way item/ingredient
-- prices are).
-- ============================================================

create table public.asset_events (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id),
  event_type asset_event_type not null,
  event_date date not null,
  quantity numeric(10,2) not null check (quantity > 0),
  unit_cost_snapshot numeric(10,2) check (unit_cost_snapshot >= 0),
  total_cost numeric(10,2) not null default 0,  -- quantity * unit_cost_snapshot for 'purchase', 0 for 'loss' -- stored not generated, see CLAUDE.md
  note text,

  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
  -- no updated_at: immutable log, same as ingredient_purchases
);

create index asset_events_date_idx on public.asset_events (event_date);
create index asset_events_asset_idx on public.asset_events (asset_id);

alter table public.assets enable row level security;
alter table public.asset_events enable row level security;

-- Own-location + shared(null) + admin-sees-all -- matches
-- items_select_all/stock_entries' own-location shape, NOT
-- ingredients' restaurant-only shape (see scope note above).
create policy "assets_select_own_location_or_admin" on public.assets
  for select using (
    public.is_admin() or location is null or location = public.my_location()
  );

-- Catalog management (create/edit) stays admin + restaurant store
-- manager only, same population as ingredients_admin_or_restaurant_insert/
-- _update -- the route layer further narrows non-admin callers to
-- is_store_manager (canManageAssets(), mirrors canCreateIngredient()).
create policy "assets_admin_or_restaurant_insert" on public.assets
  for insert with check (
    public.is_admin() or public.my_location() = 'restaurant'
  );
create policy "assets_admin_or_restaurant_update" on public.assets
  for update using (
    public.is_admin() or public.my_location() = 'restaurant'
  );

-- Select mirrors assets' own scoping, joined through asset_id.
create policy "asset_events_select_own_location_or_admin" on public.asset_events
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.assets a
      where a.id = asset_events.asset_id
        and (a.location is null or a.location = public.my_location())
    )
  );

-- Insert: a 'loss' may be logged by any staff member (own-location,
-- via the asset visibility check) or admin -- Anne logging a broken
-- canteen cup needs no store-manager flag. A 'purchase' is admin or
-- restaurant-store-manager only, same population as
-- ingredient_purchases_insert_restaurant -- the route layer
-- (canManageAssets()) is the one place that actually checks
-- is_store_manager specifically (RLS has no concept of that flag,
-- 00_ARCHITECTURE.md §5.1), so this policy only narrows to "some
-- restaurant staff or admin" for purchases, same shape as every
-- other admin-or-restaurant write in this schema.
create policy "asset_events_insert_scoped" on public.asset_events
  for insert with check (
    (created_by = auth.uid() or public.is_admin())
    and (
      (
        event_type = 'loss'
        and exists (
          select 1 from public.assets a
          where a.id = asset_events.asset_id
            and (a.location is null or a.location = public.my_location())
        )
      )
      or (
        event_type = 'purchase'
        and (public.is_admin() or public.my_location() = 'restaurant')
      )
    )
  );

-- Admin-only delete -- append-only log, a logging mistake is an
-- admin correction, same shape as ingredient_purchases_delete_admin.
create policy "asset_events_delete_admin" on public.asset_events
  for delete using (public.is_admin());

-- ============================================================
-- lock_asset_row(): serializes concurrent events against the same
-- asset (two losses/purchases racing the same on-hand check), same
-- shape as lock_ingredient_entry_row()/lock_stock_entry_row().
-- ============================================================

create or replace function public.lock_asset_row(p_asset_id uuid)
returns void
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_asset_id::text, 0));
end;
$$;

-- ============================================================
-- record_asset_event(): single write path for both purchase and
-- loss logging (admin's /assets screen, the store manager's /store
-- "Log purchase" action, and any staff member's "Log loss" action).
-- Much simpler than record_ingredient_purchase(): no weighted-average
-- recompute, no daily row to fold into -- just the event row itself,
-- an oversell-style on-hand check for losses, and (for purchases) an
-- update to assets.unit_cost so the catalog reflects the latest
-- price paid, mirroring ingredients.buying_price's manual-plus-
-- automatic-writer pattern.
-- ============================================================

create or replace function public.record_asset_event(
  p_asset_id uuid,
  p_event_type asset_event_type,
  p_event_date date,
  p_quantity numeric,
  p_created_by uuid,
  p_unit_cost numeric default null,
  p_note text default null
)
returns public.asset_events
language plpgsql
security invoker
as $$
declare
  v_qty_on_hand numeric(10,2);
  v_event public.asset_events;
  v_unit_cost numeric(10,2);
  v_total_cost numeric(10,2);
begin
  perform public.lock_asset_row(p_asset_id);

  select coalesce(sum(case when event_type = 'purchase' then quantity else -quantity end), 0)
  into v_qty_on_hand
  from public.asset_events
  where asset_id = p_asset_id;

  if p_event_type = 'loss' and p_quantity > v_qty_on_hand then
    raise exception 'insufficient_asset_quantity' using errcode = 'P0008';
  end if;

  if p_event_type = 'purchase' then
    if p_unit_cost is null then
      raise exception 'unit_cost is required for a purchase event' using errcode = '23514';
    end if;
    v_unit_cost := p_unit_cost;
    v_total_cost := p_quantity * p_unit_cost;
  else
    v_unit_cost := null;
    v_total_cost := 0;
  end if;

  insert into public.asset_events (
    asset_id, event_type, event_date, quantity, unit_cost_snapshot, total_cost, note, created_by
  )
  values (
    p_asset_id, p_event_type, p_event_date, p_quantity, v_unit_cost, v_total_cost, p_note, p_created_by
  )
  returning * into v_event;

  -- A purchase also refreshes the catalog's unit_cost to the latest
  -- price paid -- simple "last price wins" rather than ingredients'
  -- weighted-average, since an asset purchase isn't blending into an
  -- existing consumable stock's cost basis the way ingredient
  -- purchases are; it's just "what does a replacement cost now."
  if p_event_type = 'purchase' then
    update public.assets set unit_cost = p_unit_cost where id = p_asset_id;
  end if;

  return v_event;
end;
$$;

-- ============================================================
-- delete_asset_event(): admin-only correction path. Simpler than
-- delete_ingredient_purchase() -- no weighted-average/daily-entry
-- chain to recompute, RLS (asset_events_delete_admin) is the real
-- enforcement, this function just performs the delete.
-- ============================================================

create or replace function public.delete_asset_event(p_event_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  v_event public.asset_events;
begin
  select * into v_event from public.asset_events where id = p_event_id;
  if v_event.id is null then
    raise exception 'unknown_entry' using errcode = 'P0007';
  end if;

  delete from public.asset_events where id = p_event_id;
end;
$$;

-- ============================================================
-- Dashboard aggregates
-- ============================================================

-- dashboard_asset_purchases_total(): sums total_cost of 'purchase'
-- events in range -- feeds the dashboard's "Asset Purchases" line,
-- which DOES reduce net profit (unlike wastage/stockConsumption,
-- whose cost is already embedded in COGS via reduced closing stock --
-- an asset purchase has no such embedding anywhere else, it's a real
-- cost with no other home in the P&L).
create or replace function public.dashboard_asset_purchases_total(
  p_from date,
  p_to date
)
returns numeric
language sql
security invoker
stable
as $$
  select coalesce(sum(total_cost), 0)
  from public.asset_events
  where event_type = 'purchase'
    and event_date >= p_from
    and event_date <= p_to;
$$;

-- dashboard_asset_losses_total(): values loss events at the asset's
-- CURRENT unit_cost (not a snapshot, since a loss event carries none)
-- -- reporting-only figure, same "informational, not fed into
-- netProfit" treatment as wastage/stockConsumption (01_DATA_MODEL.md
-- §3.10/§3.11), so using a live price here doesn't violate this
-- schema's price-snapshot-immutability rule -- that rule protects
-- profit-affecting prices (item/ingredient buying/selling price),
-- not every cost figure everywhere.
create or replace function public.dashboard_asset_losses_total(
  p_from date,
  p_to date
)
returns numeric
language sql
security invoker
stable
as $$
  select coalesce(sum(e.quantity * a.unit_cost), 0)
  from public.asset_events e
  join public.assets a on a.id = e.asset_id
  where e.event_type = 'loss'
    and e.event_date >= p_from
    and e.event_date <= p_to;
$$;

-- dashboard_assets_on_hand(): per-asset current quantity + value,
-- powers the /assets catalog screen's "on hand"/"value" columns and
-- a low-stock check against assets.low_stock_threshold.
create or replace function public.dashboard_assets_on_hand()
returns table (
  asset_id uuid,
  quantity_on_hand numeric,
  value numeric
)
language sql
security invoker
stable
as $$
  select
    a.id as asset_id,
    coalesce(sum(case when e.event_type = 'purchase' then e.quantity else -e.quantity end), 0) as quantity_on_hand,
    coalesce(sum(case when e.event_type = 'purchase' then e.quantity else -e.quantity end), 0) * a.unit_cost as value
  from public.assets a
  left join public.asset_events e on e.asset_id = a.id
  group by a.id, a.unit_cost;
$$;
