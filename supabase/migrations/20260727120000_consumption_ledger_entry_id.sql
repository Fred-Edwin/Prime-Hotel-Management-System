-- ============================================================
-- Add entry_id to dashboard_stock_consumption_ledger()'s return shape
-- (client feedback, 2026-07-27: "add delete options at Item Ledger").
--
-- The Non-Sales Stock Consumption table on /dashboard/ledger is read
-- entirely from this function, which previously returned no row id at
-- all -- fine for a read-only display, but the new per-row Delete
-- action (20260727090000_consumption_entry_delete.sql's
-- delete_staff_meal_entry()/delete_complimentary_meal_entry()/
-- delete_stock_adjustment_entry(), each keyed by the claim row's own
-- id) needs one to target. Named entry_id, not id, to avoid any
-- confusion with item_id/ingredient_id already on this row.
--
-- CORRECTED (same day): the first version of this migration was based
-- on an intermediate, superseded shape of this function
-- (20260723160000_consumption_ledger_estimated_value.sql, which added
-- both `estimated_value` and `wastage_estimated_value`) rather than its
-- actual final, current shape — both of those columns were dropped
-- again the same day by 20260723180000_unconditional_estimated_value.sql
-- once §3.11 settled on an unconditional cost-ratio formula that no
-- longer needed a second value column at all. Running the first version
-- of this migration failed with `42703: column se.wastage_estimated_value
-- does not exist`, confirming the drift. This corrected version is based
-- on 20260723180000's function body (the real current definition) with
-- only `entry_id` added on top — no other column added, removed, or
-- reordered.
--
-- NULL for both wastage branches (category = 'wastage') -- wastage
-- isn't a separate claim row at all, it's a stock_entries/
-- ingredient_entries COLUMN (§3.3), so there is no row to delete here;
-- "removing" wastage means editing that value back to 0 via the
-- existing admin ledger-edit path, not a delete. LedgerClient.tsx's new
-- delete affordance is disabled for wastage rows for exactly this
-- reason -- entry_id being null is what it checks.
--
-- Same drop-then-recreate requirement as every prior return-shape
-- change to this function (20260723160000_consumption_ledger_estimated_value.sql's
-- own comment explains why).
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
  note text,
  staff_id uuid,
  staff_name text,
  entry_id uuid
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
    se.wastage_note as note,
    null::uuid as staff_id,
    null::text as staff_name,
    null::uuid as entry_id
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
    ie.wastage_note as note,
    null::uuid as staff_id,
    null::text as staff_name,
    null::uuid as entry_id
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
    sme.note,
    sme.staff_id,
    u.name as staff_name,
    sme.id as entry_id
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
    cme.note,
    cme.staff_id,
    u.name as staff_name,
    cme.id as entry_id
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
    sae.note,
    sae.staff_id,
    u.name as staff_name,
    sae.id as entry_id
  from public.stock_adjustment_entries sae
  join public.items i on i.id = sae.item_id
  join public.users u on u.id = sae.staff_id
  where sae.meal_date >= p_from
    and sae.meal_date <= p_to
    and (p_location is null or sae.location = p_location)

  order by entry_date desc;
$$;
