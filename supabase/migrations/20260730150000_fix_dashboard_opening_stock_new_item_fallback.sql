-- Post-launch bug fix (2026-07-30, client-reported): a brand-new item or
-- ingredient's FIRST-EVER row inflated the dashboard's Cost of Goods by
-- the full value of its first purchase/addition, even with nothing sold
-- or used.
--
-- Client report (WaPrecious): bought "Printing Papers" (an ingredient,
-- 500 pcs @ KES 1), logged the purchase, quantity_used/wastage both 0.
-- The Ledger correctly showed received=500, used=0, wasted=0,
-- closing_value=500 for that row. But the dashboard's combined "Cost of
-- goods" (periodicCogs() = opening + added - closing, see
-- docs/01_DATA_MODEL.md §3.8) jumped by +500 for a purchase that hadn't
-- been used at all yet.
--
-- Root cause: dashboard_stock_summary()/dashboard_ingredient_summary()'s
-- `opening` CTE (20260722060000_dashboard_carry_forward_closing_stock.sql,
-- §3.9) falls back to `closing`'s own closing_stock/closing_stock_value
-- whenever no row exists strictly before p_from:
--
--   coalesce(ob.opening_stock, c.closing_stock) as opening_stock
--
-- That fallback is correct for an item whose EARLIEST ROW WITHIN RANGE
-- represents real pre-existing stock (e.g. an item first entered mid-
-- period that already had stock on the shelf before its first logged
-- row -- §3.9's own docstring: "there is no earlier balance, so its
-- earliest known state is correctly both its opening and current
-- figure"). But it's WRONG for a genuinely brand-new item/ingredient
-- whose first-ever row's `received`/`added_stock` IS the period's
-- activity: using that same row's CLOSING stock (after the purchase) as
-- the OPENING stock (before the purchase) makes the purchase invisible
-- to the formula's "opening + added" side while still subtracting it on
-- the "closing" side, silently manufacturing +500 of unmatched cost.
--
-- save_stock_entry()/save_ingredient_entry() (the write path) already
-- get this right per row: a genuinely first-ever row's own opening_stock
-- column is written as 0 (docs/01_DATA_MODEL.md line ~674 -- "First-ever
-- entry for an item: opening_stock defaults to 0"). The dashboard read
-- side just never consulted that column -- it always derived opening
-- from `closing_stock`, even when the row's own `opening_stock` (0, in
-- this case) was sitting right there and correct.
--
-- Fix: `closing` now also carries that same earliest-qualifying row's
-- own opening_stock/opening_stock_value alongside its closing figures.
-- `opening`'s fallback (used only when no row exists strictly before
-- p_from) reads THAT row's real opening_stock/opening_stock_value
-- instead of fabricating one from closing_stock/closing_stock_value.
-- This is a strict correction, not a behavior change for the case §3.9
-- was actually fixing: for an item whose earliest-in-range row is NOT
-- also its first-ever row (real prior stock existed, just not reflected
-- in this range), that row's own opening_stock already equals what was
-- on the shelf before that row's own day of activity -- reading it here
-- is exactly as correct as reading closing_stock was, since day-to-day
-- opening_stock IS the prior day's closing_stock by the normal carry-
-- forward rule (§3.1). The only case this changes is the genuinely-new-
-- item case, where it corrects a real bug.
--
-- CREATE OR REPLACE with a changed return signature requires dropping
-- first -- same pattern as prior migrations to these functions. Return
-- signature is UNCHANGED here (no new/removed columns), but included
-- for consistency with how these two functions have always been
-- modified, and because a bare CREATE OR REPLACE with a body-only change
-- is safe without dropping -- drop is omitted this time since the
-- signature genuinely doesn't change.

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
    select distinct se_all.item_id, se_all.location
    from public.stock_entries se_all
  ),
  closing as (
    -- Per item/location: latest row at or before p_to, no lower bound.
    -- Also carries THAT SAME ROW's own opening_stock/opening_stock_value
    -- (what was on hand before ITS OWN day's activity) -- this is the
    -- correct fallback for a first-ever row, since save_stock_entry()
    -- already writes 0 there for a genuinely new item (§3.1).
    select distinct on (u.item_id, u.location)
      u.item_id, u.location,
      se.closing_stock, se.closing_stock_value,
      se.opening_stock as own_opening_stock,
      se.opening_stock * se.buying_price_snapshot as own_opening_stock_value
    from universe u
    join public.stock_entries se
      on se.item_id = u.item_id and se.location = u.location
     and se.entry_date <= p_to
    order by u.item_id, u.location, se.entry_date desc
  ),
  opening_before as (
    -- Per item/location: the true period-start balance is whatever was
    -- physically on the shelf when p_from began -- the CLOSING stock of
    -- the latest row strictly before p_from. Unchanged from §3.9.
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
    -- Fall back to the CLOSING ROW'S OWN opening_stock (what it started
    -- with before its own day's activity) when no earlier row exists --
    -- NOT that row's closing_stock (what it ended with after its own
    -- day's activity). Fixes the new-item COGS-inflation bug: a brand-
    -- new item's first row correctly opens at 0, not at its post-
    -- purchase closing figure.
    select
      c.item_id, c.location,
      coalesce(ob.opening_stock, c.own_opening_stock) as opening_stock,
      coalesce(ob.opening_stock_value, c.own_opening_stock_value) as opening_stock_value
    from closing c
    left join opening_before ob
      on ob.item_id = c.item_id and ob.location = c.location
  ),
  period_sums as (
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
      ie.closing_stock, ie.closing_stock_value,
      ie.opening_stock as own_opening_stock,
      ie.opening_stock * ie.buying_price_snapshot as own_opening_stock_value
    from universe u
    join public.ingredient_entries ie
      on ie.ingredient_id = u.ingredient_id
     and ie.entry_date <= p_to
    order by u.ingredient_id, ie.entry_date desc
  ),
  opening_before as (
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
      coalesce(ob.opening_stock, c.own_opening_stock) as opening_stock,
      coalesce(ob.opening_stock_value, c.own_opening_stock_value) as opening_stock_value
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
