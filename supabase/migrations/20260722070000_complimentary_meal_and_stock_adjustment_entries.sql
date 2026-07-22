-- ============================================================
-- Complimentary meals + stock adjustments (docs/backlog/05_stock_consumption.md,
-- design confirmed with the human 2026-07-22).
--
-- THE PROBLEM: WaPrecious flagged that net_profit was double-counting
-- wastage/staff meals against COGS (see the companion migration
-- 20260722080000 for the six stock_entries writer changes and
-- lib/calculations.ts's netProfit() fix). While fixing that, she also
-- asked for two more non-sales stock-usage categories, tracked the same
-- way staff meals already are: "complimentary meals" (menu items given
-- away free, e.g. to a guest) and "stock adjustments" (a catch-all claim
-- for reconciling a physical-count mismatch that isn't spoilage or a
-- specific known reason).
--
-- SHAPE: both mirror staff_meal_entries EXACTLY -- item + quantity, not a
-- free-text cash amount or a signed delta. Value is always
-- quantity * buying_price_snapshot, same costing rule as wastage_value/
-- staff_meal_value (never selling_price -- no sale occurred). Own-table,
-- not a stock_entries column, for the same reason staff meals got its
-- own table (§3.5): self-service, per-claim staff attribution, multiple
-- claims per item/location/day.
-- ============================================================

create table public.complimentary_meal_entries (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id),
  location location_type not null,
  meal_date date not null,
  quantity numeric(10,2) not null check (quantity > 0),

  buying_price_snapshot numeric(10,2) not null,
  value numeric(10,2) not null,  -- quantity * buying_price_snapshot

  note text,

  staff_id uuid not null references public.users(id),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);

create index complimentary_meal_entries_location_date_idx on public.complimentary_meal_entries (location, meal_date);
create index complimentary_meal_entries_item_idx on public.complimentary_meal_entries (item_id);
create index complimentary_meal_entries_staff_idx on public.complimentary_meal_entries (staff_id);

alter table public.complimentary_meal_entries enable row level security;

create policy "complimentary_meal_entries_select_scoped" on public.complimentary_meal_entries
  for select using (
    public.is_admin() or location = public.my_location()
  );
create policy "complimentary_meal_entries_insert_scoped" on public.complimentary_meal_entries
  for insert with check (
    created_by = auth.uid()
    and staff_id = auth.uid()
    and (public.is_admin() or location = public.my_location())
  );
create policy "complimentary_meal_entries_update_admin_only" on public.complimentary_meal_entries
  for update using (public.is_admin());

create table public.stock_adjustment_entries (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id),
  location location_type not null,
  meal_date date not null,  -- named meal_date for consistency with staff_meal_entries/complimentary_meal_entries even though "meal" doesn't literally apply here -- keeps the three tables' shape identical for the unified ledger function below
  quantity numeric(10,2) not null check (quantity > 0),

  buying_price_snapshot numeric(10,2) not null,
  value numeric(10,2) not null,

  note text,  -- no reason-code enum, same "no fixed taxonomy" precedent as wastage_note

  staff_id uuid not null references public.users(id),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);

create index stock_adjustment_entries_location_date_idx on public.stock_adjustment_entries (location, meal_date);
create index stock_adjustment_entries_item_idx on public.stock_adjustment_entries (item_id);
create index stock_adjustment_entries_staff_idx on public.stock_adjustment_entries (staff_id);

alter table public.stock_adjustment_entries enable row level security;

create policy "stock_adjustment_entries_select_scoped" on public.stock_adjustment_entries
  for select using (
    public.is_admin() or location = public.my_location()
  );
create policy "stock_adjustment_entries_insert_scoped" on public.stock_adjustment_entries
  for insert with check (
    created_by = auth.uid()
    and staff_id = auth.uid()
    and (public.is_admin() or location = public.my_location())
  );
