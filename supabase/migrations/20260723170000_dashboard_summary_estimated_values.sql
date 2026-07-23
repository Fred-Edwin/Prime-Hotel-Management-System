-- ============================================================
-- Add estimated-value totals to the dashboard summary aggregation
-- functions, so app/api/dashboard/summary/route.ts can surface an
-- estimated stockConsumption total/breakdown alongside the existing
-- (still-correct, still-buying_price-based) real values. See
-- 20260723110000/20260723120000/20260723140000/20260723150000 for the
-- full context -- these four functions are pure re-aggregations of
-- columns those migrations already populate, nothing new is computed
-- here.
--
-- dashboard_stock_summary()'s return signature changes shape (new output
-- column), which Postgres requires a DROP for, same as
-- 20260721140000_dashboard_periodic_cogs_columns.sql already had to do.
-- ============================================================

drop function if exists public.dashboard_stock_summary(date, date);

create or replace function public.dashboard_stock_summary(
  p_from date,
  p_to date
)
returns table (
  location location_type,
  sales_value numeric,
  cost_value numeric,
  wastage_value numeric,
  wastage_estimated_value numeric,
  closing_stock_value numeric,
  opening_stock numeric,
  opening_stock_value numeric,
  added_stock numeric,
  added_stock_value numeric,
  sent_out numeric,
  quantity_sold numeric,
  closing_stock numeric
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
    coalesce(sum(se.wastage_estimated_value), 0) as wastage_estimated_value,
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
    ), 0) as closing_stock_value,
    coalesce((
      select sum(earliest.opening_stock)
      from (
        select distinct on (se3.item_id) se3.opening_stock
        from public.stock_entries se3
        where se3.location = se.location
          and se3.entry_date >= p_from
          and se3.entry_date <= p_to
        order by se3.item_id, se3.entry_date asc
      ) earliest
    ), 0) as opening_stock,
    coalesce((
      select sum(earliest.opening_stock * earliest.buying_price_snapshot)
      from (
        select distinct on (se5.item_id) se5.opening_stock, se5.buying_price_snapshot
        from public.stock_entries se5
        where se5.location = se.location
          and se5.entry_date >= p_from
          and se5.entry_date <= p_to
        order by se5.item_id, se5.entry_date asc
      ) earliest
    ), 0) as opening_stock_value,
    coalesce(sum(se.added_stock), 0) as added_stock,
    coalesce(sum(se.added_stock * se.buying_price_snapshot), 0) as added_stock_value,
    coalesce(sum(se.sent_out), 0) as sent_out,
    coalesce(sum(se.quantity_sold), 0) as quantity_sold,
    coalesce((
      select sum(latest.closing_stock)
      from (
        select distinct on (se4.item_id) se4.closing_stock
        from public.stock_entries se4
        where se4.location = se.location
          and se4.entry_date >= p_from
          and se4.entry_date <= p_to
        order by se4.item_id, se4.entry_date desc
      ) latest
    ), 0) as closing_stock
  from public.stock_entries se
  where se.entry_date >= p_from and se.entry_date <= p_to
  group by se.location;
$$;

-- ============================================================
-- dashboard_staff_meal_summary() / dashboard_complimentary_meal_summary()
-- / dashboard_stock_adjustment_summary() -- add estimated_value alongside
-- the existing value sum. Postgres rejects even an appended output
-- column via plain CREATE OR REPLACE FUNCTION (same rule as
-- dashboard_stock_summary() above) -- each needs its own DROP first.
-- ============================================================

drop function if exists public.dashboard_staff_meal_summary(date, date);
drop function if exists public.dashboard_complimentary_meal_summary(date, date);
drop function if exists public.dashboard_stock_adjustment_summary(date, date);

create or replace function public.dashboard_staff_meal_summary(
  p_from date,
  p_to date
)
returns table (
  location location_type,
  value numeric,
  estimated_value numeric
)
language sql
security invoker
stable
as $$
  select
    sme.location,
    coalesce(sum(sme.value), 0) as value,
    coalesce(sum(sme.estimated_value), 0) as estimated_value
  from public.staff_meal_entries sme
  where sme.meal_date >= p_from and sme.meal_date <= p_to
  group by sme.location;
$$;

create or replace function public.dashboard_complimentary_meal_summary(
  p_from date,
  p_to date
)
returns table (
  location location_type,
  value numeric,
  estimated_value numeric
)
language sql
security invoker
stable
as $$
  select
    cme.location,
    coalesce(sum(cme.value), 0) as value,
    coalesce(sum(cme.estimated_value), 0) as estimated_value
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
  value numeric,
  estimated_value numeric
)
language sql
security invoker
stable
as $$
  select
    sae.location,
    coalesce(sum(sae.value), 0) as value,
    coalesce(sum(sae.estimated_value), 0) as estimated_value
  from public.stock_adjustment_entries sae
  where sae.meal_date >= p_from and sae.meal_date <= p_to
  group by sae.location;
$$;
