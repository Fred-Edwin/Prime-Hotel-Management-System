-- ============================================================
-- Simplify "estimated value" to a flat, UNCONDITIONAL rule (client
-- correction, 2026-07-23, mid-session, superseding the dual-value model
-- from 20260723110000 through 20260723170000 the same day):
--
--   value = quantity * selling_price_snapshot * estimated_cost_ratio()
--
-- for ALL wastage/staff-meal/complimentary-meal/stock-adjustment entries,
-- regardless of buying_price. No more "only when buying_price is 0"
-- branching -- the client explicitly rejected the assumption that only
-- zero-buying-price items need an estimate: "I dont want to assume she
-- zeroed them all. Can we have it as this. All non sales stock values are
-- computed by multiplying with 60% of the selling price - simple."
--
-- Still snapshotted at write time (same discipline as every other price
-- in this schema) -- a later ratio change must not retroactively alter a
-- past day's reported figures.
--
-- buying_price_snapshot, cost_value, closing_stock_value, COGS
-- (periodicCogs()), and net profit (netProfit()) are NOT touched by this
-- at all -- they keep using the real buying price exactly as before. This
-- migration is scoped ONLY to the four non-sales-consumption value
-- columns: stock_entries.wastage_value, staff_meal_entries.value,
-- complimentary_meal_entries.value, stock_adjustment_entries.value.
--
-- The now-redundant parallel *_estimated_value columns/output columns
-- (two numbers that would now always be equal) are dropped, not kept
-- alongside a duplicate. app_settings/estimated_cost_ratio itself is
-- unchanged -- still the one admin-editable setting, still read via
-- public.estimated_cost_ratio().
--
-- public.effective_unit_cost() is dropped -- there's no longer a
-- "use buying price if present, else fall back" branch, so every call
-- site becomes a direct selling_price * estimated_cost_ratio().
--
-- See docs/01_DATA_MODEL.md §3.11 for the full rewrite.
-- ============================================================

-- ----------------------------------------------------------------
-- 0. Drop the now-unconditional-formula helper. Nothing else in the
--    schema references it after this migration.
-- ----------------------------------------------------------------
drop function if exists public.effective_unit_cost(numeric, numeric);

-- ----------------------------------------------------------------
-- 1. save_stock_entry() -- restaurant batch save
-- ----------------------------------------------------------------
create or replace function public.save_stock_entry(
  p_item_id uuid,
  p_location location_type,
  p_entry_date date,
  p_till_quantity_sold numeric,
  p_selling_price_snapshot numeric,
  p_buying_price_snapshot numeric,
  p_created_by uuid,
  p_added_stock numeric default null,
  p_sent_out numeric default null,
  p_wastage numeric default null,
  p_wastage_note text default null
)
returns public.stock_entries
language plpgsql
security invoker
as $$
declare
  v_opening_stock numeric(10,2);
  v_total_stock numeric(10,2);
  v_order_total numeric(10,2);
  v_quantity_sold numeric(10,2);
  v_added_stock numeric(10,2);
  v_sent_out numeric(10,2);
  v_wastage numeric(10,2);
  v_wastage_note text;
  v_staff_meals numeric(10,2);
  v_complimentary_meals numeric(10,2);
  v_stock_adjustments numeric(10,2);
  v_existing public.stock_entries;
  v_row public.stock_entries;
begin
  perform public.lock_stock_entry_row(p_item_id, p_location, p_entry_date);

  select * into v_existing
  from public.stock_entries
  where item_id = p_item_id
    and location = p_location
    and entry_date = p_entry_date;

  select closing_stock into v_opening_stock
  from public.stock_entries
  where item_id = p_item_id
    and location = p_location
    and entry_date < p_entry_date
  order by entry_date desc
  limit 1;

  v_opening_stock := coalesce(v_opening_stock, 0);

  v_added_stock := coalesce(p_added_stock, v_existing.added_stock, 0);
  v_sent_out := coalesce(p_sent_out, v_existing.sent_out, 0);

  if p_wastage is null then
    v_wastage := coalesce(v_existing.wastage, 0);
    v_wastage_note := v_existing.wastage_note;
  else
    v_wastage := p_wastage;
    v_wastage_note := p_wastage_note;
  end if;

  v_total_stock := v_opening_stock + v_added_stock;

  select coalesce(sum(oi.quantity), 0) into v_order_total
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.item_id = p_item_id
    and o.location = p_location
    and o.order_date = p_entry_date;

  v_quantity_sold := p_till_quantity_sold + v_order_total;

  v_staff_meals := public.staff_meals_total(p_item_id, p_location, p_entry_date, p_entry_date);
  v_complimentary_meals := public.complimentary_meals_total(p_item_id, p_location, p_entry_date, p_entry_date);
  v_stock_adjustments := public.stock_adjustments_total(p_item_id, p_location, p_entry_date, p_entry_date);

  if v_sent_out + v_quantity_sold + v_wastage + v_staff_meals + v_complimentary_meals + v_stock_adjustments > v_total_stock then
    raise exception 'oversell: only % available for this item', v_total_stock
      using errcode = 'P0001';
  end if;

  insert into public.stock_entries (
    item_id, location, entry_date,
    opening_stock, added_stock, sent_out,
    till_quantity_sold, quantity_sold, wastage, wastage_note,
    selling_price_snapshot, buying_price_snapshot,
    closing_stock, sales_value, cost_value, closing_stock_value, wastage_value,
    created_by
  )
  values (
    p_item_id, p_location, p_entry_date,
    v_opening_stock, v_added_stock, v_sent_out,
    p_till_quantity_sold, v_quantity_sold, v_wastage, v_wastage_note,
    p_selling_price_snapshot, p_buying_price_snapshot,
    v_total_stock - v_sent_out - v_quantity_sold - v_wastage - v_staff_meals - v_complimentary_meals - v_stock_adjustments,
    v_quantity_sold * p_selling_price_snapshot,
    v_quantity_sold * p_buying_price_snapshot,
    (v_total_stock - v_sent_out - v_quantity_sold - v_wastage - v_staff_meals - v_complimentary_meals - v_stock_adjustments) * p_buying_price_snapshot,
    v_wastage * p_selling_price_snapshot * public.estimated_cost_ratio(),
    p_created_by
  )
  on conflict (item_id, location, entry_date) do update set
    added_stock = excluded.added_stock,
    sent_out = excluded.sent_out,
    till_quantity_sold = excluded.till_quantity_sold,
    quantity_sold = excluded.quantity_sold,
    wastage = excluded.wastage,
    wastage_note = excluded.wastage_note,
    selling_price_snapshot = excluded.selling_price_snapshot,
    buying_price_snapshot = excluded.buying_price_snapshot,
    closing_stock = excluded.closing_stock,
    sales_value = excluded.sales_value,
    cost_value = excluded.cost_value,
    closing_stock_value = excluded.closing_stock_value,
    wastage_value = excluded.wastage_value
  returning * into v_row;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------