create policy "stock_adjustment_entries_update_admin_only" on public.stock_adjustment_entries
  for update using (public.is_admin());

-- ============================================================
-- complimentary_meals_total() / stock_adjustments_total()
-- Same narrow security-invoker aggregate pattern as staff_meals_total()
-- (§3.5) -- every stock_entries writer function pulls these without
-- needing broader read access than its own RLS already grants.
-- ============================================================
create or replace function public.complimentary_meals_total(
  p_item_id uuid,
  p_location location_type,
  p_period_start date,
  p_period_end date
)
returns numeric
language sql
security invoker
stable
as $$
  select coalesce(sum(quantity), 0)
  from public.complimentary_meal_entries
  where item_id = p_item_id
    and location = p_location
    and meal_date >= p_period_start
    and meal_date <= p_period_end;
$$;

create or replace function public.stock_adjustments_total(
  p_item_id uuid,
  p_location location_type,
  p_period_start date,
  p_period_end date
)
returns numeric
language sql
security invoker
stable
as $$
  select coalesce(sum(quantity), 0)
  from public.stock_adjustment_entries
  where item_id = p_item_id
    and location = p_location
    and meal_date >= p_period_start
    and meal_date <= p_period_end;
$$;

-- ============================================================
-- dashboard_complimentary_meal_summary() / dashboard_stock_adjustment_summary()
-- Combined + per-location total value for a date range, mirroring
-- dashboard_staff_meal_summary()'s shape exactly. Used by the dashboard
-- summary route's "Stock Consumption" breakdown.
-- ============================================================
create or replace function public.dashboard_complimentary_meal_summary(
  p_from date,
  p_to date
)
returns table (
  location location_type,
  value numeric
)
language sql
security invoker
stable
as $$
  select
    cme.location,
    coalesce(sum(cme.value), 0) as value
  from public.complimentary_meal_entries cme
  where cme.meal_date >= p_from and cme.meal_date <= p_to
  group by cme.location;
$$;

create or replace function public.dashboard_stock_adjustment_summary(
  p_from date,
  p_to date
)
returns table (
  location location_type,
  value numeric
)
language sql
security invoker
stable
as $$
  select
    sae.location,
    coalesce(sum(sae.value), 0) as value
  from public.stock_adjustment_entries sae
  where sae.meal_date >= p_from and sae.meal_date <= p_to
  group by sae.location;
$$;

-- ============================================================
-- complimentary_meal_available_stock() / stock_adjustment_available_stock()
-- Mirrors staff_meal_available_stock() (§3.5) exactly -- the staff-facing
-- picker's "Available: X" cap, reusing each write function's own
-- opening-stock-carry-forward logic (most recent stock_entries row's
-- closing_stock, already net of every same-day claim across ALL
-- consumption categories once the companion migration lands) rather than
-- re-deriving a second, incomplete version client-side.
-- ============================================================
create or replace function public.complimentary_meal_available_stock(
  p_location location_type,
  p_as_of_date date
)
returns table (
  item_id uuid,
  available numeric
)
language sql
security invoker
stable
as $$
  select
    i.id as item_id,
    latest.closing_stock as available
  from public.items i
  left join lateral (
    select se.closing_stock
    from public.stock_entries se
    where se.item_id = i.id
      and se.location = p_location
      and se.entry_date <= p_as_of_date
    order by se.entry_date desc
    limit 1
  ) latest on true
  where i.active
    and i.supply_type = any (
      case when p_location = 'restaurant'
        then array['restaurant_only', 'canteen_supplied']::item_supply_type[]
        else array['canteen_supplied', 'canteen_independent']::item_supply_type[]
      end
    );
$$;

create or replace function public.stock_adjustment_available_stock(
  p_location location_type,
  p_as_of_date date
)
returns table (
  item_id uuid,
  available numeric
)
language sql
security invoker
stable
as $$
  select * from public.complimentary_meal_available_stock(p_location, p_as_of_date);
$$;
