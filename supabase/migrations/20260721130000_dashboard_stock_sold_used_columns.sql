-- Post-launch addition (2026-07-21): the Dashboard's new "Stock movement"
-- table (20260721120000_dashboard_stock_quantity_columns.sql) showed
-- opening/added/sent-out/closing stock but omitted quantity sold/used --
-- the number that actually explains most of the gap between
-- opening+added and closing. Without it, the table looked like stock was
-- silently vanishing (opening 19 + added 0 = 19, but closing showed 16,
-- with no row accounting for the missing 3). This adds quantity_sold
-- (stock_entries) / quantity_used (ingredient_entries) as genuine period
-- sums, same aggregation rule as added_stock/sent_out/received --
-- quantity_sold already includes both till and order-driven sales
-- (docs/01_DATA_MODEL.md §3.4), so this picks up orders for free.
--
-- CREATE OR REPLACE with a changed return signature requires dropping
-- first (Postgres can't add/reorder output columns via plain
-- CREATE OR REPLACE FUNCTION).
drop function if exists public.dashboard_stock_summary(date, date);
drop function if exists public.dashboard_ingredient_summary(date, date);

-- ============================================================
-- dashboard_stock_summary(p_from, p_to)
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
  closing_stock_value numeric,
  opening_stock numeric,
  added_stock numeric,
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
    coalesce(sum(se.added_stock), 0) as added_stock,
    coalesce(sum(se.sent_out), 0) as sent_out,
    -- quantity_sold already includes both till and order-driven sales
    -- (§3.4) -- a genuine period sum, same as added_stock/sent_out.
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
-- dashboard_ingredient_summary(p_from, p_to)
-- ============================================================
create or replace function public.dashboard_ingredient_summary(
  p_from date,
  p_to date
)
returns table (
  wastage_value numeric,
  closing_stock_value numeric,
  opening_stock numeric,
  received numeric,
  quantity_used numeric,
  closing_stock numeric
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
    ), 0) as closing_stock_value,
    coalesce((
      select sum(earliest.opening_stock)
      from (
        select distinct on (ie3.ingredient_id) ie3.opening_stock
        from public.ingredient_entries ie3
        where ie3.entry_date >= p_from and ie3.entry_date <= p_to
        order by ie3.ingredient_id, ie3.entry_date asc
      ) earliest
    ), 0) as opening_stock,
    coalesce(sum(ie.received), 0) as received,
    coalesce(sum(ie.quantity_used), 0) as quantity_used,
    coalesce((
      select sum(latest.closing_stock)
      from (
        select distinct on (ie4.ingredient_id) ie4.closing_stock
        from public.ingredient_entries ie4
        where ie4.entry_date >= p_from and ie4.entry_date <= p_to
        order by ie4.ingredient_id, ie4.entry_date desc
      ) latest
    ), 0) as closing_stock
  from public.ingredient_entries ie
  where ie.entry_date >= p_from and ie.entry_date <= p_to;
$$;