-- 2. save_canteen_stock_entry() -- canteen batch/legacy save (daily cadence)
-- ----------------------------------------------------------------
create or replace function public.save_canteen_stock_entry(
  p_item_id uuid,
  p_entry_date date,
  p_is_canteen_supplied boolean,
  p_added_stock_input numeric,
  p_till_quantity_sold numeric,
  p_selling_price_snapshot numeric,
  p_buying_price_snapshot numeric,
  p_created_by uuid,
  p_wastage numeric default null,
  p_wastage_note text default null
)
returns public.stock_entries
language plpgsql
security invoker
as $$
declare
  v_period_end date := p_entry_date;
  v_opening_stock numeric(10,2);
  v_added_stock numeric(10,2);
  v_total_stock numeric(10,2);
  v_order_total numeric(10,2);
  v_quantity_sold numeric(10,2);
  v_wastage numeric(10,2);
  v_wastage_note text;
  v_staff_meals numeric(10,2);
  v_complimentary_meals numeric(10,2);
  v_stock_adjustments numeric(10,2);
  v_existing_wastage numeric(10,2);
  v_existing_wastage_note text;
  v_row public.stock_entries;
begin
  perform public.lock_stock_entry_row(p_item_id, 'canteen', p_entry_date);

  select wastage, wastage_note into v_existing_wastage, v_existing_wastage_note
  from public.stock_entries
  where item_id = p_item_id
    and location = 'canteen'
    and entry_date = p_entry_date;

  select closing_stock into v_opening_stock
  from public.stock_entries
  where item_id = p_item_id
    and location = 'canteen'
    and entry_date < p_entry_date
  order by entry_date desc
  limit 1;

  v_opening_stock := coalesce(v_opening_stock, 0);

  if p_is_canteen_supplied then
    v_added_stock := public.canteen_supplied_total(p_item_id, p_entry_date, v_period_end);
  else
    v_added_stock := p_added_stock_input;
  end if;

  v_total_stock := v_opening_stock + v_added_stock;

  if p_wastage is null then
    v_wastage := coalesce(v_existing_wastage, 0);
    v_wastage_note := v_existing_wastage_note;
  else
    v_wastage := p_wastage;
    v_wastage_note := p_wastage_note;
  end if;

  select coalesce(sum(oi.quantity), 0) into v_order_total
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.item_id = p_item_id
    and o.location = 'canteen'
    and o.order_date >= p_entry_date
    and o.order_date <= v_period_end;

  v_quantity_sold := p_till_quantity_sold + v_order_total;

  v_staff_meals := public.staff_meals_total(p_item_id, 'canteen', p_entry_date, v_period_end);
  v_complimentary_meals := public.complimentary_meals_total(p_item_id, 'canteen', p_entry_date, v_period_end);
  v_stock_adjustments := public.stock_adjustments_total(p_item_id, 'canteen', p_entry_date, v_period_end);

  if v_quantity_sold + v_wastage + v_staff_meals + v_complimentary_meals + v_stock_adjustments > v_total_stock then
    raise exception 'oversell: only % available for this item', v_total_stock
      using errcode = 'P0001';
  end if;

  insert into public.stock_entries (
    item_id, location, entry_date,
    opening_stock, added_stock, sent_out,
    till_quantity_sold, quantity_sold, wastage, wastage_note,
    selling_price_snapshot, buying_price_snapshot,
    closing_stock, sales_value, cost_value, closing_stock_value, wastage_value,
    created_by
  )
  values (
    p_item_id, 'canteen', p_entry_date,
    v_opening_stock, v_added_stock, 0,
    p_till_quantity_sold, v_quantity_sold, v_wastage, v_wastage_note,
    p_selling_price_snapshot, p_buying_price_snapshot,
    v_total_stock - v_quantity_sold - v_wastage - v_staff_meals - v_complimentary_meals - v_stock_adjustments,
    v_quantity_sold * p_selling_price_snapshot,
    v_quantity_sold * p_buying_price_snapshot,
    (v_total_stock - v_quantity_sold - v_wastage - v_staff_meals - v_complimentary_meals - v_stock_adjustments) * p_buying_price_snapshot,
    v_wastage * p_selling_price_snapshot * public.estimated_cost_ratio(),
    p_created_by
  )
  on conflict (item_id, location, entry_date) do update set
    added_stock = excluded.added_stock,
    till_quantity_sold = excluded.till_quantity_sold,
    quantity_sold = excluded.quantity_sold,
    wastage = excluded.wastage,
    wastage_note = excluded.wastage_note,
    selling_price_snapshot = excluded.selling_price_snapshot,
    buying_price_snapshot = excluded.buying_price_snapshot,
    closing_stock = excluded.closing_stock,
    sales_value = excluded.sales_value,
    cost_value = excluded.cost_value,
    closing_stock_value = excluded.closing_stock_value,
    wastage_value = excluded.wastage_value
  returning * into v_row;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------
-- 3. apply_order_to_stock_entry() -- orders write-path (§3.4, daily cadence)
--    Never writes wastage, so v_wastage is always the row's preserved
--    value -- still needs wastage_value recomputed on every call, same as
--    before, since a price snapshot can change here.
-- ----------------------------------------------------------------
create or replace function public.apply_order_to_stock_entry(
  p_item_id uuid,
  p_location location_type,
  p_order_date date,
  p_selling_price_snapshot numeric,
  p_buying_price_snapshot numeric,
  p_created_by uuid
)
returns public.stock_entries
language plpgsql
security invoker
as $$
declare
  v_entry_date date := p_order_date;
  v_period_end date := p_order_date;
  v_is_canteen_supplied boolean := false;
  v_existing public.stock_entries;
  v_opening_stock numeric(10,2);
  v_till_quantity_sold numeric(10,2);
  v_added_stock numeric(10,2);
  v_sent_out numeric(10,2);
  v_wastage numeric(10,2);
  v_wastage_note text;
  v_staff_meals numeric(10,2);
  v_complimentary_meals numeric(10,2);
  v_stock_adjustments numeric(10,2);
  v_total_stock numeric(10,2);
  v_order_total numeric(10,2);
  v_quantity_sold numeric(10,2);
  v_row public.stock_entries;
