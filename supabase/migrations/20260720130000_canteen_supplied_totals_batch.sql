-- ============================================================
-- Perf fix, found live-testing the canteen daily-cadence conversion
-- (20260720120000_canteen_daily_cadence.sql): GET /api/stock-entries's
-- canteen branch calls canteen_supplied_total() once per canteen_supplied
-- item, sequentially awaited in a route-handler loop. This loop already
-- existed before the cadence conversion -- only its date-range arguments
-- changed there -- but it's now the dominant cost on every canteen
-- /entry page load rather than an occasional one, since canteen visits
-- this same-day figure daily instead of once a week. Against this
-- project's hosted (not local) Supabase project, with the real ~25-item
-- canteen_supplied catalog, this measured at ~10-11 seconds
-- (25 sequential round trips at ~400-450ms each) -- a genuine,
-- user-visible regression in how *often* this cost is paid, confirmed
-- live via the verify skill/manual reproduction, not assumed from
-- reading the code.
--
-- FIX: a batched sibling, canteen_supplied_totals_batch(), returns every
-- requested item's same-day sent_out total in one round trip instead of
-- N. canteen_supplied_total() itself is UNCHANGED (still used by every
-- single-row write function -- save_stock_entry_canteen_field(),
-- apply_order_to_stock_entry(), create_staff_meal_entry(), etc. -- each
-- of which only ever needs one item's figure per call, so batching
-- doesn't apply there). Only app/api/stock-entries/route.ts's GET
-- handler (the one place that was ever looping over multiple items)
-- switches to the batched call.
-- ============================================================

create or replace function public.canteen_supplied_totals_batch(
  p_item_ids uuid[],
  p_date date
)
returns table (
  item_id uuid,
  total numeric
)
language sql
security definer
stable
as $$
  select
    i.id as item_id,
    coalesce(sum(se.sent_out), 0) as total
  from unnest(p_item_ids) as i(id)
  left join public.stock_entries se
    on se.item_id = i.id
    and se.location = 'restaurant'
    and se.entry_date = p_date
  where exists (
    select 1 from public.items
    where id = i.id and supply_type = 'canteen_supplied'
  )
  group by i.id;
$$;
