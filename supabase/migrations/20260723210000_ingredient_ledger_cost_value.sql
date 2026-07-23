-- Client feedback: add a Cost Value column to the Item Ledger's Ingredients
-- section, mirroring the Items section's existing cost_value (which is
-- quantity_sold * buying_price_snapshot -- cost of goods sold for the
-- period). For ingredients the equivalent consumption figure is
-- quantity_used * buying_price_snapshot: the cash value of ingredient
-- actually used (cooked with) that day, distinct from closing_stock_value
-- (value of what's left) and wastage_value (value of what spoiled).

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
  cost_value numeric,
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
    ie.quantity_used * ie.buying_price_snapshot as cost_value,
    ie.closing_stock_value,
    ie.wastage_value,
    ing.low_stock_threshold
  from public.ingredient_entries ie
  join public.ingredients ing on ing.id = ie.ingredient_id
  where ie.entry_date >= p_from and ie.entry_date <= p_to
  order by ie.entry_date desc, ing.name asc;
$$;