begin
  if p_location = 'canteen' then
    select supply_type = 'canteen_supplied' into v_is_canteen_supplied
    from public.items where id = p_item_id;
  end if;

  perform public.lock_stock_entry_row(p_item_id, p_location, v_entry_date);

  select * into v_existing
  from public.stock_entries
  where item_id = p_item_id
    and location = p_location
    and entry_date = v_entry_date;

  if found then
    v_opening_stock := v_existing.opening_stock;
    v_till_quantity_sold := v_existing.till_quantity_sold;
    v_added_stock := v_existing.added_stock;
    v_sent_out := v_existing.sent_out;
    v_wastage := v_existing.wastage;
    v_wastage_note := v_existing.wastage_note;
  else
    select closing_stock into v_opening_stock
    from public.stock_entries
    where item_id = p_item_id
      and location = p_location
      and entry_date < v_entry_date
    order by entry_date desc
    limit 1;

    v_opening_stock := coalesce(v_opening_stock, 0);
    v_till_quantity_sold := 0;
    v_added_stock := 0;
    v_sent_out := 0;
    v_wastage := 0;
    v_wastage_note := null;
  end if;

  if v_is_canteen_supplied then
    v_added_stock := public.canteen_supplied_total(p_item_id, v_entry_date, v_period_end);
  end if;

  v_total_stock := v_opening_stock + v_added_stock;

  select coalesce(sum(oi.quantity), 0) into v_order_total
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.item_id = p_item_id
    and o.location = p_location
    and o.order_date >= v_entry_date
    and o.order_date <= v_period_end;

  v_quantity_sold := v_till_quantity_sold + v_order_total;

  v_staff_meals := public.staff_meals_total(p_item_id, p_location, v_entry_date, v_period_end);
  v_complimentary_meals := public.complimentary_meals_total(p_item_id, p_location, v_entry_date, v_period_end);
  v_stock_adjustments := public.stock_adjustments_total(p_item_id, p_location, v_entry_date, v_period_end);

  if v_sent_out + v_quantity_sold + v_wastage + v_staff_meals + v_complimentary_meals + v_stock_adjustments > v_total_stock then
    raise exception 'oversell: only % available for this item', v_total_stock
      using errcode = 'P0001';
  end if;

  insert into public.stock_entries (
    item_id, location, entry_date,
    opening_stock, added_stock, sent_out,
    till_quantity_sold, quantity_sold, wastage, wastage_note,
    selling_price_snapshot, buying_price_snapshot,
    closing_stock, sales_value, cost_value, closing_stock_value, wastage_value,
    created_by
  )
  values (
    p_item_id, p_location, v_entry_date,
    v_opening_stock, v_added_stock, v_sent_out,
    v_till_quantity_sold, v_quantity_sold, v_wastage, v_wastage_note,
    p_selling_price_snapshot, p_buying_price_snapshot,
    v_total_stock - v_sent_out - v_quantity_sold - v_wastage - v_staff_meals - v_complimentary_meals - v_stock_adjustments,
    v_quantity_sold * p_selling_price_snapshot,
    v_quantity_sold * p_buying_price_snapshot,
    (v_total_stock - v_sent_out - v_quantity_sold - v_wastage - v_staff_meals - v_complimentary_meals - v_stock_adjustments) * p_buying_price_snapshot,
    v_wastage * p_selling_price_snapshot * public.estimated_cost_ratio(),
    p_created_by
  )
  on conflict (item_id, location, entry_date) do update set
    added_stock = excluded.added_stock,
    quantity_sold = excluded.quantity_sold,
    closing_stock = excluded.closing_stock,
    sales_value = excluded.sales_value,
    cost_value = excluded.cost_value,
    closing_stock_value = excluded.closing_stock_value,
    wastage_value = excluded.wastage_value
  returning * into v_row;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------
-- 4. save_stock_entry_store_manager_fields() -- restaurant store-manager
--    autosave (added_stock/sent_out only)
-- ----------------------------------------------------------------
create or replace function public.save_stock_entry_store_manager_fields(
  p_item_id uuid,
  p_location location_type,
  p_entry_date date,
  p_added_stock numeric,
  p_sent_out numeric,
  p_selling_price_snapshot numeric,
  p_buying_price_snapshot numeric,
  p_created_by uuid
)
returns public.stock_entries
language plpgsql
security invoker
as $$
declare
  v_existing public.stock_entries;
  v_opening_stock numeric(10,2);
  v_till_quantity_sold numeric(10,2);
  v_wastage numeric(10,2);
  v_wastage_note text;
  v_staff_meals numeric(10,2);
  v_complimentary_meals numeric(10,2);
  v_stock_adjustments numeric(10,2);
  v_total_stock numeric(10,2);
  v_order_total numeric(10,2);
  v_quantity_sold numeric(10,2);
  v_row public.stock_entries;
begin
  perform public.lock_stock_entry_row(p_item_id, p_location, p_entry_date);

  select * into v_existing
  from public.stock_entries
  where item_id = p_item_id
    and location = p_location
    and entry_date = p_entry_date;

  if found then
    v_opening_stock := v_existing.opening_stock;
    v_till_quantity_sold := v_existing.till_quantity_sold;
    v_wastage := v_existing.wastage;
    v_wastage_note := v_existing.wastage_note;
  else
    select closing_stock into v_opening_stock
    from public.stock_entries
    where item_id = p_item_id
      and location = p_location
      and entry_date < p_entry_date
    order by entry_date desc
    limit 1;

    v_opening_stock := coalesce(v_opening_stock, 0);
    v_till_quantity_sold := 0;
    v_wastage := 0;
    v_wastage_note := null;
  end if;

  v_total_stock := v_opening_stock + p_added_stock;

  select coalesce(sum(oi.quantity), 0) into v_order_total
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.item_id = p_item_id
    and o.location = p_location
    and o.order_date = p_entry_date;

  v_quantity_sold := v_till_quantity_sold + v_order_total;

  v_staff_meals := public.staff_meals_total(p_item_id, p_location, p_entry_date, p_entry_date);
  v_complimentary_meals := public.complimentary_meals_total(p_item_id, p_location, p_entry_date, p_entry_date);
  v_stock_adjustments := public.stock_adjustments_total(p_item_id, p_location, p_entry_date, p_entry_date);

  if p_sent_out + v_quantity_sold + v_wastage + v_staff_meals + v_complimentary_meals + v_stock_adjustments > v_total_stock then
    raise exception 'oversell: only % available for this item', v_total_stock
      using errcode = 'P0001';
  end if;

  insert into public.stock_entries (
    item_id, location, entry_date,
    opening_stock, added_stock, sent_out,
    till_quantity_sold, quantity_sold, wastage, wastage_note,
    selling_price_snapshot, buying_price_snapshot,
    closing_stock, sales_value, cost_value, closing_stock_value, wastage_value,
    created_by
  )
  values (
    p_item_id, p_location, p_entry_date,
    v_opening_stock, p_added_stock, p_sent_out,
    v_till_quantity_sold, v_quantity_sold, v_wastage, v_wastage_note,
    p_selling_price_snapshot, p_buying_price_snapshot,
    v_total_stock - p_sent_out - v_quantity_sold - v_wastage - v_staff_meals - v_complimentary_meals - v_stock_adjustments,
    v_quantity_sold * p_selling_price_snapshot,
    v_quantity_sold * p_buying_price_snapshot,
    (v_total_stock - p_sent_out - v_quantity_sold - v_wastage - v_staff_meals - v_complimentary_meals - v_stock_adjustments) * p_buying_price_snapshot,
    v_wastage * p_selling_price_snapshot * public.estimated_cost_ratio(),
    p_created_by
  )
  on conflict (item_id, location, entry_date) do update set
    added_stock = excluded.added_stock,
    sent_out = excluded.sent_out,
    quantity_sold = excluded.quantity_sold,
    closing_stock = excluded.closing_stock,
    sales_value = excluded.sales_value,
    cost_value = excluded.cost_value,
    closing_stock_value = excluded.closing_stock_value,
    wastage_value = excluded.wastage_value
  returning * into v_row;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------
