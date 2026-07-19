-- ============================================================
-- Staff meals (docs/backlog/02_staff_meals.md) become a third
-- contributor to stock_entries.closing_stock and the oversell check,
-- alongside wastage: closing_stock = total_stock - sent_out -
-- quantity_sold - wastage - staff_meals. staff_meals is never stored on
-- stock_entries itself (staff_meal_entries is its own table, see the
-- prior migration) -- every writer function below re-derives it via
-- staff_meals_total(item_id, location, period_start, period_end), the
-- same "re-derive from source, never increment/decrement an absolute
-- total" discipline quantity_sold already follows for orders (§3.4).
--
-- This touches all SIX existing writers of stock_entries -- every one of
-- them independently computes v_total_stock/the oversell check/the
-- derived value columns inline (there is no single shared SQL helper for
-- this, only the parallel TypeScript mirror in lib/calculations.ts), so
-- each needs the same one-line addition: pull v_staff_meals via
-- staff_meals_total() for the correct period (daily for restaurant,
-- weekly Monday-Sunday for canteen -- same period each function already
-- uses for its own order_items sum), then include it in the oversell
-- check and in closing_stock/closing_stock_value's arithmetic. No
-- function's parameter list changes shape, so plain `create or replace`
-- is safe here (unlike 20260717093000, which had to drop-and-recreate
-- because parameters moved from required to optional).
--
-- staff_meals_total() itself does NOT need the row lock these functions
-- already take via lock_stock_entry_row() -- a staff meal claim is
-- inserted directly (app/api/staff-meals POST), it doesn't go through
-- any of these stock_entries writer functions, so there's no risk of it
-- racing the read inside this transaction in the same way order_items
-- could before the row-locking fix (20260712091633): the existing
-- advisory lock here still serializes any OTHER stock_entries writer
-- from running concurrently and observing a different order_items/
-- staff_meal_entries snapshot, which is what actually matters for
-- consistency between "what a writer sees" and "what it writes".
-- ============================================================

-- ----------------------------------------------------------------
-- 1. save_stock_entry() -- restaurant batch save (till_quantity_sold,
--    plus optional added_stock/sent_out/wastage with preserve semantics)
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

  if v_sent_out + v_quantity_sold + v_wastage + v_staff_meals > v_total_stock then
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
    v_total_stock - v_sent_out - v_quantity_sold - v_wastage - v_staff_meals,
    v_quantity_sold * p_selling_price_snapshot,
    v_quantity_sold * p_buying_price_snapshot,
    (v_total_stock - v_sent_out - v_quantity_sold - v_wastage - v_staff_meals) * p_buying_price_snapshot,
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
-- 2. save_canteen_stock_entry() -- canteen weekly batch save
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
  v_week_end date := p_entry_date + 6;
  v_opening_stock numeric(10,2);
  v_added_stock numeric(10,2);
  v_total_stock numeric(10,2);
  v_order_total numeric(10,2);
  v_quantity_sold numeric(10,2);
  v_wastage numeric(10,2);
  v_wastage_note text;
  v_staff_meals numeric(10,2);
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
    v_added_stock := public.canteen_supplied_total(p_item_id, p_entry_date, v_week_end);
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
    and o.order_date <= v_week_end;

  v_quantity_sold := p_till_quantity_sold + v_order_total;

  v_staff_meals := public.staff_meals_total(p_item_id, 'canteen', p_entry_date, v_week_end);

  if v_quantity_sold + v_wastage + v_staff_meals > v_total_stock then
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
    v_total_stock - v_quantity_sold - v_wastage - v_staff_meals,
    v_quantity_sold * p_selling_price_snapshot,
    v_quantity_sold * p_buying_price_snapshot,
    (v_total_stock - v_quantity_sold - v_wastage - v_staff_meals) * p_buying_price_snapshot,
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
-- 3. apply_order_to_stock_entry() -- orders write-path (§3.4)
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
  v_entry_date date;
  v_period_end date;
  v_is_canteen_supplied boolean;
  v_existing public.stock_entries;
  v_opening_stock numeric(10,2);
  v_till_quantity_sold numeric(10,2);
  v_added_stock numeric(10,2);
  v_sent_out numeric(10,2);
  v_wastage numeric(10,2);
  v_wastage_note text;
  v_staff_meals numeric(10,2);
  v_total_stock numeric(10,2);
  v_order_total numeric(10,2);
  v_quantity_sold numeric(10,2);
  v_row public.stock_entries;
