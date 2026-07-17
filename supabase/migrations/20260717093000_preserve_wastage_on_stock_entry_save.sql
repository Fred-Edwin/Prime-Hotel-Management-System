-- ============================================================
-- /entry no longer collects stock_entries.wastage from staff at all
-- (post-launch redesign, docs/backlog/entry-store-manager-redesign-handover.md
-- -- see also 20260717090000_stock_entry_store_manager_autosave.sql's
-- header for the store-manager side of the same change). Responsibility
-- for entering it moves to the admin ledger direct-edit path
-- (PATCH /api/dashboard/ledger/entry), mirroring the identical Phase 10
-- correction already made for ingredient_entries.wastage on /store.
--
-- THE PROBLEM this migration fixes: save_stock_entry() and
-- save_canteen_stock_entry() are full-row-overwrite functions --
-- p_wastage is written unconditionally into wastage/wastage_value on
-- every call (docs/01_DATA_MODEL.md §3.4's "split the column, never
-- overwrite" discipline was about till_quantity_sold/quantity_sold, not
-- wastage, so wastage never got the same treatment). If the till-entry
-- batch save route (app/api/stock-entries/route.ts, POST) simply stopped
-- sending a real wastage value and hardcoded p_wastage => 0, every
-- ordinary daily till save would silently zero out any wastage the
-- admin had previously set on that row via the ledger edit path -- a
-- real, silent data-loss bug, not just a UI simplification. Exactly the
-- failure mode the rest of this document exists to prevent.
--
-- THE FIX: p_wastage/p_wastage_note become optional (default null) on
-- both functions. null means "preserve whatever wastage/wastage_note
-- this row already has" (or 0/null for a brand-new row -- there's
-- nothing to preserve yet); a non-null value still fully overwrites, as
-- before. The till-entry save routes now omit p_wastage entirely
-- (preserve semantics). The admin ledger edit route
-- (app/api/dashboard/ledger/entry/route.ts) is UNCHANGED -- its Zod
-- schema requires a numeric wastage value, so it always sends a real
-- number and keeps setting wastage explicitly, exactly as before.
--
-- A SECOND, RELATED BUG FOUND WHILE VERIFYING THE ABOVE: save_stock_entry()
-- also unconditionally overwrites added_stock/sent_out on every call
-- (same "full row overwrite" shape as till_quantity_sold always had).
-- Before this redesign that was fine -- the restaurant batch save was
-- the ONLY writer of all three fields together, so there was nothing to
-- preserve. Now that the store-manager's added_stock/sent_out moved to
-- their own autosave route (PUT, via
-- save_stock_entry_store_manager_fields()), the regular-staff batch
-- save (POST, still calling save_stock_entry() for till_quantity_sold)
-- becomes a second, independent writer of the SAME row -- and its
-- client-side added_stock/sent_out values are a stale snapshot from
-- whenever that staff member's page loaded, not live data. A regular
-- staff member's ordinary "Save" tap can silently revert a store
-- manager's concurrent added_stock/sent_out edit back to that stale
-- snapshot -- confirmed live via a concurrent-write acceptance test
-- (both calls racing on a brand-new row: the store manager's autosave
-- committed added_stock=20, then the regular-staff batch save,
-- carrying its stale added_stock=0 from page load, would have
-- overwritten it back to 0 had this fix not been applied -- also
-- surfaced as a spurious 409 oversell rejection on the till side, since
-- the oversell check ran against the stale added_stock=0 instead of the
-- concurrently-committed 20).
--
-- SAME FIX, applied to p_added_stock/p_sent_out: both become optional
-- (default null) on save_stock_entry(); null means "preserve the row's
-- existing added_stock/sent_out" instead of overwriting. The
-- restaurant batch-save route (app/api/stock-entries/route.ts, POST)
-- now omits both from its payload for regular staff -- it only ever
-- owns till_quantity_sold. save_canteen_stock_entry() is NOT changed
-- this way: canteen has no store-manager concept and no sent_out field,
-- and added_stock there is either server-derived
-- (canteen_supplied_total()) or the one remaining manual field
-- (canteen_independent items) that canteen's own single save flow still
-- legitimately owns outright.
-- ============================================================

-- create or replace does NOT drop a function whose parameter list
-- changed shape (p_wastage/p_wastage_note moved from required to
-- trailing-optional here) -- it would otherwise leave the old signature
-- behind as a second overload, making every named-argument call
-- (exactly how the batch wrappers call these) ambiguous ("is not
-- unique"). Drop every existing overload of both functions explicitly
-- first, by type signature, so only the single new definition below
-- remains.
drop function if exists public.save_stock_entry(uuid, location_type, date, numeric, numeric, numeric, numeric, numeric, numeric, uuid, text);
drop function if exists public.save_stock_entry(uuid, location_type, date, numeric, numeric, numeric, numeric, numeric, uuid, numeric, text);
drop function if exists public.save_canteen_stock_entry(uuid, date, boolean, numeric, numeric, numeric, numeric, numeric, uuid, text);
drop function if exists public.save_canteen_stock_entry(uuid, date, boolean, numeric, numeric, numeric, numeric, uuid, numeric, text);

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
  v_existing public.stock_entries;
  v_row public.stock_entries;
begin
  perform public.lock_stock_entry_row(p_item_id, p_location, p_entry_date);

  -- Today's own row (if any) — sources "preserve" semantics for any of
  -- added_stock/sent_out/wastage/wastage_note the caller passed as null.
  -- Deliberately not the same row opening_stock comes from.
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
    p_item_id, p_location, p_entry_date,
    v_opening_stock, v_added_stock, v_sent_out,
    p_till_quantity_sold, v_quantity_sold, v_wastage, v_wastage_note,
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

  if v_quantity_sold + v_wastage > v_total_stock then
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
    v_total_stock - v_quantity_sold - v_wastage,
    v_quantity_sold * p_selling_price_snapshot,
    v_quantity_sold * p_buying_price_snapshot,
    (v_total_stock - v_quantity_sold - v_wastage) * p_buying_price_snapshot,
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