-- 5. save_stock_entry_cashier_field() -- restaurant cashier autosave
--    (till_quantity_sold only)
-- ----------------------------------------------------------------
create or replace function public.save_stock_entry_cashier_field(
  p_item_id uuid,
  p_location location_type,
  p_entry_date date,
  p_till_quantity_sold numeric,
  p_selling_price_snapshot numeric,
  p_buying_price_snapshot numeric,
  p_created_by uuid
)
returns public.stock_entries
language plpgsql
security invoker
as $$
declare
  v_existing public.stock_entries;
  v_opening_stock numeric(10,2);
  v_added_stock numeric(10,2);
  v_sent_out numeric(10,2);
  v_wastage numeric(10,2);
  v_wastage_note text;
  v_staff_meals numeric(10,2);
  v_complimentary_meals numeric(10,2);
  v_stock_adjustments numeric(10,2);
  v_total_stock numeric(10,2);
  v_order_total numeric(10,2);
  v_quantity_sold numeric(10,2);
  v_row public.stock_entries;
begin
  perform public.lock_stock_entry_row(p_item_id, p_location, p_entry_date);

  select * into v_existing
  from public.stock_entries
  where item_id = p_item_id
    and location = p_location
    and entry_date = p_entry_date;

  if found then
    v_opening_stock := v_existing.opening_stock;
    v_added_stock := v_existing.added_stock;
    v_sent_out := v_existing.sent_out;
    v_wastage := v_existing.wastage;
    v_wastage_note := v_existing.wastage_note;
  else
    select closing_stock into v_opening_stock
    from public.stock_entries
    where item_id = p_item_id
      and location = p_location
      and entry_date < p_entry_date
    order by entry_date desc
    limit 1;

    v_opening_stock := coalesce(v_opening_stock, 0);
    v_added_stock := 0;
    v_sent_out := 0;
    v_wastage := 0;
    v_wastage_note := null;
  end if;

  v_total_stock := v_opening_stock + v_added_stock;

  select coalesce(sum(oi.quantity), 0) into v_order_total
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.item_id = p_item_id
    and o.location = p_location
    and o.order_date = p_entry_date;

  v_quantity_sold := p_till_quantity_sold + v_order_total;

  v_staff_meals := public.staff_meals_total(p_item_id, p_location, p_entry_date, p_entry_date);
  v_complimentary_meals := public.complimentary_meals_total(p_item_id, p_location, p_entry_date, p_entry_date);
  v_stock_adjustments := public.stock_adjustments_total(p_item_id, p_location, p_entry_date, p_entry_date);

  if v_sent_out + v_quantity_sold + v_wastage + v_staff_meals + v_complimentary_meals + v_stock_adjustments > v_total_stock then
    if v_added_stock = 0 then
      raise exception 'not_yet_stocked: today''s added stock has not been logged yet for this item'
        using errcode = 'P0002';
    end if;
    raise exception 'oversell: only % available for this item', v_total_stock
      using errcode = 'P0001';
  end if;

  insert into public.stock_entries (
    item_id, location, entry_date,
    opening_stock, added_stock, sent_out,
    till_quantity_sold, quantity_sold, wastage, wastage_note,
    selling_price_snapshot, buying_price_snapshot,
    closing_stock, sales_value, cost_value, closing_stock_value, wastage_value,
    created_by
  )
  values (
    p_item_id, p_location, p_entry_date,
    v_opening_stock, v_added_stock, v_sent_out,
    p_till_quantity_sold, v_quantity_sold, v_wastage, v_wastage_note,
    p_selling_price_snapshot, p_buying_price_snapshot,
    v_total_stock - v_sent_out - v_quantity_sold - v_wastage - v_staff_meals - v_complimentary_meals - v_stock_adjustments,
    v_quantity_sold * p_selling_price_snapshot,
    v_quantity_sold * p_buying_price_snapshot,
    (v_total_stock - v_sent_out - v_quantity_sold - v_wastage - v_staff_meals - v_complimentary_meals - v_stock_adjustments) * p_buying_price_snapshot,
    v_wastage * p_selling_price_snapshot * public.estimated_cost_ratio(),
    p_created_by
  )
  on conflict (item_id, location, entry_date) do update set
    till_quantity_sold = excluded.till_quantity_sold,
    quantity_sold = excluded.quantity_sold,
    selling_price_snapshot = excluded.selling_price_snapshot,
    buying_price_snapshot = excluded.buying_price_snapshot,
    closing_stock = excluded.closing_stock,
    sales_value = excluded.sales_value,
    cost_value = excluded.cost_value,
    closing_stock_value = excluded.closing_stock_value,
    wastage_value = excluded.wastage_value
  returning * into v_row;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------
-- 6. save_stock_entry_canteen_field() -- canteen autosave (both fields,
--    daily cadence)
-- ----------------------------------------------------------------
create or replace function public.save_stock_entry_canteen_field(
  p_item_id uuid,
  p_entry_date date,
  p_is_canteen_supplied boolean,
  p_till_quantity_sold numeric default null,
  p_added_stock_input numeric default null,
  p_selling_price_snapshot numeric default null,
  p_buying_price_snapshot numeric default null,
  p_created_by uuid default null
)
returns public.stock_entries
language plpgsql
security invoker
as $$
declare
  v_period_end date := p_entry_date;
  v_existing public.stock_entries;
  v_opening_stock numeric(10,2);
  v_added_stock numeric(10,2);
  v_till_quantity_sold numeric(10,2);
  v_wastage numeric(10,2);
  v_wastage_note text;
  v_staff_meals numeric(10,2);
  v_complimentary_meals numeric(10,2);
  v_stock_adjustments numeric(10,2);
  v_selling_price numeric(10,2);
  v_buying_price numeric(10,2);
  v_total_stock numeric(10,2);
  v_order_total numeric(10,2);
  v_quantity_sold numeric(10,2);
  v_row public.stock_entries;
