-- Post-launch bug fix (2026-07-22): dashboard "Today" period showed
-- closing stock (and every other figure these functions return) as a
-- false KES 0 for a location/ingredient pool first thing in the morning,
-- before any staff member had saved a stock entry for the day yet.
--
-- Root cause: dashboard_stock_summary()/dashboard_ingredient_summary()
-- were plain `where entry_date >= p_from and entry_date <= p_to` queries.
-- If zero rows exist in that date range for a location (or, for
-- ingredients, the whole table), the query returns zero ROWS for that
-- location -- not a row with closing_stock = 0. The route handler
-- (app/api/dashboard/summary/route.ts) then does `?? 0` on the missing
-- row, so "no row returned" silently became a displayed 0, indistinguishable
-- from "everything sold out." See docs/01_DATA_MODEL.md §3.9 for the full
-- writeup -- this comment is a summary, that section is authoritative.
--
-- Fix, per-item (not per-location -- a location can have some items
-- entered today and others not, each needs its own correct fallback):
--   * closing_stock / closing_stock_value: per item, the latest row at or
--     before p_to (the p_from lower bound is dropped for this specific
--     lookup -- an item with no row in [p_from, p_to] still carries
--     forward its last known closing stock, exactly like opening_stock
--     already carries forward at the row-write level, §3.1).
--   * opening_stock / opening_stock_value: per item, the CLOSING stock of
--     the latest row STRICTLY BEFORE p_from (what was actually on the
--     shelf when the period began), if one exists; otherwise the same
--     "latest at or before p_to" lookup closing_stock uses (item first
--     touched mid-period -- there is no earlier balance, so its earliest
--     known state doubles as both its opening and current figure, which
--     is correct: it had no stock before it existed). Using that prior
--     row's own opening_stock instead of its closing_stock was an initial
--     bug in this migration (fixed before being applied to prosper-hotel-
--     dev/prime-hotel-demo) -- it re-derived the prior day's own cost
--     movement instead of representing "nothing has moved since the last
--     known close," producing a nonzero (sometimes negative) COGS for a
--     genuinely quiet period. See docs/01_DATA_MODEL.md §3.9.
--   * added_stock/sent_out/quantity_sold/wastage_value/sales_value/
--     cost_value/added_stock_value (stock) and received/quantity_used/
--     received_value/wastage_value (ingredients) are genuine period sums
--     -- unchanged, correctly zero for an item with no activity in range.
--
-- The per-item universe is every (item_id, location) / ingredient_id pair
-- that has EVER appeared in stock_entries/ingredient_entries -- driven by
-- a `distinct` over the whole table, not date-bounded -- so an item that
-- has genuinely never been entered at all still correctly contributes
-- nothing (it was never in range under the old logic either, and there is
-- no "last known value" for it to carry forward).
--
-- CREATE OR REPLACE with a changed return signature requires dropping
-- first (Postgres can't add/reorder output columns via plain
-- CREATE OR REPLACE FUNCTION) -- same pattern as the migrations these
-- functions have gone through before.
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
    -- Reading opening_stock here was the bug: it re-derived the prior
    -- day's cost movement instead of representing "nothing has moved
    -- since the last known close," which made a quiet/no-activity period
    -- (e.g. "today" before anyone has entered anything) compute a
    -- nonzero, sometimes negative, COGS instead of ~0. See
    -- docs/01_DATA_MODEL.md §3.9's correction note.
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

-- ============================================================
-- dashboard_ingredient_summary(p_from, p_to)
-- Same fix, ingredient-shaped (no location split).
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
  with universe as (
    select distinct ie_all.ingredient_id
    from public.ingredient_entries ie_all
  ),
  closing as (
    select distinct on (u.ingredient_id)
      u.ingredient_id,
      ie.closing_stock, ie.closing_stock_value
    from universe u
    join public.ingredient_entries ie
      on ie.ingredient_id = u.ingredient_id
     and ie.entry_date <= p_to
    order by u.ingredient_id, ie.entry_date desc
  ),
  opening_before as (
    -- Same correction as dashboard_stock_summary()'s opening_before above:
    -- the period-start balance is the prior row's CLOSING stock (what was
    -- actually on hand when p_from began), not that row's own
    -- opening_stock (what it started with before ITS OWN day's activity).
    select distinct on (u.ingredient_id)
      u.ingredient_id,
      ie.closing_stock as opening_stock,
      ie.closing_stock_value as opening_stock_value
    from universe u
    join public.ingredient_entries ie
      on ie.ingredient_id = u.ingredient_id
     and ie.entry_date < p_from
    order by u.ingredient_id, ie.entry_date desc
  ),
  opening as (
    select
      c.ingredient_id,
      coalesce(ob.opening_stock, c.closing_stock) as opening_stock,
      coalesce(ob.opening_stock_value, c.closing_stock_value) as opening_stock_value
    from closing c
    left join opening_before ob on ob.ingredient_id = c.ingredient_id
  ),
  period_sums as (
    select
      coalesce(sum(ie.wastage_value), 0) as wastage_value,
      coalesce(sum(ie.received), 0) as received,
      coalesce(sum(ie.received * ie.buying_price_snapshot), 0) as received_value,
      coalesce(sum(ie.quantity_used), 0) as quantity_used
    from public.ingredient_entries ie
    where ie.entry_date >= p_from and ie.entry_date <= p_to
  )
  select
    coalesce((select wastage_value from period_sums), 0) as wastage_value,
    coalesce((select sum(closing_stock_value) from closing), 0) as closing_stock_value,
    coalesce((select sum(opening_stock) from opening), 0) as opening_stock,
    coalesce((select sum(opening_stock_value) from opening), 0) as opening_stock_value,
    coalesce((select received from period_sums), 0) as received,
    coalesce((select received_value from period_sums), 0) as received_value,
    coalesce((select quantity_used from period_sums), 0) as quantity_used,
    coalesce((select sum(closing_stock) from closing), 0) as closing_stock
$$;
