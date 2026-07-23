-- ============================================================
-- Helper functions for the estimated-value feature (see
-- 20260723110000_app_settings_estimated_cost_ratio.sql,
-- 20260723120000_estimated_value_columns.sql).
--
-- public.estimated_cost_ratio() — narrow read of the single-row
-- app_settings table, same "small re-derived helper" pattern as
-- staff_meals_total()/canteen_supplied_total() rather than inlining the
-- same SELECT in every writer function below.
--
-- public.effective_unit_cost(buying_price, selling_price) — the actual
-- per-unit cost figure used for wastage_estimated_value/estimated_value:
-- the real buying_price when it's > 0 (the normal case), otherwise
-- selling_price * estimated_cost_ratio() (the fallback for
-- zero-buying-price ingredient-cooked items). This is the ONLY place this
-- fallback logic is expressed — every writer function below calls it
-- rather than re-deriving it inline, matching CLAUDE.md's "no calculation
-- logic duplicated" rule as closely as SQL (vs. lib/calculations.ts) can.
-- ============================================================

create or replace function public.estimated_cost_ratio()
returns numeric
language sql
stable
security invoker
as $$
  select estimated_cost_ratio from public.app_settings where id = true;
$$;

create or replace function public.effective_unit_cost(
  p_buying_price numeric,
  p_selling_price numeric
)
returns numeric
language sql
stable
security invoker
as $$
  select case
    when p_buying_price > 0 then p_buying_price
    else coalesce(p_selling_price, 0) * public.estimated_cost_ratio()
  end;
$$;
