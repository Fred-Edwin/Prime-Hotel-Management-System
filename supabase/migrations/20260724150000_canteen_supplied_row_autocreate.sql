-- ============================================================
-- Fix: canteen_supplied items' added_stock silently never persisted
-- unless canteen staff also touched that exact item that day.
--
-- Bug report (WaPrecious, 2026-07-24): "store manager has been sending
-- to canteen the whole week but on the canteen side, the values aren't
-- reflecting." Confirmed via direct SQL against prime-hotel-demo: every
-- canteen_supplied item/day where the restaurant recorded sent_out > 0
-- had NO corresponding canteen stock_entries row at all, for every date
-- checked except the current day (and even then, only for items Anne
-- had also separately touched that day).
--
-- ROOT CAUSE: the restaurant's sent_out writers
-- (save_stock_entry_store_manager_fields() -- the live per-field
-- autosave Janiffer actually uses -- and save_stock_entry(), the
-- legacy/batch path) only ever write the RESTAURANT row. Nothing
-- creates or updates the mirrored CANTEEN row for that same item/date.
-- The canteen row only comes into existence when canteen staff (Anne)
-- independently saves something for that exact item on /entry that
-- day, via save_stock_entry_canteen_field() -- which is the only
-- writer that knows how to insert-or-update a canteen row.
--
-- Anne's own /entry screen masked this: GET /api/stock-entries
-- (app/api/stock-entries/route.ts) always live-computes
-- canteen_supplied_totals_batch() for display, regardless of whether a
-- row exists yet, so what Anne SEES on a fresh page load already looks
-- correct. But nothing persists that live-computed number unless she
-- also autosaves a field on that row -- so anything reading the stored
-- column instead of recomputing live (the admin Item Ledger's
-- dashboard_item_ledger(), and the historical-edit cascade below) sees
-- nothing for any item/day Anne didn't separately touch. Items canteen
-- stocks but doesn't sell/log daily (stationery/retail lines like Blue
-- Forms, Photocopy, Envelops in the reported data) are the ones most
-- likely to be silently dropped entirely.
--
-- The existing historical-edit cascade (recompute_stock_entry_cascade(),
-- 20260720100000_historical_ledger_edit_cascade.sql) has the identical
-- gap: it only UPDATEs a canteen row that already exists for the edited
-- date, never creates one. docs/01_DATA_MODEL.md §3.1 even (incorrectly)
-- documented this as expected: "but only when the canteen row is itself
-- (re)saved" -- that phrasing is corrected below now that it's fixed.
--
-- FIX: reuse save_stock_entry_canteen_field() itself (already the one
-- function that knows how to insert-or-update a canteen row correctly,
-- deriving added_stock from canteen_supplied_total()) as a mirror-sync
-- call from every restaurant sent_out writer, and from the cascade.
-- No new insert-or-update logic duplicated -- just wiring the existing
-- canteen upsert into the restaurant write paths that were missing it.
-- ============================================================

