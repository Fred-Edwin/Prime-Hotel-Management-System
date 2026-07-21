-- ============================================================
-- Convert canteen's stock_entries cadence from weekly to daily,
-- matching restaurant's shape exactly. See the implementation plan this
-- migration was built from, and docs/phases/postlaunch_canteen_daily_
-- context.md for the completed-work summary.
--
-- WHY: canteen has, since the original build, tracked stock weekly --
-- every write normalized entry_date to that week's Monday. This caused
-- real, confirmed client confusion (WaPrecious expected canteen's
-- "opening stock" to carry over day to day like restaurant's does) and
-- a real defect: the admin dashboard's "Today" period toggle silently
-- showed canteen as zero stock movement on every non-Monday day, since
-- a canteen row's entry_date was never actually "today" except on a
-- Monday.
--
-- CONFIRMED DECISION: canteen converts to daily. A canteen_supplied
-- item's daily added_stock becomes a same-day 1:1 mirror of the
-- restaurant's sent_out for that item on that same calendar day (no
-- more summing across a week).
--
-- HISTORICAL ROWS ARE FROZEN, NOT MIGRATED. This migration contains no
-- UPDATE/backfill against existing stock_entries or
-- canteen_stock_purchases rows. Existing canteen rows dated to a past
-- Monday (each representing what was, at the time, a whole week's
-- movement) are left exactly as they are. Only new writes going
-- forward use a real daily entry_date. stock_entries will, from this
-- point on, contain a genuine mix for canteen: old rows dated only to
-- past Mondays, and new rows dated to any real day -- this is accepted,
-- not a defect to engineer around. recompute_stock_entry_chain()
-- (unchanged by this migration) already treats each existing row as
-- simply "the next period" regardless of the gap between rows, so the
-- old-to-new transition (a 21-day-or-so gap) needs no special handling.
--
-- Every function below is a `create or replace function` with its
-- existing signature unchanged -- only internal date-math changes, so
-- no caller needs a matching signature change. The one function with a
-- genuine logic redesign (not just a mechanical constant swap) is
-- recompute_stock_entry_cascade(): its cross-location cascade branch
-- collapses from "loop over every canteen week overlapping a 7-day
-- lookback" to "update the single same-day canteen row, if one exists"
-- -- there's no week window to catch the start of once canteen is
-- daily.
--
-- A separate, real user-visible fix rides along in this migration:
-- record_canteen_stock_purchase() previously silently normalized
-- whatever purchase_date the admin picked in CanteenPurchaseModal.tsx
-- down to that week's Monday before storing it -- the real date was
-- discarded server-side even though the client already sent it
-- correctly. After this migration, purchase_date stores the actual
-- date selected. Historical purchase records made before this change
-- still show Monday dates (frozen, not backfilled, same principle as
-- above) while new ones show real dates.
-- ============================================================