begin
  if p_location = 'canteen' then
    v_entry_date := date_trunc('week', p_order_date::timestamp)::date;
    v_period_end := v_entry_date + 6;

    select supply_type = 'canteen_supplied' into v_is_canteen_supplied
    from public.items where id = p_item_id;
  else
    v_entry_date := p_order_date;
    v_period_end := p_order_date;
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

  v_staff_meals := public.staff_meals_total(p_item_id, p_location, v_entry_date, v_period_end);

  if v_sent_out + v_quantity_sold + v_wastage + v_staff_meals > v_total_stock then
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
    v_total_stock - v_sent_out - v_quantity_sold - v_wastage - v_staff_meals,
    v_quantity_sold * p_selling_price_snapshot,
    v_quantity_sold * p_buying_price_snapshot,
    (v_total_stock - v_sent_out - v_quantity_sold - v_wastage - v_staff_meals) * p_buying_price_snapshot,
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

  if p_sent_out + v_quantity_sold + v_wastage + v_staff_meals > v_total_stock then
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
    v_total_stock - p_sent_out - v_quantity_sold - v_wastage - v_staff_meals,
    v_quantity_sold * p_selling_price_snapshot,
    v_quantity_sold * p_buying_price_snapshot,
    (v_total_stock - p_sent_out - v_quantity_sold - v_wastage - v_staff_meals) * p_buying_price_snapshot,
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

  if v_sent_out + v_quantity_sold + v_wastage + v_staff_meals > v_total_stock then
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
    v_total_stock - v_sent_out - v_quantity_sold - v_wastage - v_staff_meals,
    v_quantity_sold * p_selling_price_snapshot,
    v_quantity_sold * p_buying_price_snapshot,
    (v_total_stock - v_sent_out - v_quantity_sold - v_wastage - v_staff_meals) * p_buying_price_snapshot,
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
-- 6. save_stock_entry_canteen_field() -- canteen autosave (both fields)
-- ----------------------------------------------------------------
-- ----------------------------------------------------------------
-- 7. create_staff_meal_entry() -- the write path for a staff meal claim
--    itself (app/api/staff-meals POST). Mirrors create_order()'s shape
--    (20260712080310_orders_write_function.sql): insert the claim row,
--    then force a stock_entries recompute for that item/location/period
--    in the SAME transaction, so the oversell check re-runs against the
--    combined total (till + orders + wastage + THIS claim) before
--    anything commits -- exactly the same atomicity guarantee orders
--    already get, not a "insert now, let some later unrelated write
--    notice the oversell" gap.
--
-- Locking: takes the same lock_stock_entry_row() advisory lock as every
-- other stock_entries writer, on the resolved entry_date (today for
-- restaurant, that week's Monday for canteen) -- so a staff meal claim
-- landing concurrently with a till save/order on the same item/period is
-- serialized exactly like every other writer pair in §3.4, not a new
-- race.
--
-- Which stock_entries writer does the recompute: this function does NOT
-- call save_stock_entry()/save_stock_entry_cashier_field()/etc, since
-- those are all "write MY field, preserve everyone else's" -- a staff
-- meal claim doesn't own any stock_entries column at all, it only needs
-- the row's derived values (closing_stock etc.) refreshed. So it
-- inlines the same read-existing-or-carry-forward-opening-stock /
-- recompute-quantity_sold-and-staff_meals / oversell-check / upsert
-- sequence every other writer already follows, touching NONE of
-- till_quantity_sold/added_stock/sent_out/wastage (preserved from the
-- existing row, or defaulted to 0 for a brand-new row, same as every
-- other writer's "not my field" columns).
--
-- Cadence: mirrors apply_order_to_stock_entry()'s date_trunc('week', ...)
-- resolution for canteen locations exactly -- a canteen staff member's
-- meal_date is a real calendar day, but stock_entries.entry_date for
-- canteen is always that week's Monday (§3.1).
-- ----------------------------------------------------------------
create or replace function public.create_staff_meal_entry(
  p_item_id uuid,
  p_location location_type,
  p_meal_date date,
  p_quantity numeric,
  p_note text,
  p_staff_id uuid,
  p_created_by uuid
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
    v_entry_date := date_trunc('week', p_meal_date::timestamp)::date;
    v_period_end := v_entry_date + 6;

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

  -- The oversell check must include THIS claim's quantity even though
  -- it isn't inserted yet -- staff_meals_total() only sees already-
  -- committed rows, so p_quantity is added explicitly here (the one
  -- place in this migration that isn't a pure re-derivation, because
  -- the row being checked against doesn't exist until this function
  -- inserts it).
  select public.staff_meals_total(p_item_id, p_location, v_entry_date, v_period_end) + p_quantity
    into v_staff_meals;

  if v_sent_out + v_quantity_sold + v_wastage + v_staff_meals > v_total_stock then
    raise exception 'oversell: only % available for this item', v_total_stock
      using errcode = 'P0001';
  end if;

  insert into public.staff_meal_entries (
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
    v_total_stock - v_sent_out - v_quantity_sold - v_wastage - v_staff_meals,
    v_quantity_sold * v_selling_price,
    v_quantity_sold * v_buying_price,
    (v_total_stock - v_sent_out - v_quantity_sold - v_wastage - v_staff_meals) * v_buying_price,
    v_wastage * v_buying_price,
    p_created_by
  )
  on conflict (item_id, location, entry_date) do update set
    added_stock = excluded.added_stock,
    closing_stock = excluded.closing_stock,
    closing_stock_value = excluded.closing_stock_value
    -- till_quantity_sold/sent_out/wastage/wastage_note/quantity_sold/
    -- sales_value/cost_value/price snapshots are intentionally NOT in
    -- this SET list -- a staff meal claim doesn't own any of those
    -- columns, same "don't clobber another writer's field" discipline
    -- as apply_order_to_stock_entry(). added_stock IS included, but
    -- (like apply_order_to_stock_entry()) only ever actually moves for
    -- canteen_supplied items, where it's freshly re-derived above; for
    -- every other item v_added_stock is just the existing row's own
    -- value, so this is a no-op write for them.
  ;

  return v_claim;
end;
$$;

create or replace function public.save_stock_entry_canteen_field(
  p_item_id uuid,
  p_entry_date date,        -- Monday of the target week
  p_is_canteen_supplied boolean,
  p_till_quantity_sold numeric default null,  -- omit to preserve
  p_added_stock_input numeric default null,   -- omit to preserve; ignored for canteen_supplied items
  p_selling_price_snapshot numeric default null,
  p_buying_price_snapshot numeric default null,
  p_created_by uuid default null
)
returns public.stock_entries
language plpgsql
security invoker
as $$
declare
  v_week_end date := p_entry_date + 6;
  v_existing public.stock_entries;
  v_opening_stock numeric(10,2);
  v_added_stock numeric(10,2);
  v_till_quantity_sold numeric(10,2);
  v_wastage numeric(10,2);
  v_wastage_note text;
  v_staff_meals numeric(10,2);
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
    v_added_stock := public.canteen_supplied_total(p_item_id, p_entry_date, v_week_end);
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
    and o.order_date <= v_week_end;

  v_quantity_sold := v_till_quantity_sold + v_order_total;

  v_staff_meals := public.staff_meals_total(p_item_id, 'canteen', p_entry_date, v_week_end);

  if v_quantity_sold + v_wastage + v_staff_meals > v_total_stock then
    if p_is_canteen_supplied and v_added_stock = 0 then
      raise exception 'not_yet_supplied: the restaurant has not sent this week''s supply yet for this item'
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
    v_total_stock - v_quantity_sold - v_wastage - v_staff_meals,
    v_quantity_sold * v_selling_price,
    v_quantity_sold * v_buying_price,
    (v_total_stock - v_quantity_sold - v_wastage - v_staff_meals) * v_buying_price,
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