begin
  perform public.lock_stock_entry_row(p_item_id, 'canteen', p_entry_date);

  select * into v_existing
  from public.stock_entries
  where item_id = p_item_id
    and location = 'canteen'
    and entry_date = p_entry_date;

  if found then
    v_opening_stock := v_existing.opening_stock;
    v_till_quantity_sold := coalesce(p_till_quantity_sold, v_existing.till_quantity_sold);
    v_wastage := v_existing.wastage;
    v_wastage_note := v_existing.wastage_note;
    v_selling_price := coalesce(p_selling_price_snapshot, v_existing.selling_price_snapshot);
    v_buying_price := coalesce(p_buying_price_snapshot, v_existing.buying_price_snapshot);
  else
    select closing_stock into v_opening_stock
    from public.stock_entries
    where item_id = p_item_id
      and location = 'canteen'
      and entry_date < p_entry_date
    order by entry_date desc
    limit 1;

    v_opening_stock := coalesce(v_opening_stock, 0);
    v_till_quantity_sold := coalesce(p_till_quantity_sold, 0);
    v_wastage := 0;
    v_wastage_note := null;
    v_selling_price := p_selling_price_snapshot;
    v_buying_price := p_buying_price_snapshot;
  end if;

  if p_is_canteen_supplied then
    v_added_stock := public.canteen_supplied_total(p_item_id, p_entry_date, v_period_end);
  elsif found then
    v_added_stock := coalesce(p_added_stock_input, v_existing.added_stock);
  else
    v_added_stock := coalesce(p_added_stock_input, 0);
  end if;

  v_total_stock := v_opening_stock + v_added_stock;

  select coalesce(sum(oi.quantity), 0) into v_order_total
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.item_id = p_item_id
    and o.location = 'canteen'
    and o.order_date >= p_entry_date
    and o.order_date <= v_period_end;

  v_quantity_sold := v_till_quantity_sold + v_order_total;

  v_staff_meals := public.staff_meals_total(p_item_id, 'canteen', p_entry_date, v_period_end);
  v_complimentary_meals := public.complimentary_meals_total(p_item_id, 'canteen', p_entry_date, v_period_end);
  v_stock_adjustments := public.stock_adjustments_total(p_item_id, 'canteen', p_entry_date, v_period_end);

  if v_quantity_sold + v_wastage + v_staff_meals + v_complimentary_meals + v_stock_adjustments > v_total_stock then
    if p_is_canteen_supplied and v_added_stock = 0 then
      raise exception 'not_yet_supplied: the restaurant has not sent today''s supply yet for this item'
        using errcode = 'P0003';
    end if;
    raise exception 'oversell: only % available for this item', v_total_stock
      using errcode = 'P0001';
  end if;

  insert into public.stock_entries (
    item_id, location, entry_date,
    opening_stock, added_stock, sent_out,
    till_quantity_sold, quantity_sold, wastage, wastage_note,
    selling_price_snapshot, buying_price_snapshot,
    closing_stock, sales_value, cost_value, closing_stock_value, wastage_value,
    created_by
  )
  values (
    p_item_id, 'canteen', p_entry_date,
    v_opening_stock, v_added_stock, 0,
    v_till_quantity_sold, v_quantity_sold, v_wastage, v_wastage_note,
    v_selling_price, v_buying_price,
    v_total_stock - v_quantity_sold - v_wastage - v_staff_meals - v_complimentary_meals - v_stock_adjustments,
    v_quantity_sold * v_selling_price,
    v_quantity_sold * v_buying_price,
    (v_total_stock - v_quantity_sold - v_wastage - v_staff_meals - v_complimentary_meals - v_stock_adjustments) * v_buying_price,
    v_wastage * v_selling_price * public.estimated_cost_ratio(),
    p_created_by
  )
  on conflict (item_id, location, entry_date) do update set
    added_stock = excluded.added_stock,
    till_quantity_sold = excluded.till_quantity_sold,
    quantity_sold = excluded.quantity_sold,
    selling_price_snapshot = excluded.selling_price_snapshot,
    buying_price_snapshot = excluded.buying_price_snapshot,
    closing_stock = excluded.closing_stock,
    sales_value = excluded.sales_value,
    cost_value = excluded.cost_value,
    closing_stock_value = excluded.closing_stock_value,
    wastage_value = excluded.wastage_value
  returning * into v_row;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------
-- 7. create_staff_meal_entry()
-- ----------------------------------------------------------------
create or replace function public.create_staff_meal_entry(
  p_item_id uuid,
  p_location location_type,
  p_meal_date date,
  p_quantity numeric,
  p_staff_id uuid,
  p_created_by uuid,
  p_note text default null
)
returns public.staff_meal_entries
language plpgsql
security invoker
as $$
declare
  v_entry_date date;
  v_period_end date;
  v_is_canteen_supplied boolean;
  v_buying_price numeric(10,2);
  v_selling_price numeric(10,2);
  v_existing public.stock_entries;
  v_opening_stock numeric(10,2);
  v_till_quantity_sold numeric(10,2);
  v_added_stock numeric(10,2);
  v_sent_out numeric(10,2);
  v_wastage numeric(10,2);
  v_wastage_note text;
  v_total_stock numeric(10,2);
  v_order_total numeric(10,2);
  v_quantity_sold numeric(10,2);
  v_staff_meals numeric(10,2);
  v_complimentary_meals numeric(10,2);
  v_stock_adjustments numeric(10,2);
  v_claim public.staff_meal_entries;
