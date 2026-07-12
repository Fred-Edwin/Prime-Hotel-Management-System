-- ============================================================
-- Fix: a genuine two-simultaneous-first-writers race in the §3.4
-- mechanism, found while writing scripts/acceptance/phase6-orders.mjs
-- (a repeatable acceptance script -- not caught by the ad hoc testing
-- that shipped Phase 6, since that testing happened to run against a
-- stock_entries row that already existed from earlier data).
--
-- THE BUG: save_stock_entry(), save_canteen_stock_entry(), and
-- apply_order_to_stock_entry() each do a plain (non-locking) SELECT to
-- check whether a stock_entries row already exists for an
-- item/location/period, compute their oversell check and derived
-- values from that snapshot, then INSERT ... ON CONFLICT DO UPDATE.
-- When two calls race on a row that does NOT yet exist for either of
-- them (e.g. a till save and a delivery order, both the first-ever
-- write of the day for that item), both see "no row", both compute
-- v_added_stock/v_total_stock from their own inputs only (each unaware
-- of the other's contribution), and both attempt the INSERT. Postgres
-- resolves the actual row-level conflict for you -- one transaction
-- blocks on the unique constraint until the other commits -- but it
-- does NOT re-run the PL/pgSQL function body for the blocked
-- transaction when it unblocks. The blocked transaction's ON CONFLICT
-- DO UPDATE SET clause fires using EXCLUDED values that were already
-- computed from the STALE pre-block snapshot. Concretely: a legitimate
-- delivery order can be wrongly rejected with a false "oversell" 409,
-- because its oversell check ran against added_stock=0 (the row didn't
-- exist yet from its point of view) even though the racing till save's
-- added_stock=20 was, by the time the order's INSERT actually applied,
-- already the real committed state.
--
-- (This is a false-REJECTION bug, not silent data corruption or a lost
-- write -- the safer of the two possible failure directions -- but it's
-- still a real correctness defect: a staff member's legitimate order
-- can fail with a wrong "not enough stock" message.)
--
-- THE FIX: take a Postgres transaction-scoped advisory lock keyed on
-- (item_id, location, entry_date) at the very start of each function,
-- before any read. pg_advisory_xact_lock blocks the SECOND caller until
-- the first caller's transaction fully commits (or rolls back) and
-- releases the lock automatically -- so the second caller's own SELECT
-- (which runs immediately after acquiring the lock) is guaranteed to
-- see the first caller's already-committed row, not a stale snapshot.
-- This serializes the whole read-decide-write sequence per row, not
-- just the final INSERT's conflict resolution.
--
-- advisory locks take a bigint key; hashtext() + a fixed salt combines
-- item_id/location/entry_date into one lock key with negligible
-- collision risk for this table's realistic key space. Using
-- pg_advisory_xact_lock (not the session-scoped variant) means no
-- explicit unlock is needed -- it releases automatically when the
-- calling function's transaction ends, exactly matching the existing
-- "one function call = one transaction" model these functions already
-- rely on.
-- ============================================================

create or replace function public.lock_stock_entry_row(
  p_item_id uuid,
  p_location location_type,
  p_entry_date date
)
returns void
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_item_id::text || '|' || p_location::text || '|' || p_entry_date::text, 0));
end;
$$;

create or replace function public.save_stock_entry(
  p_item_id uuid,
  p_location location_type,
  p_entry_date date,
  p_till_quantity_sold numeric,
  p_added_stock numeric,
  p_sent_out numeric,
  p_wastage numeric,
  p_selling_price_snapshot numeric,
  p_buying_price_snapshot numeric,
  p_created_by uuid,
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
  v_row public.stock_entries;
begin
  perform public.lock_stock_entry_row(p_item_id, p_location, p_entry_date);

  select closing_stock into v_opening_stock
  from public.stock_entries
  where item_id = p_item_id
    and location = p_location
    and entry_date < p_entry_date
  order by entry_date desc
  limit 1;

  v_opening_stock := coalesce(v_opening_stock, 0);
  v_total_stock := v_opening_stock + p_added_stock;

  select coalesce(sum(oi.quantity), 0) into v_order_total
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.item_id = p_item_id
    and o.location = p_location
    and o.order_date = p_entry_date;

  v_quantity_sold := p_till_quantity_sold + v_order_total;

  if p_sent_out + v_quantity_sold + p_wastage > v_total_stock then
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
    p_till_quantity_sold, v_quantity_sold, p_wastage, p_wastage_note,
    p_selling_price_snapshot, p_buying_price_snapshot,
    v_total_stock - p_sent_out - v_quantity_sold - p_wastage,
    v_quantity_sold * p_selling_price_snapshot,
    v_quantity_sold * p_buying_price_snapshot,
    (v_total_stock - p_sent_out - v_quantity_sold - p_wastage) * p_buying_price_snapshot,
    p_wastage * p_buying_price_snapshot,
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

create or replace function public.save_canteen_stock_entry(
  p_item_id uuid,
  p_entry_date date,
  p_is_canteen_supplied boolean,
  p_added_stock_input numeric,
  p_till_quantity_sold numeric,
  p_wastage numeric,
  p_selling_price_snapshot numeric,
  p_buying_price_snapshot numeric,
  p_created_by uuid,
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
  v_row public.stock_entries;
begin
  perform public.lock_stock_entry_row(p_item_id, 'canteen', p_entry_date);

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

  select coalesce(sum(oi.quantity), 0) into v_order_total
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.item_id = p_item_id
    and o.location = 'canteen'
    and o.order_date >= p_entry_date
    and o.order_date <= v_week_end;

  v_quantity_sold := p_till_quantity_sold + v_order_total;

  if v_quantity_sold + p_wastage > v_total_stock then
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
    p_till_quantity_sold, v_quantity_sold, p_wastage, p_wastage_note,
    p_selling_price_snapshot, p_buying_price_snapshot,
    v_total_stock - v_quantity_sold - p_wastage,
    v_quantity_sold * p_selling_price_snapshot,
    v_quantity_sold * p_buying_price_snapshot,
    (v_total_stock - v_quantity_sold - p_wastage) * p_buying_price_snapshot,
    p_wastage * p_buying_price_snapshot,
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

  if v_sent_out + v_quantity_sold + v_wastage > v_total_stock then
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
    v_total_stock - v_sent_out - v_quantity_sold - v_wastage,
    v_quantity_sold * p_selling_price_snapshot,
    v_quantity_sold * p_buying_price_snapshot,
    (v_total_stock - v_sent_out - v_quantity_sold - v_wastage) * p_buying_price_snapshot,
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
