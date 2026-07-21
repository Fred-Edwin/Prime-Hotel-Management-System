-- Post-launch change (2026-07-21): client (WaPrecious) wants COGS
-- calculated her way -- the periodic-inventory method she already used on
-- her Excel sheet -- instead of the app's previous quantity_sold-based
-- COGS:
--
--   COGS = Opening Stock Value + Added Stock Value - Closing Stock Value
--
-- combining BOTH menu items (stock_entries) and ingredients
-- (ingredient_entries) into one figure, per her explicit instruction
-- (confirmed: yes, add the two closing-stock VALUES together, accepting
-- that an in-house-cooked item's own buying_price and the ingredient cost
-- that produced it both contribute -- see docs/01_DATA_MODEL.md note
-- added alongside this migration).
--
-- closing_stock_value and opening_stock (quantity) were already exposed
-- by 20260721120000_dashboard_stock_quantity_columns.sql, using the
-- correct point-in-time rule (each item's EARLIEST/LATEST row in the
-- range, never summed across days). This migration adds the missing
-- pieces: opening_stock_value (that same earliest row's opening_stock *
-- its own buying_price_snapshot) and added_stock_value (summed per-row
-- added_stock * buying_price_snapshot across the range, so a mid-period
-- price change is costed correctly -- same pattern cost_value/
-- wastage_value already use, never "latest price * total quantity").
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
    -- Opening stock VALUE: same earliest-row-per-item rule as
    -- opening_stock (a period-start snapshot, not a flow), priced at that
    -- same row's own buying_price_snapshot -- never today's catalog price.
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
    -- Added stock VALUE: a genuine period sum, each row costed at its own
    -- buying_price_snapshot (so a mid-period price change is captured
    -- correctly) -- same pattern as cost_value/wastage_value, never
    -- "latest price * total added quantity".
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
-- dashboard_ingredient_summary(p_from, p_to)
-- Same additions as above, ingredient-shaped (received instead of
-- added_stock -- ingredients have no restaurant->canteen split).
-- ============================================================
create or replace function public.dashboard_ingredient_summary(
  p_from date,
  p_to date
)
returns table (
  wastage_value numeric,
  closing_stock_value numeric,
  opening_stock numeric,
  opening_stock_value numeric,
  received numeric,
  received_value numeric,
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
    coalesce((
      select sum(earliest.opening_stock * earliest.buying_price_snapshot)
      from (
        select distinct on (ie5.ingredient_id) ie5.opening_stock, ie5.buying_price_snapshot
        from public.ingredient_entries ie5
        where ie5.entry_date >= p_from and ie5.entry_date <= p_to
        order by ie5.ingredient_id, ie5.entry_date asc
      ) earliest
    ), 0) as opening_stock_value,
    coalesce(sum(ie.received), 0) as received,
    -- Received VALUE: genuine period sum, each row costed at its own
    -- buying_price_snapshot -- same rationale as added_stock_value above.
    coalesce(sum(ie.received * ie.buying_price_snapshot), 0) as received_value,
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