begin
  select buying_price, selling_price into v_buying_price, v_selling_price
  from public.items
  where id = p_item_id and active;

  if v_buying_price is null then
    raise exception 'unknown_item: item is not active or does not exist'
      using errcode = 'P0004';
  end if;

  if p_location = 'canteen' then
    v_entry_date := p_meal_date;
    v_period_end := p_meal_date;

    select supply_type = 'canteen_supplied' into v_is_canteen_supplied
    from public.items where id = p_item_id;
  else
    v_entry_date := p_meal_date;
    v_period_end := p_meal_date;
    v_is_canteen_supplied := false;
  end if;

  perform public.lock_stock_entry_row(p_item_id, p_location, v_entry_date);

  select * into v_existing
  from public.stock_entries
  where item_id = p_item_id
    and location = p_location
    and entry_date = v_entry_date;

  if found then
    v_opening_stock := v_existing.opening_stock;
    v_till_quantity_sold := v_existing.till_quantity_sold;
    v_added_stock := v_existing.added_stock;
    v_sent_out := v_existing.sent_out;
    v_wastage := v_existing.wastage;
    v_wastage_note := v_existing.wastage_note;
  else
    select closing_stock into v_opening_stock
    from public.stock_entries
    where item_id = p_item_id
      and location = p_location
      and entry_date < v_entry_date
    order by entry_date desc
    limit 1;

    v_opening_stock := coalesce(v_opening_stock, 0);
    v_till_quantity_sold := 0;
    v_added_stock := 0;
    v_sent_out := 0;
    v_wastage := 0;
    v_wastage_note := null;
  end if;

  if v_is_canteen_supplied then
    v_added_stock := public.canteen_supplied_total(p_item_id, v_entry_date, v_period_end);
  end if;

  v_total_stock := v_opening_stock + v_added_stock;

  select coalesce(sum(oi.quantity), 0) into v_order_total
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.item_id = p_item_id
    and o.location = p_location
    and o.order_date >= v_entry_date
    and o.order_date <= v_period_end;

  v_quantity_sold := v_till_quantity_sold + v_order_total;

  v_complimentary_meals := public.complimentary_meals_total(p_item_id, p_location, v_entry_date, v_period_end);
  v_stock_adjustments := public.stock_adjustments_total(p_item_id, p_location, v_entry_date, v_period_end);

  select public.staff_meals_total(p_item_id, p_location, v_entry_date, v_period_end) + p_quantity
    into v_staff_meals;

  if v_sent_out + v_quantity_sold + v_wastage + v_staff_meals + v_complimentary_meals + v_stock_adjustments > v_total_stock then
    raise exception 'oversell: only % available for this item', v_total_stock
      using errcode = 'P0001';
  end if;

  insert into public.staff_meal_entries (
    item_id, location, meal_date, quantity,
    buying_price_snapshot, value, note, staff_id, created_by
  )
  values (
    p_item_id, p_location, p_meal_date, p_quantity,
    v_buying_price, p_quantity * v_selling_price * public.estimated_cost_ratio(), p_note, p_staff_id, p_created_by
  )
  returning * into v_claim;

  insert into public.stock_entries (
    item_id, location, entry_date,
    opening_stock, added_stock, sent_out,
    till_quantity_sold, quantity_sold, wastage, wastage_note,
    selling_price_snapshot, buying_price_snapshot,
    closing_stock, sales_value, cost_value, closing_stock_value, wastage_value,
    created_by
  )
  values (
    p_item_id, p_location, v_entry_date,
    v_opening_stock, v_added_stock, v_sent_out,
    v_till_quantity_sold, v_quantity_sold, v_wastage, v_wastage_note,
    v_selling_price, v_buying_price,
    v_total_stock - v_sent_out - v_quantity_sold - v_wastage - v_staff_meals - v_complimentary_meals - v_stock_adjustments,
    v_quantity_sold * v_selling_price,
    v_quantity_sold * v_buying_price,
    (v_total_stock - v_sent_out - v_quantity_sold - v_wastage - v_staff_meals - v_complimentary_meals - v_stock_adjustments) * v_buying_price,
    v_wastage * v_selling_price * public.estimated_cost_ratio(),
    p_created_by
  )
  on conflict (item_id, location, entry_date) do update set
    added_stock = excluded.added_stock,
    closing_stock = excluded.closing_stock,
    closing_stock_value = excluded.closing_stock_value,
    wastage_value = excluded.wastage_value;

  return v_claim;
end;
$$;

-- ----------------------------------------------------------------
-- 8. create_complimentary_meal_entry()
-- ----------------------------------------------------------------
create or replace function public.create_complimentary_meal_entry(
  p_item_id uuid,
  p_location location_type,
  p_meal_date date,
  p_quantity numeric,
  p_note text,
  p_staff_id uuid,
  p_created_by uuid
)
returns public.complimentary_meal_entries
language plpgsql
security invoker
as $$
declare
  v_entry_date date := p_meal_date;
  v_period_end date := p_meal_date;
  v_is_canteen_supplied boolean := false;
  v_buying_price numeric(10,2);
  v_selling_price numeric(10,2);
  v_existing public.stock_entries;
  v_opening_stock numeric(10,2);
  v_till_quantity_sold numeric(10,2);
  v_added_stock numeric(10,2);
  v_sent_out numeric(10,2);
  v_wastage numeric(10,2);
  v_wastage_note text;
  v_total_stock numeric(10,2);
  v_order_total numeric(10,2);
  v_quantity_sold numeric(10,2);
  v_staff_meals numeric(10,2);
  v_complimentary_meals numeric(10,2);
  v_stock_adjustments numeric(10,2);
  v_claim public.complimentary_meal_entries;
