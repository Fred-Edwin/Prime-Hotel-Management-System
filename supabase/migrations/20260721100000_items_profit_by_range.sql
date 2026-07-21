-- Post-launch: Item Master page profit-by-date-range column (client request,
-- WaPrecious, 2026-07-21). The Margin column already shown on /items is a
-- static per-unit % from the item's current buying/selling price -- this adds
-- an actual KES profit figure, summed per item over a date range she picks.
--
-- NOTE: lib/supabase/types.ts was hand-edited to add this function's entry
-- (matching this repo's other RPC type shapes) since it can't be generated
-- from the live schema until this migration is applied. Once applied, rerun
-- `supabase gen types` against prosper-hotel-dev and diff against the
-- hand-added entry to confirm they match.
--
-- Mirrors dashboard_item_ledger()'s access shape (`security invoker`, same
-- location-scoped RLS on stock_entries applies) but pre-aggregates in SQL
-- (sum()/group by), matching the other dashboard_* functions in
-- 20260712121500_dashboard_aggregation_functions.sql -- never fetch every
-- daily row and sum client-side.
--
-- profit = sum(sales_value) - sum(cost_value) - sum(wastage_value), all
-- already computed from each row's snapshotted buying/selling price at
-- write time (docs/01_DATA_MODEL.md §3), never the item's current price --
-- this is what keeps the figure correct across a range spanning a price
-- change.
create or replace function public.items_profit_by_range(
  p_from date,
  p_to date,
  p_location location_type default null
)
returns table (
  item_id uuid,
  profit numeric
)
language sql
security invoker
stable
as $$
  select
    se.item_id,
    coalesce(sum(se.sales_value - se.cost_value - se.wastage_value), 0) as profit
  from public.stock_entries se
  where se.entry_date >= p_from
    and se.entry_date <= p_to
    and (p_location is null or se.location = p_location)
  group by se.item_id;
$$;
