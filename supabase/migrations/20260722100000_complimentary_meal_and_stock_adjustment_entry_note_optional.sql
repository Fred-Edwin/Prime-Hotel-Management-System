-- ============================================================
-- Fix: create_complimentary_meal_entry()/create_stock_adjustment_entry()'s
-- p_note was declared as a required (non-default) parameter, same defect
-- 20260719152000_staff_meal_entry_note_optional.sql already fixed for
-- create_staff_meal_entry() -- supabase gen types typescript marked it
-- `p_note: string` (required, non-nullable) instead of optional, found
-- when regenerating lib/supabase/types.ts against these two new
-- functions (docs/backlog/05_stock_consumption.md) and hitting the same
-- "null isn't assignable to string" type error at the route layer that
-- migration's own header comment describes. Every other optional
-- free-text field in this schema is a trailing `default null` parameter
-- -- bringing these two in line with that convention, and with
-- create_staff_meal_entry() itself, which these two were built to mirror.
--
-- p_note moves to the end of each parameter list (required parameters
-- must precede optional ones in Postgres) -- a shape change, so the old
-- signature must be dropped explicitly first, same reasoning as
-- 20260719152000: `create or replace` does not drop a changed-shape
-- overload, and PostgREST would see two overloads and reject every
-- named-argument call (exactly how app/api/complimentary-meals/route.ts
-- and app/api/stock-adjustments/route.ts call these functions) as
-- ambiguous.
-- ============================================================

drop function if exists public.create_complimentary_meal_entry(uuid, location_type, date, numeric, text, uuid, uuid);
drop function if exists public.create_stock_adjustment_entry(uuid, location_type, date, numeric, text, uuid, uuid);

create or replace function public.create_complimentary_meal_entry(
  p_item_id uuid,
  p_location location_type,
  p_meal_date date,
  p_quantity numeric,
  p_staff_id uuid,
  p_created_by uuid,
  p_note text default null
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