begin
  select buying_price, selling_price into v_buying_price, v_selling_price
  from public.items
  where id = p_item_id and active;

  if v_buying_price is null then
    raise exception 'unknown_item: item is not active or does not exist'
      using errcode = 'P0004';
  end if;

  if p_location = 'canteen' then
    select supply_type = 'canteen_supplied' into v_is_canteen_supplied
    from public.items where id = p_item_id;
  end if;

  perform public.lock_stock_entry_row(p_item_id, p_location, v_entry_date);

  select * into v_existing
  from public.stock_entries
  where item_id = p_item_id
    and location = p_location
    and entry_date = v_entry_date;

  if found then
    v_opening_stock := v_existing.opening_stock;
    v_till_quantity_sold := v_existing.till_quantity_sold;
    v_added_stock := v_existing.added_stock;
    v_sent_out := v_existing.sent_out;
    v_wastage := v_existing.wastage;
    v_wastage_note := v_existing.wastage_note;
  else
    select closing_stock into v_opening_stock
    from public.stock_entries
    where item_id = p_item_id
      and location = p_location
      and entry_date < v_entry_date
    order by entry_date desc
    limit 1;

    v_opening_stock := coalesce(v_opening_stock, 0);
    v_till_quantity_sold := 0;
    v_added_stock := 0;
    v_sent_out := 0;
    v_wastage := 0;
    v_wastage_note := null;
  end if;

  if v_is_canteen_supplied then
    v_added_stock := public.canteen_supplied_total(p_item_id, v_entry_date, v_period_end);
  end if;

  v_total_stock := v_opening_stock + v_added_stock;

  select coalesce(sum(oi.quantity), 0) into v_order_total
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.item_id = p_item_id
    and o.location = p_location
    and o.order_date >= v_entry_date
    and o.order_date <= v_period_end;

  v_quantity_sold := v_till_quantity_sold + v_order_total;

  v_staff_meals := public.staff_meals_total(p_item_id, p_location, v_entry_date, v_period_end);
  v_stock_adjustments := public.stock_adjustments_total(p_item_id, p_location, v_entry_date, v_period_end);

  select public.complimentary_meals_total(p_item_id, p_location, v_entry_date, v_period_end) + p_quantity
    into v_complimentary_meals;

  if v_sent_out + v_quantity_sold + v_wastage + v_staff_meals + v_complimentary_meals + v_stock_adjustments > v_total_stock then
    raise exception 'oversell: only % available for this item', v_total_stock
      using errcode = 'P0001';
  end if;

  insert into public.complimentary_meal_entries (
    item_id, location, meal_date, quantity,
    buying_price_snapshot, value, note, staff_id, created_by
  )
  values (
    p_item_id, p_location, p_meal_date, p_quantity,
    v_buying_price, p_quantity * v_selling_price * public.estimated_cost_ratio(), p_note, p_staff_id, p_created_by
  )
  returning * into v_claim;

  insert into public.stock_entries (
    item_id, location, entry_date,
    opening_stock, added_stock, sent_out,
    till_quantity_sold, quantity_sold, wastage, wastage_note,
    selling_price_snapshot, buying_price_snapshot,
    closing_stock, sales_value, cost_value, closing_stock_value, wastage_value,
    created_by
  )
  values (
    p_item_id, p_location, v_entry_date,
    v_opening_stock, v_added_stock, v_sent_out,
    v_till_quantity_sold, v_quantity_sold, v_wastage, v_wastage_note,
    v_selling_price, v_buying_price,
    v_total_stock - v_sent_out - v_quantity_sold - v_wastage - v_staff_meals - v_complimentary_meals - v_stock_adjustments,
    v_quantity_sold * v_selling_price,
    v_quantity_sold * v_buying_price,
    (v_total_stock - v_sent_out - v_quantity_sold - v_wastage - v_staff_meals - v_complimentary_meals - v_stock_adjustments) * v_buying_price,
    v_wastage * v_selling_price * public.estimated_cost_ratio(),
    p_created_by
  )
  on conflict (item_id, location, entry_date) do update set
    added_stock = excluded.added_stock,
    closing_stock = excluded.closing_stock,
    closing_stock_value = excluded.closing_stock_value,
    wastage_value = excluded.wastage_value;

  return v_claim;
end;
$$;

-- ----------------------------------------------------------------
-- 9. create_stock_adjustment_entry() -- signed (20260722110000)
-- ----------------------------------------------------------------
create or replace function public.create_stock_adjustment_entry(
  p_item_id uuid,
  p_location location_type,
  p_meal_date date,
  p_quantity numeric,  -- signed: positive = shortfall, negative = surplus
  p_staff_id uuid,
  p_created_by uuid,
  p_note text default null
)
returns public.stock_adjustment_entries
language plpgsql
security invoker
as $$
declare
  v_entry_date date := p_meal_date;
  v_period_end date := p_meal_date;
  v_is_canteen_supplied boolean := false;
  v_buying_price numeric(10,2);
  v_selling_price numeric(10,2);
  v_existing public.stock_entries;
  v_opening_stock numeric(10,2);
  v_till_quantity_sold numeric(10,2);
  v_added_stock numeric(10,2);
  v_sent_out numeric(10,2);
  v_wastage numeric(10,2);
  v_wastage_note text;
  v_total_stock numeric(10,2);
  v_order_total numeric(10,2);
  v_quantity_sold numeric(10,2);
  v_staff_meals numeric(10,2);
  v_complimentary_meals numeric(10,2);
  v_stock_adjustments numeric(10,2);
  v_claim public.stock_adjustment_entries;
begin
  if p_quantity = 0 then
    raise exception 'invalid_quantity: adjustment quantity cannot be zero'
      using errcode = 'P0005';
  end if;

  select buying_price, selling_price into v_buying_price, v_selling_price
  from public.items
  where id = p_item_id and active;

  if v_buying_price is null then
    raise exception 'unknown_item: item is not active or does not exist'
      using errcode = 'P0004';
  end if;

  if p_location = 'canteen' then
    select supply_type = 'canteen_supplied' into v_is_canteen_supplied
    from public.items where id = p_item_id;
  end if;

  perform public.lock_stock_entry_row(p_item_id, p_location, v_entry_date);

  select * into v_existing
  from public.stock_entries
  where item_id = p_item_id
    and location = p_location
    and entry_date = v_entry_date;

  if found then
    v_opening_stock := v_existing.opening_stock;
    v_till_quantity_sold := v_existing.till_quantity_sold;
    v_added_stock := v_existing.added_stock;
    v_sent_out := v_existing.sent_out;
    v_wastage := v_existing.wastage;
    v_wastage_note := v_existing.wastage_note;
  else
    select closing_stock into v_opening_stock
    from public.stock_entries
    where item_id = p_item_id
      and location = p_location
      and entry_date < v_entry_date
    order by entry_date desc
    limit 1;

    v_opening_stock := coalesce(v_opening_stock, 0);
    v_till_quantity_sold := 0;
    v_added_stock := 0;
    v_sent_out := 0;
    v_wastage := 0;
    v_wastage_note := null;
  end if;

  if v_is_canteen_supplied then
    v_added_stock := public.canteen_supplied_total(p_item_id, v_entry_date, v_period_end);
  end if;

  v_total_stock := v_opening_stock + v_added_stock;

  select coalesce(sum(oi.quantity), 0) into v_order_total
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.item_id = p_item_id
    and o.location = p_location
    and o.order_date >= v_entry_date
    and o.order_date <= v_period_end;

  v_quantity_sold := v_till_quantity_sold + v_order_total;

  v_staff_meals := public.staff_meals_total(p_item_id, p_location, v_entry_date, v_period_end);
  v_complimentary_meals := public.complimentary_meals_total(p_item_id, p_location, v_entry_date, v_period_end);

  select public.stock_adjustments_total(p_item_id, p_location, v_entry_date, v_period_end) + p_quantity
    into v_stock_adjustments;

  if v_sent_out + v_quantity_sold + v_wastage + v_staff_meals + v_complimentary_meals + v_stock_adjustments > v_total_stock then
    raise exception 'oversell: only % available for this item', v_total_stock
      using errcode = 'P0001';
  end if;

  insert into public.stock_adjustment_entries (
    item_id, location, meal_date, quantity,
    buying_price_snapshot, value, note, staff_id, created_by
  )
  values (
    p_item_id, p_location, p_meal_date, p_quantity,
    v_buying_price, p_quantity * v_selling_price * public.estimated_cost_ratio(), p_note, p_staff_id, p_created_by
  )
  returning * into v_claim;

  insert into public.stock_entries (
    item_id, location, entry_date,
    opening_stock, added_stock, sent_out,
    till_quantity_sold, quantity_sold, wastage, wastage_note,
    selling_price_snapshot, buying_price_snapshot,
    closing_stock, sales_value, cost_value, closing_stock_value, wastage_value,
    created_by
  )
  values (
    p_item_id, p_location, v_entry_date,
    v_opening_stock, v_added_stock, v_sent_out,
    v_till_quantity_sold, v_quantity_sold, v_wastage, v_wastage_note,
    v_selling_price, v_buying_price,
    v_total_stock - v_sent_out - v_quantity_sold - v_wastage - v_staff_meals - v_complimentary_meals - v_stock_adjustments,
    v_quantity_sold * v_selling_price,
    v_quantity_sold * v_buying_price,
    (v_total_stock - v_sent_out - v_quantity_sold - v_wastage - v_staff_meals - v_complimentary_meals - v_stock_adjustments) * v_buying_price,
    v_wastage * v_selling_price * public.estimated_cost_ratio(),
    p_created_by
  )
  on conflict (item_id, location, entry_date) do update set
    added_stock = excluded.added_stock,
    closing_stock = excluded.closing_stock,
    closing_stock_value = excluded.closing_stock_value,
    wastage_value = excluded.wastage_value;

  return v_claim;
