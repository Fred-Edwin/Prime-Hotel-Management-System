-- ============================================================
-- Add estimated_value to dashboard_stock_consumption_ledger()'s return
-- shape -- see 20260723110000/20260723120000/20260723140000/20260723150000
-- for the full context.
--
-- ingredient wastage (the second UNION ALL branch) has no
-- estimated_value column on ingredient_entries -- ingredients aren't
-- what WaPrecious zeroed buying_price on (only ingredient-cooked MENU
-- ITEMS, §3.10), so that branch's estimated_value is just its own
-- wastage_value (identical, since ingredient buying_price is never 0 in
-- practice) rather than adding an unused column to ingredient_entries.
--
-- CREATE OR REPLACE with a changed return signature requires dropping
-- first (Postgres can't add/reorder output columns via plain
-- CREATE OR REPLACE FUNCTION) -- same rule 20260721140000_dashboard_
-- periodic_cogs_columns.sql and 20260723170000_dashboard_summary_
-- estimated_values.sql already followed for this exact reason.
-- ============================================================
drop function if exists public.dashboard_stock_consumption_ledger(date, date, location_type);

create or replace function public.dashboard_stock_consumption_ledger(
  p_from date,
  p_to date,
  p_location location_type default null
)
returns table (
  category text,
  entry_date date,
  item_id uuid,
  item_name text,
  ingredient_id uuid,
  ingredient_name text,
  unit text,
  location location_type,
  quantity numeric,
  value numeric,
  estimated_value numeric,
  note text,
  staff_id uuid,
  staff_name text
)
language sql
security invoker
stable
as $$
  select
    'wastage'::text as category,
    se.entry_date,
    se.item_id,
    i.name as item_name,
    null::uuid as ingredient_id,
    null::text as ingredient_name,
    null::text as unit,
    se.location,
    se.wastage as quantity,
    se.wastage_value as value,
    se.wastage_estimated_value as estimated_value,
    se.wastage_note as note,
    null::uuid as staff_id,
    null::text as staff_name
  from public.stock_entries se
  join public.items i on i.id = se.item_id
  where se.entry_date >= p_from
    and se.entry_date <= p_to
    and se.wastage > 0
    and (p_location is null or se.location = p_location)

  union all

  select
    'wastage'::text as category,
    ie.entry_date,
    null::uuid as item_id,
    null::text as item_name,
    ie.ingredient_id,
    ing.name as ingredient_name,
    ing.unit,
    null::location_type as location,  -- ingredients have no location column (§3.2, restaurant-only)
    ie.wastage as quantity,
    ie.wastage_value as value,
    ie.wastage_value as estimated_value,  -- ingredients were never zeroed, see note above
    ie.wastage_note as note,
    null::uuid as staff_id,
    null::text as staff_name
  from public.ingredient_entries ie
  join public.ingredients ing on ing.id = ie.ingredient_id
  where ie.entry_date >= p_from
    and ie.entry_date <= p_to
    and ie.wastage > 0
    and p_location is null  -- ingredient wastage has no location to filter by; excluded entirely when a specific location is requested

  union all

  select
    'staff_meal'::text as category,
    sme.meal_date as entry_date,
    sme.item_id,
    i.name as item_name,
    null::uuid as ingredient_id,
    null::text as ingredient_name,
    null::text as unit,
    sme.location,
    sme.quantity,
    sme.value,
    sme.estimated_value,
    sme.note,
    sme.staff_id,
    u.name as staff_name
  from public.staff_meal_entries sme
  join public.items i on i.id = sme.item_id
  join public.users u on u.id = sme.staff_id
  where sme.meal_date >= p_from
    and sme.meal_date <= p_to
    and (p_location is null or sme.location = p_location)

  union all

  select
    'complimentary_meal'::text as category,
    cme.meal_date as entry_date,
    cme.item_id,
    i.name as item_name,
    null::uuid as ingredient_id,
    null::text as ingredient_name,
    null::text as unit,
    cme.location,
    cme.quantity,
    cme.value,
    cme.estimated_value,
    cme.note,
    cme.staff_id,
    u.name as staff_name
  from public.complimentary_meal_entries cme
  join public.items i on i.id = cme.item_id
  join public.users u on u.id = cme.staff_id
  where cme.meal_date >= p_from
    and cme.meal_date <= p_to
    and (p_location is null or cme.location = p_location)

  union all

  select
    'stock_adjustment'::text as category,
    sae.meal_date as entry_date,
    sae.item_id,
    i.name as item_name,
    null::uuid as ingredient_id,
    null::text as ingredient_name,
    null::text as unit,
    sae.location,
    sae.quantity,
    sae.value,
    sae.estimated_value,
    sae.note,
    sae.staff_id,
    u.name as staff_name
  from public.stock_adjustment_entries sae
  join public.items i on i.id = sae.item_id
  join public.users u on u.id = sae.staff_id
  where sae.meal_date >= p_from
    and sae.meal_date <= p_to
    and (p_location is null or sae.location = p_location)

  order by entry_date desc;
$$;
