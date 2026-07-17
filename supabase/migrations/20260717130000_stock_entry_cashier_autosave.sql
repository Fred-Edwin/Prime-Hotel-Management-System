-- ============================================================
-- Post-launch redesign of /entry's cashier (non-store-manager) view:
-- till_quantity_sold moves from a typed stepper + batch "Save" button
-- to per-field autosave, mirroring the store manager's
-- save_stock_entry_store_manager_fields() (20260717090000) and /store's
-- PUT /api/ingredient-entries.
--
-- WHY NOT JUST CALL save_stock_entry()?
-- save_stock_entry() is a full-row-overwrite function for
-- added_stock/sent_out too now (see 20260717093000's "preserve, don't
-- overwrite" fix) -- but it still requires the caller to pass (or omit,
-- for preserve semantics) all three of till_quantity_sold/added_stock/
-- sent_out together. A cashier's autosave route only ever owns
-- till_quantity_sold; if it called save_stock_entry() directly with
-- added_stock/sent_out omitted, that's fine (preserve semantics already
-- handle it) -- but it's cleaner and matches this codebase's existing
-- pattern (§3.4's fourth writer) to give the cashier's autosave its own
-- narrow function that can never touch added_stock/sent_out at all, not
-- even accidentally, and that can distinguish the two different
-- rejection cases below (save_stock_entry() cannot, since it's also
-- called by the batch POST path with a different oversell-diagnosis
-- need).
--
-- THE FIRST-WRITER OVERSELL BUG (docs/01_DATA_MODEL.md §3.4):
-- added_stock/sent_out are "preserve if not provided" as of Phase 10's
-- correction, meaning if a cashier is the first person of the day to
-- touch an item's row (no row yet, or a row with added_stock = 0),
-- total_stock = opening_stock + 0, and any till_quantity_sold > 0 gets
-- rejected as an oversell -- even though the cashier didn't do anything
-- wrong; the store manager just hasn't logged today's "Added stock" yet.
-- The rejection message reads as user error when it's actually a
-- data-ordering/timing issue invisible to the cashier.
--
-- THE FIX (chosen by the user, block-with-clear-message, not silent
-- allow-against-opening-stock-alone): this function distinguishes two
-- rejection cases with distinct SQLSTATEs, so the route/lib/errors.ts
-- layer can surface a correctly-diagnosed message for each:
--   - errcode P0002 ("not yet stocked"): added_stock is genuinely 0 for
--     today (no row yet, or a row exists with added_stock = 0) AND the
--     requested till_quantity_sold alone exceeds opening_stock. This is
--     the "nothing added yet today" case -- ask the store manager to log
--     added stock first, not a real oversell.
--   - errcode P0001 ("oversell", same as every other writer in this
--     file): added_stock > 0 (the store manager HAS logged something)
--     but the combined total still isn't enough. This is a genuine
--     oversell -- keep the existing generic message.
-- Same distinction is applied to the existing batch save_stock_entry()
-- callers by a route-handler-level pre-check (see
-- app/api/stock-entries/route.ts), since save_stock_entry() itself is
-- also called by canteen/admin-ledger paths where this exact framing
-- doesn't always apply cleanly -- kept as a route-level check there
-- instead of duplicating this function's SQL logic into
-- save_stock_entry() itself.
-- ============================================================

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

  if v_sent_out + v_quantity_sold + v_wastage > v_total_stock then
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
    v_total_stock - v_sent_out - v_quantity_sold - v_wastage,
    v_quantity_sold * p_selling_price_snapshot,
    v_quantity_sold * p_buying_price_snapshot,
    (v_total_stock - v_sent_out - v_quantity_sold - v_wastage) * p_buying_price_snapshot,
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