end;
$$;

-- ----------------------------------------------------------------
-- 10. Drop the now-redundant parallel *_estimated_value columns --
--     wastage_value/value are now themselves always the ratio-based
--     figure, so a separate estimated column would just duplicate it.
-- ----------------------------------------------------------------
alter table public.stock_entries drop column if exists wastage_estimated_value;
alter table public.staff_meal_entries drop column if exists estimated_value;
alter table public.complimentary_meal_entries drop column if exists estimated_value;
alter table public.stock_adjustment_entries drop column if exists estimated_value;

-- ----------------------------------------------------------------
-- 11. dashboard_stock_consumption_ledger() -- drop the estimated_value
--     output column (return shape change requires an explicit DROP
--     before CREATE OR REPLACE).
-- ----------------------------------------------------------------
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

-- ----------------------------------------------------------------
-- 12. dashboard_stock_summary() / dashboard_staff_meal_summary() /
--     dashboard_complimentary_meal_summary() /
--     dashboard_stock_adjustment_summary() -- drop the estimated_value
--     output columns (return shape change requires an explicit DROP
--     before CREATE OR REPLACE).
-- ----------------------------------------------------------------
drop function if exists public.dashboard_stock_summary(date, date);
drop function if exists public.dashboard_staff_meal_summary(date, date);
drop function if exists public.dashboard_complimentary_meal_summary(date, date);
drop function if exists public.dashboard_stock_adjustment_summary(date, date);

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
  closing_stock numeric
)
language sql
security invoker
stable
as $$
  select
    se.location,
    coalesce(sum(se.sales_value), 0) as sales_value,
    coalesce(sum(se.cost_value), 0) as cost_value,
    coalesce(sum(se.wastage_value), 0) as wastage_value,
    coalesce((
      select sum(latest.closing_stock_value)
      from (
        select distinct on (se2.item_id) se2.closing_stock_value
        from public.stock_entries se2
        where se2.location = se.location
          and se2.entry_date >= p_from
          and se2.entry_date <= p_to
        order by se2.item_id, se2.entry_date desc
      ) latest
    ), 0) as closing_stock_value,
    coalesce((
      select sum(earliest.opening_stock)
      from (
        select distinct on (se3.item_id) se3.opening_stock
        from public.stock_entries se3
        where se3.location = se.location
          and se3.entry_date >= p_from
          and se3.entry_date <= p_to
        order by se3.item_id, se3.entry_date asc
      ) earliest
    ), 0) as opening_stock,
    coalesce((
      select sum(earliest.opening_stock * earliest.buying_price_snapshot)
      from (
        select distinct on (se5.item_id) se5.opening_stock, se5.buying_price_snapshot
        from public.stock_entries se5
        where se5.location = se.location
          and se5.entry_date >= p_from
          and se5.entry_date <= p_to
        order by se5.item_id, se5.entry_date asc
      ) earliest
    ), 0) as opening_stock_value,
    coalesce(sum(se.added_stock), 0) as added_stock,
    coalesce(sum(se.added_stock * se.buying_price_snapshot), 0) as added_stock_value,
    coalesce(sum(se.sent_out), 0) as sent_out,
    coalesce(sum(se.quantity_sold), 0) as quantity_sold,
    coalesce((
      select sum(latest.closing_stock)
      from (
        select distinct on (se4.item_id) se4.closing_stock
        from public.stock_entries se4
        where se4.location = se.location
          and se4.entry_date >= p_from
          and se4.entry_date <= p_to
        order by se4.item_id, se4.entry_date desc
      ) latest
    ), 0) as closing_stock
  from public.stock_entries se
  where se.entry_date >= p_from and se.entry_date <= p_to
  group by se.location;
$$;

create or replace function public.dashboard_staff_meal_summary(
  p_from date,
  p_to date
)
returns table (
  location location_type,
  value numeric
)
language sql
security invoker
stable
as $$
  select
    sme.location,
    coalesce(sum(sme.value), 0) as value
  from public.staff_meal_entries sme
  where sme.meal_date >= p_from and sme.meal_date <= p_to
  group by sme.location;
$$;

create or replace function public.dashboard_complimentary_meal_summary(
  p_from date,
  p_to date
)
returns table (
  location location_type,
  value numeric
)
language sql
security invoker
stable
as $$
  select
    cme.location,
    coalesce(sum(cme.value), 0) as value
  from public.complimentary_meal_entries cme
  where cme.meal_date >= p_from and cme.meal_date <= p_to
  group by cme.location;
$$;

create or replace function public.dashboard_stock_adjustment_summary(
  p_from date,
  p_to date
)
returns table (
  location location_type,
  value numeric
)
language sql
security invoker
stable
as $$
  select
    sae.location,
    coalesce(sum(sae.value), 0) as value
  from public.stock_adjustment_entries sae
  where sae.meal_date >= p_from and sae.meal_date <= p_to
  group by sae.location;
$$;