-- ------------------------------------------------------------
-- 1. save_canteen_stock_entry() -- batch/legacy single-row canteen save.
--    v_week_end -> v_period_end, and it's now always p_entry_date (same
--    day), not p_entry_date + 6. Every downstream use (canteen_supplied_
--    total, order_total range, staff_meals_total) now automatically
--    resolves to a same-day range.
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 2. save_stock_entry_canteen_field() -- canteen's PUT-autosave partial
--    update (both quantity_sold and added_stock, one person, one field
--    at a time). Same v_week_end -> v_period_end change. The
--    'not_yet_supplied' exception message is also corrected here from
--    "this week's supply" to "today's supply" -- the underlying check
--    is now same-day, so the old wording would be actively wrong, not
--    just stale copy (lib/errors.ts's describeSaveError() string for
--    this same case is corrected in the application layer to match).
-- ------------------------------------------------------------
create or replace function public.save_stock_entry_canteen_field(
  p_item_id uuid,
  p_entry_date date,
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
  v_period_end date := p_entry_date;
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

  if v_quantity_sold + v_wastage + v_staff_meals > v_total_stock then
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

-- ------------------------------------------------------------
-- 3. apply_order_to_stock_entry() -- branch collapse. Date math becomes
--    identical for both locations (v_entry_date/v_period_end always
--    just p_order_date); only the supply_type lookup stays conditional
--    on p_location = 'canteen', since v_is_canteen_supplied must never
--    be true for a restaurant order.
-- ------------------------------------------------------------
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
  v_entry_date := p_order_date;
  v_period_end := p_order_date;

  if p_location = 'canteen' then
    select supply_type = 'canteen_supplied' into v_is_canteen_supplied
    from public.items where id = p_item_id;
  else
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

-- ------------------------------------------------------------
-- 4. create_staff_meal_entry() -- identical branch collapse to
--    apply_order_to_stock_entry() above.
-- ------------------------------------------------------------
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
  v_claim public.staff_meal_entries;
begin
  select buying_price, selling_price into v_buying_price, v_selling_price
  from public.items
  where id = p_item_id and active;

  if v_buying_price is null then
    raise exception 'unknown_item: item is not active or does not exist'
      using errcode = 'P0004';
  end if;

  v_entry_date := p_meal_date;
  v_period_end := p_meal_date;

  if p_location = 'canteen' then
    select supply_type = 'canteen_supplied' into v_is_canteen_supplied
    from public.items where id = p_item_id;
  else
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
  ;

  return v_claim;
end;
$$;

-- ------------------------------------------------------------
-- 5. record_canteen_stock_purchase() -- real behavior fix: purchase_date
--    now stores the actual date submitted, not that week's Monday. See
--    the migration header comment above and docs/01_DATA_MODEL.md §3.1
--    for the full before/after.
-- ------------------------------------------------------------
create or replace function public.record_canteen_stock_purchase(
  p_item_id uuid,
  p_purchase_date date,
  p_quantity numeric,
  p_unit_cost numeric,
  p_created_by uuid,
  p_supplier_note text default null
)
returns public.canteen_stock_purchases
language plpgsql
security invoker
as $$
declare
  v_purchase_day date := p_purchase_date;
  v_supply_type item_supply_type;
  v_selling_price numeric(10,2);
  v_buying_price numeric(10,2);
  v_qty_on_hand numeric(10,2);
  v_old_avg_cost numeric(10,2);
  v_new_avg_cost numeric(10,2);
  v_existing_entry public.stock_entries;
  v_purchase public.canteen_stock_purchases;
begin
  select supply_type, selling_price, buying_price
    into v_supply_type, v_selling_price, v_buying_price
  from public.items where id = p_item_id;

  if v_supply_type is distinct from 'canteen_independent' then
    raise exception 'Only canteen_independent items can have a canteen stock purchase logged'
      using errcode = '23514';
  end if;

  perform public.lock_stock_entry_row(p_item_id, 'canteen', v_purchase_day);

  select * into v_existing_entry
  from public.stock_entries
  where item_id = p_item_id and location = 'canteen' and entry_date = v_purchase_day;

  if v_existing_entry.id is not null then
    v_qty_on_hand := v_existing_entry.opening_stock + v_existing_entry.added_stock;
  else
    select closing_stock into v_qty_on_hand
    from public.stock_entries
    where item_id = p_item_id and location = 'canteen' and entry_date < v_purchase_day
    order by entry_date desc
    limit 1;
    v_qty_on_hand := coalesce(v_qty_on_hand, 0);
  end if;

  v_old_avg_cost := v_buying_price;

  if v_qty_on_hand + p_quantity = 0 then
    v_new_avg_cost := p_unit_cost;
  else
    v_new_avg_cost := (v_qty_on_hand * coalesce(v_old_avg_cost, 0) + p_quantity * p_unit_cost)
      / (v_qty_on_hand + p_quantity);
  end if;

  insert into public.canteen_stock_purchases (
    item_id, purchase_date, quantity, unit_cost, total_cost, supplier_note, created_by
  )
  values (
    p_item_id, v_purchase_day, p_quantity, p_unit_cost, p_quantity * p_unit_cost, p_supplier_note, p_created_by
  )
  returning * into v_purchase;

  update public.items
  set buying_price = v_new_avg_cost
  where id = p_item_id;

  perform public.save_stock_entry_canteen_field(
    p_item_id,
    v_purchase_day,
    false,
    null,
    coalesce(v_existing_entry.added_stock, 0) + p_quantity,
    v_selling_price,
    v_new_avg_cost,
    p_created_by
  );

  return v_purchase;
end;
$$;

-- ------------------------------------------------------------
-- 6. recompute_stock_entry_cascade() -- genuine logic redesign. Once
--    canteen is daily, there's no week window to "catch the start of"
--    -- a restaurant edit on day D only ever affects a canteen row whose
--    entry_date = D (if one exists), plus the ordinary forward chain
--    from there (recompute_stock_entry_chain(), unchanged below).
--
--    Historical weekly rows are frozen (see header comment): a
--    restaurant edit that falls within an old canteen week (row dated
--    to that week's Monday) will find no canteen row with
--    entry_date = the edited date -- correct, expected, no special-
--    casing needed. Falls out naturally from the exact-date match.
-- ------------------------------------------------------------
create or replace function public.recompute_stock_entry_cascade(
  p_item_id uuid,
  p_edited_location location_type,
  p_edited_from_date date
)
returns setof public.stock_entries
language plpgsql
security invoker
as $$
declare
  v_supply_type item_supply_type;
  v_canteen_row_exists boolean;
begin
  return query select * from public.recompute_stock_entry_chain(p_item_id, p_edited_location, p_edited_from_date);

  if p_edited_location = 'restaurant' then
    select supply_type into v_supply_type from public.items where id = p_item_id;

    if v_supply_type = 'canteen_supplied' then
      -- Daily cadence (post-conversion): a canteen_supplied item's
      -- restaurant sent_out feeds the SAME-DAY canteen row's added_stock
      -- 1:1, not a week-range sum. If a canteen row exists for this exact
      -- date, re-pull its added_stock from canteen_supplied_total() (now
      -- called with a same-day range) and cascade forward from it.
      --
      -- Frozen historical weekly rows (entry_date on a past Monday,
      -- representing a whole pre-conversion week) are deliberately NOT
      -- matched or touched here -- a same-day restaurant edit has no
      -- corresponding weekly row at that exact date, by design. Only
      -- genuinely daily canteen rows going forward participate.
      select exists (
        select 1 from public.stock_entries
        where item_id = p_item_id and location = 'canteen' and entry_date = p_edited_from_date
      ) into v_canteen_row_exists;

      if v_canteen_row_exists then
        perform public.lock_stock_entry_row(p_item_id, 'canteen', p_edited_from_date);

        update public.stock_entries
        set added_stock = public.canteen_supplied_total(p_item_id, p_edited_from_date, p_edited_from_date)
        where item_id = p_item_id and location = 'canteen' and entry_date = p_edited_from_date;

        return query select * from public.recompute_stock_entry_chain(p_item_id, 'canteen', p_edited_from_date);
      end if;
    end if;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 7. staff_meal_available_stock() -- delete the case wrapper that
--    normalized p_as_of_date to that week's Monday for canteen; both
--    locations now use the as-of date directly. The OTHER case in this
--    function (which supply_type array to filter by location) is
--    unrelated to cadence and is left untouched.
-- ------------------------------------------------------------
create or replace function public.staff_meal_available_stock(
  p_location location_type,
  p_as_of_date date
)
returns table (
  item_id uuid,
  available numeric
)
language sql
security invoker
stable
as $$
  select
    i.id as item_id,
    latest.closing_stock as available
  from public.items i
  left join lateral (
    select se.closing_stock
    from public.stock_entries se
    where se.item_id = i.id
      and se.location = p_location
      and se.entry_date <= p_as_of_date
    order by se.entry_date desc
    limit 1
  ) latest on true
  where i.active
    and i.supply_type = any (
      case when p_location = 'restaurant'
        then array['restaurant_only', 'canteen_supplied']::item_supply_type[]
        else array['canteen_supplied', 'canteen_independent']::item_supply_type[]
      end
    );
$$;

-- ------------------------------------------------------------
-- 8. RLS policy collapse #1 (UPDATE) -- drop the canteen-week escape
--    hatch. Once canteen's period is a day (matching restaurant), a
--    same-location staffer may only update the row for entry_date =
--    current_date, same as restaurant. Historical (including frozen
--    weekly) rows remain admin-only-editable via is_admin().
-- ------------------------------------------------------------
drop policy "stock_update_admin_or_current_period_location" on public.stock_entries;

create policy "stock_update_admin_or_current_period_location" on public.stock_entries
  for update using (
    public.is_admin()
    or (
      location = public.my_location()
      and entry_date = current_date
    )
  );

-- ------------------------------------------------------------
-- 9. RLS policy collapse #2 (INSERT / WITH CHECK) -- same collapse for
--    the insert-side policy.
-- ------------------------------------------------------------
drop policy "stock_insert_current_period_scoped" on public.stock_entries;

create policy "stock_insert_current_period_scoped" on public.stock_entries
  for insert with check (
    (created_by = auth.uid() or public.is_admin())
    and (
      public.is_admin()
      or (
        location = public.my_location()
        and entry_date = current_date
      )
    )
  );
