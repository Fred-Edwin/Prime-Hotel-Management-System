-- Fix A (client-agreed change, 2026-07-30, see docs/01_DATA_MODEL.md §3.18):
-- splits the dashboard's combined "Cost of goods" into two separate,
-- clearly-labeled figures --
--
--   Cost of Goods Sold  -- the real trading cost: value of stock that
--                           actually left (sold/used/wasted/etc.), priced
--                           consistently.
--   Stock Revaluation   -- how much EXISTING on-hand stock's value moved
--                           purely because its catalog buying_price was
--                           edited mid-period, with the stock itself
--                           untouched. Reporting-only, never netted into
--                           net profit -- same treatment as wastage/staff
--                           meals/complimentary meals (§3.10).
--
-- Client report that motivated this (docs/01_DATA_MODEL.md §3.18): a
-- KES 2,046 "Cost of goods" figure included ~KES 1,275 that was not real
-- trading cost at all -- WaPrecious edited "Printing/Papers"'s buying_price
-- from KES 3.50 to KES 1.00 while 94 units (restaurant) + 416 units
-- (canteen) sat untouched in stock. periodicCogs() = opening + added -
-- closing blended that price-edit artifact into COGS indistinguishably
-- from real sold/used cost. She edits buying prices frequently (real
-- supplier costs fluctuate), so this is a recurring, not one-off, source
-- of noise -- worth a permanent split, not a one-time correction.
--
-- Formula (per item/location for stock_entries, per ingredient for
-- ingredient_entries), confirmed with the human:
--
--   revaluation_value = closing_stock_qty * (closing_unit_price - opening_unit_price)
--
-- where closing_unit_price is the latest-in-range row's own
-- buying_price_snapshot, and opening_unit_price is opening_stock_value /
-- opening_stock (falling back to the closing row's own price when
-- opening_stock is 0 -- no price delta is meaningful against zero prior
-- units, so revaluation is correctly 0 for a brand-new item, consistent
-- with §3.9a's fix). This isolates exactly the "price changed, stock
-- didn't move" artifact: if the unit price never changed intra-period,
-- closing_unit_price - opening_unit_price = 0 and revaluation is 0
-- regardless of how much stock moved.
--
--   cost_of_goods_sold = periodicCogs() - revaluation_value
--                       = (opening + added - closing) - revaluation_value
--
-- This is a strict decomposition of the existing combined figure, not a
-- new formula layered on top -- cost_of_goods_sold + revaluation_value
-- always equals the old combined costValue exactly. See
-- lib/calculations.ts's splitCogs() for where this final subtraction
-- happens (kept as a pure JS combining step, same convention as
-- periodicCogs()/netProfit(), so SQL only needs to hand over one new
-- summed VALUE column per function, not restructure anything else).
--
-- Return signature changes (new revaluation_value column) -- both
-- functions need DROP FUNCTION first (Postgres 42P13, §3.9's documented
-- pattern). CTE body is otherwise copied forward verbatim from the
-- current (post-§3.9a) live version -- confirmed against the currently
-- deployed function body, not an older snapshot (§3.9's own documented
-- failure mode).

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
  closing_stock numeric,
  revaluation_value numeric
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
    -- already writes 0 there for a genuinely new item (§3.9a). Also
    -- carries its own buying_price_snapshot -- the "closing unit price"
    -- half of the revaluation comparison below.
    select distinct on (u.item_id, u.location)
      u.item_id, u.location,
      se.closing_stock, se.closing_stock_value,
      se.opening_stock as own_opening_stock,
      se.opening_stock * se.buying_price_snapshot as own_opening_stock_value,
      se.buying_price_snapshot as closing_unit_price
    from universe u
    join public.stock_entries se
      on se.item_id = u.item_id and se.location = u.location
     and se.entry_date <= p_to
    order by u.item_id, u.location, se.entry_date desc
  ),
  opening_before as (
    -- Per item/location: the true period-start balance is whatever was
    -- physically on the shelf when p_from began -- the CLOSING stock of
    -- the latest row strictly before p_from. Unchanged from §3.9. Also
    -- carries that prior row's own buying_price_snapshot -- the "opening
    -- unit price" half of the revaluation comparison below.
    select distinct on (u.item_id, u.location)
      u.item_id, u.location,
      se.closing_stock as opening_stock,
      se.closing_stock_value as opening_stock_value,
      se.buying_price_snapshot as opening_unit_price
    from universe u
    join public.stock_entries se
      on se.item_id = u.item_id and se.location = u.location
     and se.entry_date < p_from
    order by u.item_id, u.location, se.entry_date desc
  ),
  opening as (
    -- Fall back to the CLOSING ROW'S OWN opening_stock/price (what it
    -- started with before its own day's activity) when no earlier row
    -- exists -- NOT that row's closing_stock (§3.9a). When falling back,
    -- opening_unit_price = closing_unit_price (no price history exists
    -- yet), so revaluation correctly comes out to 0 for a brand-new item
    -- regardless of its own_opening_stock being 0.
    select
      c.item_id, c.location,
      coalesce(ob.opening_stock, c.own_opening_stock) as opening_stock,
      coalesce(ob.opening_stock_value, c.own_opening_stock_value) as opening_stock_value,
      coalesce(ob.opening_unit_price, c.closing_unit_price) as opening_unit_price
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
    -- revaluation_per_item: the artifact isolated per item/location --
    -- closing quantity still on hand, priced at the DELTA between the
    -- unit price now in effect and the unit price in effect at period
    -- start. Zero whenever the unit price never changed intra-period, by
    -- construction (closing_unit_price - opening_unit_price = 0).
    select
      u.location,
      coalesce(sum(cl.closing_stock_value), 0) as closing_stock_value,
      coalesce(sum(o.opening_stock), 0) as opening_stock,
      coalesce(sum(o.opening_stock_value), 0) as opening_stock_value,
      coalesce(sum(cl.closing_stock), 0) as closing_stock,
      coalesce(sum(cl.closing_stock * (cl.closing_unit_price - o.opening_unit_price)), 0) as revaluation_value
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
    cf.closing_stock,
    cf.revaluation_value
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
  closing_stock numeric,
  revaluation_value numeric
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
      ie.opening_stock * ie.buying_price_snapshot as own_opening_stock_value,
      ie.buying_price_snapshot as closing_unit_price
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
      ie.closing_stock_value as opening_stock_value,
      ie.buying_price_snapshot as opening_unit_price
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
      coalesce(ob.opening_stock_value, c.own_opening_stock_value) as opening_stock_value,
      coalesce(ob.opening_unit_price, c.closing_unit_price) as opening_unit_price
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
  ),
  revaluation as (
    select
      coalesce(sum(c.closing_stock * (c.closing_unit_price - o.opening_unit_price)), 0) as revaluation_value
    from closing c
    join opening o on o.ingredient_id = c.ingredient_id
  )
  select
    coalesce((select wastage_value from period_sums), 0) as wastage_value,
    coalesce((select sum(closing_stock_value) from closing), 0) as closing_stock_value,
    coalesce((select sum(opening_stock) from opening), 0) as opening_stock,
    coalesce((select sum(opening_stock_value) from opening), 0) as opening_stock_value,
    coalesce((select received from period_sums), 0) as received,
    coalesce((select received_value from period_sums), 0) as received_value,
    coalesce((select quantity_used from period_sums), 0) as quantity_used,
    coalesce((select sum(closing_stock) from closing), 0) as closing_stock,
    coalesce((select revaluation_value from revaluation), 0) as revaluation_value
$$;
