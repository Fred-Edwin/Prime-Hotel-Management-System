-- ============================================================
-- Post-launch redesign of /entry's store-manager view (docs/backlog/
-- entry-store-manager-redesign-handover.md): "Added stock"/"Sent to
-- canteen" move from the batch Save-button flow to per-field autosave,
-- same pattern as /store's PUT /api/ingredient-entries
-- (20260716090000_ingredient_entry_row_locking.sql).
--
-- WHY NOT JUST CALL save_stock_entry()?
-- save_stock_entry() is a full-row-overwrite function (docs/01_DATA_MODEL.md
-- §3.4): its ON CONFLICT DO UPDATE always sets till_quantity_sold =
-- excluded.till_quantity_sold, unconditionally, because its one existing
-- caller (the till-entry batch save) sends the day's absolute stepper
-- value every time and only one person edits a location's till sheet on
-- a given day. That assumption breaks for a third caller: if this
-- autosave route fetched the row, read till_quantity_sold, and passed
-- it straight back into save_stock_entry(), a till save landing between
-- that read and this write would be silently reverted -- a real lost
-- update, not just a theoretical one, since a store manager editing
-- "Sent to canteen" and a cashier logging till sales are exactly the
-- kind of two-people-same-row-same-day scenario this system already
-- has to handle (§3.4's own opening paragraph).
--
-- THE FIX: a dedicated partial-update function, mirroring how
-- apply_order_to_stock_entry() already solves the identical problem for
-- orders -- preserve every field this call doesn't own (till_quantity_sold,
-- wastage, wastage_note) by reading them from the existing row (or
-- defaulting a brand-new row to 0/null), and only ever write
-- added_stock/sent_out. Locked via the same lock_stock_entry_row()
-- advisory lock already used by save_stock_entry()/
-- save_canteen_stock_entry()/apply_order_to_stock_entry(), so this
-- becomes a fourth safely-serialized writer on the same row, not a new
-- race.
--
-- wastage/wastage_note are hardcoded to 0/null for a brand-new row here
-- (matching PUT /api/ingredient-entries' precedent) because /entry no
-- longer collects wastage at all as of this same redesign -- see the
-- Phase 10 correction to §3.3/§00_ARCHITECTURE.md §12. An existing row's
-- wastage (e.g. set via the admin ledger direct-edit path) is preserved
-- unchanged, never zeroed by this function.
-- ============================================================

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

  if p_sent_out + v_quantity_sold + v_wastage > v_total_stock then
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
    v_total_stock - p_sent_out - v_quantity_sold - v_wastage,
    v_quantity_sold * p_selling_price_snapshot,
    v_quantity_sold * p_buying_price_snapshot,
    (v_total_stock - p_sent_out - v_quantity_sold - v_wastage) * p_buying_price_snapshot,
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
