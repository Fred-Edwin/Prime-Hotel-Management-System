-- Post-launch addition (2026-07-21): client (WaPrecious) wants to see
-- restaurant vs. canteen closing stock split out separately on the
-- dashboard, plus the underlying quantity flows (opening/added/sent-out/
-- closing) that explain it -- not just the combined money figure. This
-- extends the two existing summary functions with quantity columns,
-- following the exact same aggregation rules already established:
-- opening_stock/added_stock/sent_out are period-summed flows, while
-- closing_stock (like closing_stock_value) is a point-in-time figure --
-- each item's/ingredient's MOST RECENT row within the range, never
-- summed across days (that would double-count carried-forward stock).
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
    -- Opening stock is a period-start snapshot, not a flow -- summing
    -- every day's opening_stock across a multi-day range double-counts
    -- carried-forward stock, same reasoning as closing_stock below. Take
    -- each item's EARLIEST row in the range instead, matching what
    -- "opening stock for this period" means (the balance right when the
    -- period started).
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
    -- Closing stock (quantity): same "latest row per item" rule as
    -- closing_stock_value above -- a point-in-time balance, not a sum.
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
-- Same additions as above, ingredient-shaped (received instead of
-- added_stock/sent_out -- ingredients have no restaurant->canteen split).
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
