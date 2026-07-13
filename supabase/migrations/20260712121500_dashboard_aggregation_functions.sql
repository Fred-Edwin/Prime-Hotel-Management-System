-- Phase 7 (docs/04_PHASE_PLAN.md): admin dashboard & reporting.
--
-- All aggregation happens here, in SQL (sum()/group by), not by fetching
-- every row and summing in JS -- an explicit Phase 7 acceptance criterion,
-- not a style preference (04_PHASE_PLAN.md).
--
-- These are `security invoker`, matching every other function in this
-- schema (save_stock_entry, apply_order_to_stock_entry, etc.) -- they run
-- as the calling user, so the existing location-scoped RLS on
-- stock_entries/ingredient_entries/expenses still applies. For admin
-- (public.is_admin() = true) that RLS already grants access to both
-- locations' rows (see 01_DATA_MODEL.md §4's "stock_select_scoped" etc.),
-- so no new RLS-bypass is introduced -- an admin calling these simply sees
-- the same rows they could already query directly, pre-aggregated.
-- Route handlers still call requireAdmin() themselves (defense in depth,
-- same pattern as every other admin-only route in this codebase).

-- ============================================================
-- dashboard_stock_summary(p_from, p_to)
-- Combined + per-location totals over stock_entries for a date range.
-- quantity_sold already includes both till and order-driven sales
-- (docs/01_DATA_MODEL.md §3.4) -- summing sales_value/cost_value here
-- picks up orders for free, no separate order aggregation needed.
-- ============================================================
create or replace function public.dashboard_stock_summary(
  p_from date,
  p_to date
)
returns table (
  location location_type,
  sales_value numeric,
  cost_value numeric,
  wastage_value numeric,
  closing_stock_value numeric
)
language sql
security invoker
stable
as $$
  select
    se.location,
    coalesce(sum(se.sales_value), 0) as sales_value,
    coalesce(sum(se.cost_value), 0) as cost_value,
    coalesce(sum(se.wastage_value), 0) as wastage_value,
    -- Closing stock value is a point-in-time figure (cash tied up in
    -- stock RIGHT NOW), not a period sum -- summing closing_stock_value
    -- across every day/week in the range would double-count carried-
    -- forward stock. Take each item's MOST RECENT row within the range
    -- (per location), matching what "closing stock value" means on the
    -- old Excel sheet WaPrecious already tracks by hand.
    coalesce((
      select sum(latest.closing_stock_value)
      from (
        select distinct on (se2.item_id) se2.closing_stock_value
        from public.stock_entries se2
        where se2.location = se.location
          and se2.entry_date >= p_from
          and se2.entry_date <= p_to
        order by se2.item_id, se2.entry_date desc
      ) latest
    ), 0) as closing_stock_value
  from public.stock_entries se
  where se.entry_date >= p_from and se.entry_date <= p_to
  group by se.location;
$$;

-- ============================================================
-- dashboard_ingredient_summary(p_from, p_to)
-- Restaurant-only (ingredients have no canteen counterpart -- §3.2).
-- Same "latest row per ingredient" rule for closing_stock_value as above.
-- ============================================================
create or replace function public.dashboard_ingredient_summary(
  p_from date,
  p_to date
)
returns table (
  wastage_value numeric,
  closing_stock_value numeric
)
language sql
security invoker
stable
as $$
  select
    coalesce(sum(ie.wastage_value), 0) as wastage_value,
    coalesce((
      select sum(latest.closing_stock_value)
      from (
        select distinct on (ie2.ingredient_id) ie2.closing_stock_value
        from public.ingredient_entries ie2
        where ie2.entry_date >= p_from and ie2.entry_date <= p_to
        order by ie2.ingredient_id, ie2.entry_date desc
      ) latest
    ), 0) as closing_stock_value
  from public.ingredient_entries ie
  where ie.entry_date >= p_from and ie.entry_date <= p_to;
$$;

-- ============================================================
-- dashboard_expenses_summary(p_from, p_to)
-- ============================================================
create or replace function public.dashboard_expenses_summary(
  p_from date,
  p_to date
)
returns table (
  location location_type,
  total_amount numeric
)
language sql
security invoker
stable
as $$
  select
    e.location,
    coalesce(sum(e.amount), 0) as total_amount
  from public.expenses e
  where e.expense_date >= p_from and e.expense_date <= p_to
  group by e.location;
$$;

-- ============================================================
-- dashboard_daily_trend(p_from, p_to)
-- Day-by-day sales/cost/wastage for the hero band's trend line. Bounded
-- to a real day count by the route handler (Today/Week/Month periods are
-- all <= ~31 days) so this never becomes an unbounded scan.
-- ============================================================
create or replace function public.dashboard_daily_trend(
  p_from date,
  p_to date
)
returns table (
  entry_date date,
  sales_value numeric,
  cost_value numeric,
  wastage_value numeric
)
language sql
security invoker
stable
as $$
  select
    se.entry_date,
    coalesce(sum(se.sales_value), 0) as sales_value,
    coalesce(sum(se.cost_value), 0) as cost_value,
    coalesce(sum(se.wastage_value), 0) as wastage_value
  from public.stock_entries se
  where se.entry_date >= p_from and se.entry_date <= p_to
  group by se.entry_date
  order by se.entry_date;
