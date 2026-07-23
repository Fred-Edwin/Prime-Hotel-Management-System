-- Fix regression introduced by 20260723180000_unconditional_estimated_value.sql
-- (item #12 in that migration): its `drop function ... dashboard_stock_summary`
-- + `create or replace` was only meant to drop the now-redundant
-- estimated_value output column, but the CREATE body it used was pasted from
-- BEFORE 20260722060000_dashboard_carry_forward_closing_stock.sql's fix --
-- silently reverting dashboard_stock_summary() to a plain
-- `where entry_date >= p_from and entry_date <= p_to` / `group by location`
-- query with no per-item carry-forward of the latest known closing stock.
--
-- Symptom: any location with zero stock_entries rows dated inside the
-- selected period (e.g. "Today" before it rolls over, or a location no one
-- has entered yet today) returns zero ROWS from this function, so the route
-- handler's `?? 0` renders closing stock (and its VALUE) as a false KES 0 --
-- exactly the bug 20260722060000 fixed, now reintroduced. This is why the
-- Ledger screen showed correct non-zero `closing` quantities (computed
-- per-row at write time by save_stock_entry() etc., unaffected) next to a
-- KES 0 `closing_stock_value` column (computed by this function) for the
-- SAME rows.
--
-- dashboard_ingredient_summary() was not affected -- 20260723180000 didn't
-- touch it, so it kept 20260722060000's carry-forward body throughout.
--
-- This migration re-applies 20260722060000's dashboard_stock_summary() body
-- verbatim (universe/closing/opening_before/opening/period_sums/
-- carry_forward CTEs), on top of the current (post-*_estimated_value-drop)
-- 11-column return shape -- no wastage_estimated_value column, since that
-- was correctly dropped from stock_entries itself in 20260723180000 and
-- must stay dropped.
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
  with universe as (
    -- Every (item_id, location) pair that has ever had a stock_entries
    -- row -- not date-bounded. This is the set of locations/items the
    -- closing/opening carry-forward below is computed over, independent
    -- of whether anything fell inside [p_from, p_to].
    select distinct se_all.item_id, se_all.location
    from public.stock_entries se_all
  ),
  closing as (
    -- Per item/location: latest row at or before p_to, no lower bound --
    -- this is what lets an item with nothing in [p_from, p_to] still
    -- carry forward its last known closing stock instead of vanishing.
    select distinct on (u.item_id, u.location)
      u.item_id, u.location,
      se.closing_stock, se.closing_stock_value
    from universe u
    join public.stock_entries se
      on se.item_id = u.item_id and se.location = u.location
     and se.entry_date <= p_to
    order by u.item_id, u.location, se.entry_date desc
  ),
  opening_before as (
    -- Per item/location: the true period-start balance is whatever was
    -- physically on the shelf when p_from began -- that is the CLOSING
    -- stock of the latest row strictly before p_from (what yesterday
    -- ended with), not that row's own opening_stock (what yesterday
    -- STARTED with, before yesterday's own sales/wastage/etc. happened).
    select distinct on (u.item_id, u.location)
      u.item_id, u.location,
      se.closing_stock as opening_stock,
      se.closing_stock_value as opening_stock_value
    from universe u
    join public.stock_entries se
      on se.item_id = u.item_id and se.location = u.location
     and se.entry_date < p_from
    order by u.item_id, u.location, se.entry_date desc
  ),
  opening as (
    -- Fall back to the closing-style lookup (latest at or before p_to)
    -- for an item first touched mid-period -- there is no earlier
    -- balance, so its earliest known state is correctly both its
    -- opening and current figure.
    select
      c.item_id, c.location,
      coalesce(ob.opening_stock, c.closing_stock) as opening_stock,
      coalesce(ob.opening_stock_value, c.closing_stock_value) as opening_stock_value
    from closing c
    left join opening_before ob
      on ob.item_id = c.item_id and ob.location = c.location
  ),
  period_sums as (
    -- Genuine period sums -- correctly zero for an item with no activity
    -- in [p_from, p_to], unchanged from before this fix.
    select
      se.location,
      coalesce(sum(se.sales_value), 0) as sales_value,
      coalesce(sum(se.cost_value), 0) as cost_value,
      coalesce(sum(se.wastage_value), 0) as wastage_value,
      coalesce(sum(se.added_stock), 0) as added_stock,
      coalesce(sum(se.added_stock * se.buying_price_snapshot), 0) as added_stock_value,
      coalesce(sum(se.sent_out), 0) as sent_out,
      coalesce(sum(se.quantity_sold), 0) as quantity_sold
    from public.stock_entries se
    where se.entry_date >= p_from and se.entry_date <= p_to
    group by se.location
  ),
  carry_forward as (
    select
      u.location,
      coalesce(sum(cl.closing_stock_value), 0) as closing_stock_value,
      coalesce(sum(o.opening_stock), 0) as opening_stock,
      coalesce(sum(o.opening_stock_value), 0) as opening_stock_value,
      coalesce(sum(cl.closing_stock), 0) as closing_stock
    from universe u
    join closing cl on cl.item_id = u.item_id and cl.location = u.location
    join opening o on o.item_id = u.item_id and o.location = u.location
    group by u.location
  )
  select
    cf.location,
    coalesce(ps.sales_value, 0) as sales_value,
    coalesce(ps.cost_value, 0) as cost_value,
    coalesce(ps.wastage_value, 0) as wastage_value,
    cf.closing_stock_value,
    cf.opening_stock,
    cf.opening_stock_value,
    coalesce(ps.added_stock, 0) as added_stock,
    coalesce(ps.added_stock_value, 0) as added_stock_value,
    coalesce(ps.sent_out, 0) as sent_out,
    coalesce(ps.quantity_sold, 0) as quantity_sold,
    cf.closing_stock
  from carry_forward cf
  left join period_sums ps on ps.location = cf.location
$$;
