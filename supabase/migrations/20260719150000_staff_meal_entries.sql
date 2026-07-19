-- ============================================================
-- Staff meal / unpaid-food consumption accounting
-- (docs/backlog/02_staff_meals.md, design confirmed with the human
-- 2026-07-19).
--
-- THE PROBLEM: restaurant staff sometimes eat menu items from stock
-- without it being a paying sale. Previously that stock either got
-- silently absorbed into wastage, or made closing-stock figures not
-- reconcile against a physical count, since there was no category for
-- "consumed internally, not sold, not wasted."
--
-- THE SHAPE: unlike wastage (entered by whoever already fills in that
-- day's stock sheet), staff meals are self-service -- each staff member
-- logs their own claim, attributed to them. That attribution requirement,
-- plus multiple staff potentially claiming against the same item/day,
-- rules out a single stock_entries column (one row per item/location/date
-- has no room for "who"). A separate table is used instead, mirroring
-- items+quantity (not a free-text cash amount, per the confirmed design)
-- so the value is derived from the item's real buying price, never
-- staff-estimated, and so it correctly reduces the item's closing_stock
-- (see the follow-up migration for the 6 stock_entries writer functions
-- this requires touching).
-- ============================================================

create table public.staff_meal_entries (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id),
  location location_type not null,
  meal_date date not null,
  quantity numeric(10,2) not null check (quantity > 0),

  -- snapshotted at write time, same rationale as every other price
  -- snapshot in this schema (docs/01_DATA_MODEL.md's non-negotiable
  -- constraint) -- a later buying-price change must not silently alter
  -- a past meal claim's value.
  buying_price_snapshot numeric(10,2) not null,
  value numeric(10,2) not null,  -- quantity * buying_price_snapshot, costed like wastage_value, never at selling price (no sale occurred)

  note text,  -- optional free text, same convention as wastage_note/expenses.note

  -- attribution: who actually ate it (confirmed required by the human).
  -- created_by is normally the same person, but kept as a distinct column
  -- (matching stock_entries/expenses/orders' created_by convention) in
  -- case a manager ever needs to log a claim on someone else's behalf.
  staff_id uuid not null references public.users(id),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);

create index staff_meal_entries_location_date_idx on public.staff_meal_entries (location, meal_date);
create index staff_meal_entries_item_idx on public.staff_meal_entries (item_id);
create index staff_meal_entries_staff_idx on public.staff_meal_entries (staff_id);

alter table public.staff_meal_entries enable row level security;

-- Same location-scoped pattern as stock_entries/expenses/orders (§4):
-- a staff member can only log/read claims against their own location's
-- items/stock, never another location's -- confirmed with the human
-- rather than assuming "restaurant only regardless of staff location".
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

-- ============================================================
-- staff_meals_total(item_id, location, period_start, period_end)
-- Sum of staff_meal_entries.quantity for an item/location over a date
-- range -- the exact same "narrow security-definer aggregate" pattern
-- as canteen_supplied_total() (docs/01_DATA_MODEL.md §3.1), reused here
-- so every stock_entries writer function can pull this figure without
-- needing broader read access to staff_meal_entries than its own RLS
-- already grants the caller. security invoker is sufficient here (unlike
-- canteen_supplied_total(), which deliberately crosses the
-- location boundary) since every writer function already runs as a user
-- who can see their own location's staff_meal_entries rows -- kept
-- consistent with dashboard_*() functions' security invoker convention
-- for the same reason.
-- ============================================================
create or replace function public.staff_meals_total(
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
  from public.staff_meal_entries
  where item_id = p_item_id
    and location = p_location
    and meal_date >= p_period_start
    and meal_date <= p_period_end;
$$;

-- ============================================================
-- dashboard_staff_meal_summary(p_from, p_to)
-- Combined + per-location total staff meal value for a date range,
-- mirroring dashboard_expenses_summary()'s shape exactly.
-- ============================================================
create or replace function public.dashboard_staff_meal_summary(
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
    sme.location,
    coalesce(sum(sme.value), 0) as value
  from public.staff_meal_entries sme
  where sme.meal_date >= p_from and sme.meal_date <= p_to
  group by sme.location;
$$;

-- ============================================================
-- dashboard_staff_meal_ledger(p_from, p_to, p_location)
-- Itemized table for the admin ledger screen -- who, what item, how
-- much, value, date. Mirrors dashboard_item_ledger()'s shape.
-- ============================================================
create or replace function public.dashboard_staff_meal_ledger(
  p_from date,
  p_to date,
  p_location location_type default null
)
returns table (
  meal_date date,
  item_id uuid,
  item_name text,
  location location_type,
  quantity numeric,
  value numeric,
  note text,
  staff_id uuid,
  staff_name text
)
language sql
security invoker
stable
as $$
  select
    sme.meal_date,
    sme.item_id,
    i.name as item_name,
    sme.location,
    sme.quantity,
    sme.value,
    sme.note,
    sme.staff_id,
    u.name as staff_name
  from public.staff_meal_entries sme
  join public.items i on i.id = sme.item_id
  join public.users u on u.id = sme.staff_id
  where sme.meal_date >= p_from
    and sme.meal_date <= p_to
    and (p_location is null or sme.location = p_location)
  order by sme.meal_date desc, u.name asc;
$$;