-- ----------------------------------------------------------------
-- 1. save_stock_entry_store_manager_fields() -- the live autosave path
--    (Janiffer's "Added stock"/"Sent to canteen" fields on /entry).
--    This is the one that matters most: it's what actually runs every
--    time the store manager records a delivery to canteen today.
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
  v_supply_type item_supply_type;
  v_canteen_selling_price numeric(10,2);
  v_canteen_buying_price numeric(10,2);
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

  -- NEW: mirror this sent_out into canteen's own row for the same item/
  -- date, regardless of whether canteen staff have touched it yet.
  -- save_stock_entry_canteen_field() already knows how to insert-or-
  -- update a canteen row and correctly re-derives added_stock from
  -- canteen_supplied_total() -- reused as-is, not duplicated.
  --
  -- Wrapped in its own exception handler: this call can only ever raise
  -- 'oversell' (added_stock here can only go up or stay level as more
  -- gets sent -- it never shrinks canteen's available stock), and only
  -- if canteen's OWN recorded consumption for this item/day already
  -- exceeded the true total before this fix existed (a pre-existing,
  -- previously-masked data problem, not something this save caused). A
  -- canteen-side bookkeeping issue must not block the store manager's
  -- own save, which she has no way to fix from her screen -- so this
  -- logs a warning (visible in Postgres logs for the admin to
  -- investigate) and leaves the canteen row as it was, rather than
  -- rolling back the restaurant write that triggered it.
  if p_location = 'restaurant' then
    select supply_type into v_supply_type from public.items where id = p_item_id;

    if v_supply_type = 'canteen_supplied' then
      select selling_price, buying_price into v_canteen_selling_price, v_canteen_buying_price
      from public.items where id = p_item_id;

      begin
        perform public.save_stock_entry_canteen_field(
          p_item_id := p_item_id,
          p_entry_date := p_entry_date,
          p_is_canteen_supplied := true,
          p_selling_price_snapshot := v_canteen_selling_price,
          p_buying_price_snapshot := v_canteen_buying_price,
          p_created_by := p_created_by
        );
      exception when others then
        raise warning 'canteen mirror sync skipped for item % on %: %', p_item_id, p_entry_date, sqlerrm;
      end;
    end if;
  end if;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------
-- 2. save_stock_entry() -- restaurant batch/legacy save. Same mirror
--    call, for consistency with the autosave path above (this function
--    is still reachable via the batch POST /api/stock-entries route).
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
  v_supply_type item_supply_type;
  v_canteen_selling_price numeric(10,2);
  v_canteen_buying_price numeric(10,2);
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

  -- NEW: same mirror-sync as save_stock_entry_store_manager_fields() above,
  -- with the same non-fatal exception handling (see that function's
  -- comment for why an oversell here must not roll back this save).
  if p_location = 'restaurant' then
    select supply_type into v_supply_type from public.items where id = p_item_id;

    if v_supply_type = 'canteen_supplied' then
      select selling_price, buying_price into v_canteen_selling_price, v_canteen_buying_price
      from public.items where id = p_item_id;

      begin
        perform public.save_stock_entry_canteen_field(
          p_item_id := p_item_id,
          p_entry_date := p_entry_date,
          p_is_canteen_supplied := true,
          p_selling_price_snapshot := v_canteen_selling_price,
          p_buying_price_snapshot := v_canteen_buying_price,
          p_created_by := p_created_by
        );
      exception when others then
        raise warning 'canteen mirror sync skipped for item % on %: %', p_item_id, p_entry_date, sqlerrm;
      end;
    end if;
  end if;

  return v_row;
end;
$$;

-- ----------------------------------------------------------------
-- 3. recompute_stock_entry_cascade() -- historical admin edit path.
--    Same gap: previously only UPDATEd a canteen row if one already
--    existed for the edited date. Now upserts via
--    save_stock_entry_canteen_field() so an admin backdating/editing a
--    restaurant sent_out value correctly creates the canteen row too,
--    not just corrects one that happened to already exist.
-- ----------------------------------------------------------------
-- p_created_by added: needed when this cascade must INSERT a canteen row
-- that never existed (the fix below), since stock_entries.created_by is
-- not null. Callers must now pass the acting admin's user id — see
-- app/api/dashboard/ledger/entry/route.ts's call site update.
create or replace function public.recompute_stock_entry_cascade(
  p_item_id uuid,
  p_edited_location location_type,
  p_edited_from_date date,
  p_created_by uuid default null
)
returns setof public.stock_entries
language plpgsql
security invoker
as $$
declare
  v_supply_type item_supply_type;
  v_selling_price numeric(10,2);
  v_buying_price numeric(10,2);
  v_date record;
  v_synced public.stock_entries;
begin
  return query select * from public.recompute_stock_entry_chain(p_item_id, p_edited_location, p_edited_from_date);

  if p_edited_location = 'restaurant' then
    select supply_type, selling_price, buying_price
    into v_supply_type, v_selling_price, v_buying_price
    from public.items where id = p_item_id;

    if v_supply_type = 'canteen_supplied' then
      -- Every restaurant day from the edited date onward that actually
      -- has a row needs its canteen mirror synced -- not just days that
      -- already have a canteen row (that was the bug: an edit to a
      -- day canteen never touched silently skipped it entirely).
      for v_date in
        select entry_date from public.stock_entries
        where item_id = p_item_id
          and location = 'restaurant'
          and entry_date >= p_edited_from_date
        order by entry_date
      loop
        -- save_stock_entry_canteen_field() locks this row itself, first
        -- thing it does -- no need to lock again here.
        select * into v_synced from public.save_stock_entry_canteen_field(
          p_item_id := p_item_id,
          p_entry_date := v_date.entry_date,
          p_is_canteen_supplied := true,
          p_selling_price_snapshot := v_selling_price,
          p_buying_price_snapshot := v_buying_price,
          p_created_by := coalesce(p_created_by, auth.uid())
        );

        return query select * from public.recompute_stock_entry_chain(p_item_id, 'canteen', v_date.entry_date);
      end loop;
    end if;
  end if;
end;
$$;
