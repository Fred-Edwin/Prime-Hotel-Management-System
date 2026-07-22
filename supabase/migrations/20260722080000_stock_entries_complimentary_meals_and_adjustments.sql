-- ============================================================
-- Complimentary meals and stock adjustments (docs/backlog/05_stock_
-- consumption.md) become a fourth and fifth contributor to
-- stock_entries.closing_stock and the oversell check, alongside wastage
-- and staff_meals:
--
--   closing_stock = total_stock - sent_out - quantity_sold - wastage
--                   - staff_meals - complimentary_meals - stock_adjustments
--
-- Exactly the same "re-derive from source, never store on stock_entries
-- itself" discipline staff_meals already established (§3.5,
-- 20260719151000_stock_entries_staff_meals.sql) -- every writer below
-- gets the same two one-line additions
-- (v_complimentary_meals/v_stock_adjustments via
-- complimentary_meals_total()/stock_adjustments_total()), folded into
-- its existing oversell check and closing_stock/closing_stock_value
-- arithmetic. No function's parameter list changes shape, so plain
-- `create or replace` is safe here.
--
-- IMPORTANT: this migration must run AFTER the daily-cadence conversion
-- (20260720120000_canteen_daily_cadence.sql) -- it re-defines the
-- CURRENT (daily-cadence) bodies of save_canteen_stock_entry(),
-- save_stock_entry_canteen_field(), and apply_order_to_stock_entry(),
-- not the older weekly-cadence versions from 20260719151000. Restaurant-
-- side functions (save_stock_entry, save_stock_entry_store_manager_
-- fields, save_stock_entry_cashier_field) were untouched by the cadence
-- conversion, so their 20260719151000 bodies are still current -- this
-- migration re-defines those too, with the two new terms added on top.
-- ============================================================

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
    v_wastage * p_buying_price_snapshot,
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
    v_wastage * p_buying_price_snapshot,
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
    v_wastage * p_buying_price_snapshot,
    p_created_by
  )
  on conflict (item_id, location, entry_date) do update set
    added_stock = excluded.added_stock,
    quantity_sold = excluded.quantity_sold,
    closing_stock = excluded.closing_stock,
    sales_value = excluded.sales_value,
    cost_value = excluded.cost_value,
    closing_stock_value = excluded.closing_stock_value
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
    v_wastage * p_buying_price_snapshot,
    p_created_by
  )
  on conflict (item_id, location, entry_date) do update set
    added_stock = excluded.added_stock,
    sent_out = excluded.sent_out,
    quantity_sold = excluded.quantity_sold,
    closing_stock = excluded.closing_stock,
    sales_value = excluded.sales_value,
    cost_value = excluded.cost_value,
    closing_stock_value = excluded.closing_stock_value
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
    v_wastage * p_buying_price_snapshot,
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
    closing_stock_value = excluded.closing_stock_value
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
    v_wastage * v_buying_price,
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
    closing_stock_value = excluded.closing_stock_value
  returning * into v_row;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------
-- 7. create_complimentary_meal_entry() / create_stock_adjustment_entry()
--    -- write path for a single claim, mirroring create_staff_meal_entry()
--    (§3.5) exactly: insert the claim row, then force a stock_entries
--    recompute for that item/location/date in the SAME transaction, so
--    the oversell check re-runs against the combined total (till +
--    orders + wastage + staff_meals + THIS claim + the other new
--    category) before anything commits.
--
--    Cadence: both locations are daily since 20260720120000 -- no
--    week-Monday resolution needed, entry_date is meal_date as-is.
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

  -- This claim's own quantity isn't committed yet, so it's added
  -- explicitly on top of the already-committed total -- same discipline
  -- create_staff_meal_entry() uses for its own p_quantity.
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
    v_buying_price, p_quantity * v_buying_price, p_note, p_staff_id, p_created_by
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
    v_wastage * v_buying_price,
    p_created_by
  )
  on conflict (item_id, location, entry_date) do update set
    added_stock = excluded.added_stock,
    closing_stock = excluded.closing_stock,
    closing_stock_value = excluded.closing_stock_value;

  return v_claim;
end;
$$;

create or replace function public.create_stock_adjustment_entry(
  p_item_id uuid,
  p_location location_type,
  p_meal_date date,
  p_quantity numeric,
  p_note text,
  p_staff_id uuid,
  p_created_by uuid
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
    v_buying_price, p_quantity * v_buying_price, p_note, p_staff_id, p_created_by
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
    v_wastage * v_buying_price,
    p_created_by
  )
  on conflict (item_id, location, entry_date) do update set
    added_stock = excluded.added_stock,
    closing_stock = excluded.closing_stock,
    closing_stock_value = excluded.closing_stock_value;

  return v_claim;
end;
$$;
