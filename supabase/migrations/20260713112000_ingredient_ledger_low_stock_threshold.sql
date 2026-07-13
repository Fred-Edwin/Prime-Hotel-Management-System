-- Phase 8: dashboard_ingredient_ledger() now also returns
-- low_stock_threshold, mirroring dashboard_item_ledger()'s existing
-- shape, now that ingredients have a real per-row threshold
-- (20260713110000_ingredient_low_stock_threshold.sql).

-- Postgres won't let CREATE OR REPLACE change a function's OUT-parameter
-- row shape -- must drop the old signature first.
drop function if exists public.dashboard_ingredient_ledger(date, date);

create function public.dashboard_ingredient_ledger(
  p_from date,
  p_to date
)
returns table (
  entry_date date,
  ingredient_id uuid,
  ingredient_name text,
  unit text,
  opening_stock numeric,
  received numeric,
  quantity_used numeric,
  wastage numeric,
  closing_stock numeric,
  closing_stock_value numeric,
  wastage_value numeric,
  low_stock_threshold numeric
)
language sql
security invoker
stable
as $$
  select
    ie.entry_date,
    ie.ingredient_id,
    ing.name as ingredient_name,
    ing.unit,
    ie.opening_stock,
    ie.received,
    ie.quantity_used,
    ie.wastage,
    ie.closing_stock,
    ie.closing_stock_value,
    ie.wastage_value,
    ing.low_stock_threshold
  from public.ingredient_entries ie
  join public.ingredients ing on ing.id = ie.ingredient_id
  where ie.entry_date >= p_from and ie.entry_date <= p_to
  order by ie.entry_date desc, ing.name asc;
$$;
