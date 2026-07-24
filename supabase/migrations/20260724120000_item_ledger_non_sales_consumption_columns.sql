-- ============================================================
-- dashboard_item_ledger(): add combined non-sales stock consumption
-- columns (client feedback, 2026-07-24) -- the Item Ledger's first table
-- previously only surfaced `wastage`/`wastage_value`, even though closing
-- stock (§3.10) is also reduced by staff meals, complimentary meals, and
-- stock adjustments. WaPrecious wanted a way to see this on the main
-- table, not just by opening the separate "Non-Sales Stock Consumption"
-- section further down the page.
--
-- Decision (confirmed with the human): REPLACE the existing wastage/
-- wastage_value columns in this row-level table with one combined pair
-- -- non_sales_consumption (quantity) / non_sales_consumption_value
-- (money) -- summing all four categories, rather than adding two more
-- columns alongside wastage's existing pair. Keeps the already-wide
-- (15-column) table from growing further, and matches §3.10's "unified
-- presentation" precedent already used by the separate Non-Sales Stock
-- Consumption section. Per-category detail remains available there,
-- unaffected by this change -- this table only ever shows the combined
-- total, by design.
--
-- non_sales_consumption's sign follows stock_adjustment_entries' own
-- convention (§3.10): positive = net consumption/shortfall, negative =
-- net surplus. wastage/staff_meal/complimentary_meal are always
-- non-negative, so a negative combined total only happens when a
-- surplus stock adjustment outweighs the other three for that
-- item/location/date -- matching how closing_stock's own formula
-- already treats a stock adjustment as signed.
--
-- Uses a LEFT JOIN LATERAL per claim table rather than three scalar
-- subquery calls to staff_meals_total()/complimentary_meals_total()/
-- stock_adjustments_total() per row -- those helpers take a period
-- range and were built for the six stock_entries writer functions'
-- single-item, single-day call pattern (§3.5), not for aggregating
-- across every row a whole ledger date range returns. A join keeps this
-- one set-based query, consistent with this function's own existing
-- "not N+1 fetches" comment.
--
-- Requires DROP FUNCTION first (adding output columns changes the
-- return type; see §3.9's documented Postgres 42P13 lesson) -- copying
-- the current body forward unchanged aside from the new columns, not
-- from an older snapshot.
-- ============================================================

drop function if exists public.dashboard_item_ledger(date, date, location_type);

create function public.dashboard_item_ledger(
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
  non_sales_consumption numeric,
  non_sales_consumption_value numeric,
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
    se.wastage
      + coalesce(sme.quantity, 0)
      + coalesce(cme.quantity, 0)
      + coalesce(sae.quantity, 0) as non_sales_consumption,
    se.wastage_value
      + coalesce(sme.value, 0)
      + coalesce(cme.value, 0)
      + coalesce(sae.value, 0) as non_sales_consumption_value,
    i.low_stock_threshold
  from public.stock_entries se
  join public.items i on i.id = se.item_id
  left join lateral (
    select sum(quantity) as quantity, sum(value) as value
    from public.staff_meal_entries
    where item_id = se.item_id
      and location = se.location
      and meal_date = se.entry_date
  ) sme on true
  left join lateral (
    select sum(quantity) as quantity, sum(value) as value
    from public.complimentary_meal_entries
    where item_id = se.item_id
      and location = se.location
      and meal_date = se.entry_date
  ) cme on true
  left join lateral (
    select sum(quantity) as quantity, sum(value) as value
    from public.stock_adjustment_entries
    where item_id = se.item_id
      and location = se.location
      and meal_date = se.entry_date
  ) sae on true
  where se.entry_date >= p_from
    and se.entry_date <= p_to
    and (p_location is null or se.location = p_location)
  order by se.entry_date desc, i.name asc;
$$;