$$;

-- ============================================================
-- dashboard_low_stock_items()
-- "Needs attention" section (PRD §4.6). Each item's MOST RECENT
-- stock_entries row (any date, not bounded to the dashboard period --
-- low stock is a right-now fact, not a period one), compared against
-- that item's own low_stock_threshold (added this phase, see
-- 20260712120000_low_stock_threshold.sql). Only active items.
-- ============================================================
create or replace function public.dashboard_low_stock_items()
returns table (
  item_id uuid,
  item_name text,
  location location_type,
  closing_stock numeric,
  low_stock_threshold numeric,
  entry_date date
)
language sql
security invoker
stable
as $$
  select
    i.id as item_id,
    i.name as item_name,
    latest.location,
    latest.closing_stock,
    i.low_stock_threshold,
    latest.entry_date
  from public.items i
  join lateral (
    select se.location, se.closing_stock, se.entry_date
    from public.stock_entries se
    where se.item_id = i.id
    order by se.entry_date desc
    limit 1
  ) latest on true
  where i.active
    and latest.closing_stock <= i.low_stock_threshold
  order by latest.closing_stock asc, i.name asc;
$$;

-- ============================================================
-- dashboard_low_stock_ingredients()
-- Ingredient equivalent of the above -- ingredients have no
-- low_stock_threshold column of their own; reuses the same default-5
-- convention documented on items.low_stock_threshold for consistency,
-- since ingredients (§3.2) are restaurant-only raw materials with no
-- per-ingredient threshold requested by the client for this phase.
-- ============================================================
create or replace function public.dashboard_low_stock_ingredients(
  p_threshold numeric default 5
)
returns table (
  ingredient_id uuid,
  ingredient_name text,
  closing_stock numeric,
  unit text,
  entry_date date
)
language sql
security invoker
stable
as $$
  select
    ing.id as ingredient_id,
    ing.name as ingredient_name,
    latest.closing_stock,
    ing.unit,
    latest.entry_date
  from public.ingredients ing
  join lateral (
    select ie.closing_stock, ie.entry_date
    from public.ingredient_entries ie
    where ie.ingredient_id = ing.id
    order by ie.entry_date desc
    limit 1
  ) latest on true
  where ing.active
    and latest.closing_stock <= p_threshold
  order by latest.closing_stock asc, ing.name asc;
$$;

-- ============================================================
-- dashboard_item_ledger(p_from, p_to, p_location)
-- Item Ledger view (/dashboard/ledger) -- every stock_entries column,
-- per item, per period, optionally filtered to one location (null = both).
-- Not aggregated (this IS the detail view) but still a single set-based
-- SQL query, not N+1 fetches.
-- ============================================================
create or replace function public.dashboard_item_ledger(
  p_from date,
  p_to date,
  p_location location_type default null
)
returns table (
  entry_date date,
  item_id uuid,
  item_name text,
  location location_type,
  opening_stock numeric,
  added_stock numeric,
  sent_out numeric,
  till_quantity_sold numeric,
  quantity_sold numeric,
  wastage numeric,
  closing_stock numeric,
  sales_value numeric,
  cost_value numeric,
  closing_stock_value numeric,
  wastage_value numeric,
  low_stock_threshold numeric
)
language sql
security invoker
stable
as $$
  select
    se.entry_date,
    se.item_id,
    i.name as item_name,
    se.location,
    se.opening_stock,
    se.added_stock,
    se.sent_out,
    se.till_quantity_sold,
    se.quantity_sold,
    se.wastage,
    se.closing_stock,
    se.sales_value,
    se.cost_value,
    se.closing_stock_value,
    se.wastage_value,
    i.low_stock_threshold
  from public.stock_entries se
  join public.items i on i.id = se.item_id
  where se.entry_date >= p_from
    and se.entry_date <= p_to
    and (p_location is null or se.location = p_location)
  order by se.entry_date desc, i.name asc;
$$;

-- ============================================================
-- dashboard_ingredient_ledger(p_from, p_to)
-- Ingredient Ledger section (/dashboard/ledger) -- restaurant-only, no
-- location filter needed (ingredients have no location column, §3.2).
-- ============================================================
create or replace function public.dashboard_ingredient_ledger(
  p_from date,
  p_to date
)
returns table (
  entry_date date,
  ingredient_id uuid,
  ingredient_name text,
  unit text,
  opening_stock numeric,
  received numeric,
  quantity_used numeric,
  wastage numeric,
  closing_stock numeric,
  closing_stock_value numeric,
  wastage_value numeric
)
language sql
security invoker
stable
as $$
  select
    ie.entry_date,
    ie.ingredient_id,
    ing.name as ingredient_name,
    ing.unit,
    ie.opening_stock,
    ie.received,
    ie.quantity_used,
    ie.wastage,
    ie.closing_stock,
    ie.closing_stock_value,
    ie.wastage_value
  from public.ingredient_entries ie
  join public.ingredients ing on ing.id = ie.ingredient_id
  where ie.entry_date >= p_from and ie.entry_date <= p_to
  order by ie.entry_date desc, ing.name asc;
$$;
