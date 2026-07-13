-- Phase 8: dashboard_low_stock_ingredients() now compares each ingredient's
-- most recent closing_stock against its own real low_stock_threshold column
-- (20260713110000_ingredient_low_stock_threshold.sql), mirroring
-- dashboard_low_stock_items()'s pattern exactly, instead of a shared
-- default-5 parameter.

-- Postgres won't let CREATE OR REPLACE change a function's parameter list
-- or OUT-parameter row shape -- must drop the old signature first.
drop function if exists public.dashboard_low_stock_ingredients(numeric);

create function public.dashboard_low_stock_ingredients()
returns table (
  ingredient_id uuid,
  ingredient_name text,
  closing_stock numeric,
  low_stock_threshold numeric,
  unit text,
  entry_date date
)
language sql
security invoker
stable
as $$
  select
    ing.id as ingredient_id,
    ing.name as ingredient_name,
    latest.closing_stock,
    ing.low_stock_threshold,
    ing.unit,
    latest.entry_date
  from public.ingredients ing
  join lateral (
    select ie.closing_stock, ie.entry_date
    from public.ingredient_entries ie
    where ie.ingredient_id = ing.id
    order by ie.entry_date desc
    limit 1
  ) latest on true
  where ing.active
    and latest.closing_stock <= ing.low_stock_threshold
  order by latest.closing_stock asc, ing.name asc;
$$;
