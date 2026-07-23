-- ============================================================
-- estimated_value on staff_meal_entries/complimentary_meal_entries/
-- stock_adjustment_entries -- same "quantity * effective_unit_cost()"
-- fallback as wastage_estimated_value (20260723140000). Each of these
-- three write functions also upserts stock_entries (to recompute
-- closing_stock etc. after its own claim), so wastage_estimated_value
-- needs recomputing there too, on the row's OWN wastage figure (v_wastage,
-- unrelated to this claim) using the same effective cost.
-- ============================================================

-- ----------------------------------------------------------------
-- 1. create_staff_meal_entry()
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
  v_effective_cost numeric(10,2);
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

  v_effective_cost := public.effective_unit_cost(v_buying_price, v_selling_price);

  insert into public.staff_meal_entries (
    item_id, location, meal_date, quantity,
    buying_price_snapshot, value, estimated_value, note, staff_id, created_by
  )
  values (
    p_item_id, p_location, p_meal_date, p_quantity,
    v_buying_price, p_quantity * v_buying_price, p_quantity * v_effective_cost, p_note, p_staff_id, p_created_by
  )
  returning * into v_claim;

  insert into public.stock_entries (
    item_id, location, entry_date,
    opening_stock, added_stock, sent_out,
    till_quantity_sold, quantity_sold, wastage, wastage_note,
    selling_price_snapshot, buying_price_snapshot,
    closing_stock, sales_value, cost_value, closing_stock_value, wastage_value, wastage_estimated_value,
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
    v_wastage * v_effective_cost,
    p_created_by
  )
  on conflict (item_id, location, entry_date) do update set
    added_stock = excluded.added_stock,
    closing_stock = excluded.closing_stock,
    closing_stock_value = excluded.closing_stock_value,
    wastage_estimated_value = excluded.wastage_estimated_value;

  return v_claim;
end;
$$;

-- ----------------------------------------------------------------
-- 2. create_complimentary_meal_entry()
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
  v_effective_cost numeric(10,2);
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

  v_effective_cost := public.effective_unit_cost(v_buying_price, v_selling_price);

  insert into public.complimentary_meal_entries (
    item_id, location, meal_date, quantity,
    buying_price_snapshot, value, estimated_value, note, staff_id, created_by
  )
  values (
    p_item_id, p_location, p_meal_date, p_quantity,
    v_buying_price, p_quantity * v_buying_price, p_quantity * v_effective_cost, p_note, p_staff_id, p_created_by
  )
  returning * into v_claim;

  insert into public.stock_entries (
    item_id, location, entry_date,
    opening_stock, added_stock, sent_out,
    till_quantity_sold, quantity_sold, wastage, wastage_note,
    selling_price_snapshot, buying_price_snapshot,
    closing_stock, sales_value, cost_value, closing_stock_value, wastage_value, wastage_estimated_value,
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
    v_wastage * v_effective_cost,
    p_created_by
  )
  on conflict (item_id, location, entry_date) do update set
    added_stock = excluded.added_stock,
    closing_stock = excluded.closing_stock,
    closing_stock_value = excluded.closing_stock_value,
    wastage_estimated_value = excluded.wastage_estimated_value;

  return v_claim;
end;
$$;

-- ----------------------------------------------------------------
-- 3. create_stock_adjustment_entry() -- signed (20260722110000)
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
  v_effective_cost numeric(10,2);
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

  v_effective_cost := public.effective_unit_cost(v_buying_price, v_selling_price);

  insert into public.stock_adjustment_entries (
    item_id, location, meal_date, quantity,
    buying_price_snapshot, value, estimated_value, note, staff_id, created_by
  )
  values (
    p_item_id, p_location, p_meal_date, p_quantity,
    v_buying_price, p_quantity * v_buying_price, p_quantity * v_effective_cost, p_note, p_staff_id, p_created_by
  )
  returning * into v_claim;

  insert into public.stock_entries (
    item_id, location, entry_date,
    opening_stock, added_stock, sent_out,
    till_quantity_sold, quantity_sold, wastage, wastage_note,
    selling_price_snapshot, buying_price_snapshot,
    closing_stock, sales_value, cost_value, closing_stock_value, wastage_value, wastage_estimated_value,
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
    v_wastage * v_effective_cost,
    p_created_by
  )
  on conflict (item_id, location, entry_date) do update set
    added_stock = excluded.added_stock,
    closing_stock = excluded.closing_stock,
    closing_stock_value = excluded.closing_stock_value,
    wastage_estimated_value = excluded.wastage_estimated_value;

  return v_claim;
end;
$$;
