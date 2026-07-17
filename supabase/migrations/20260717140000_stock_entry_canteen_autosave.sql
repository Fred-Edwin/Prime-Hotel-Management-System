-- ============================================================
-- Post-launch redesign of /entry's canteen view (CanteenEntryClient.tsx):
-- "Added stock" (canteen_independent items only) and "Quantity sold"
-- (every item) move from the batch Save-button flow to per-field
-- autosave, mirroring the restaurant's store-manager/cashier autosaves
-- (20260717090000, 20260717130000) and /store's PUT /api/ingredient-entries.
--
-- WHY NOT JUST CALL save_canteen_stock_entry()?
-- save_canteen_stock_entry() is a full-row-overwrite function: it always
-- requires both p_added_stock_input and p_till_quantity_sold together,
-- and its ON CONFLICT DO UPDATE unconditionally sets both
-- added_stock/till_quantity_sold from its arguments. Its one existing
-- caller (the weekly batch save) sends both values together every time,
-- which was safe under that flow. But canteen's redesign has ONE person
-- (Anne) autosaving TWO fields independently, each on its own ~700ms
-- debounce timer -- if she edits "Quantity sold" and that PUT call reads
-- a stale added_stock (a snapshot from page load) and passes it straight
-- back into save_canteen_stock_entry(), a just-typed "Added stock" edit
-- landing in between would be silently reverted. This is the same
-- lost-update race §3.4 already documents for the restaurant's two
-- separate autosave writers -- it doesn't go away just because canteen's
-- two fields happen to be edited by the same person; two independent
-- debounce timers on two different inputs is still two independent
-- writes that can interleave.
--
-- THE FIX: a dedicated partial-update function, same shape as
-- save_stock_entry_store_manager_fields()/save_stock_entry_cashier_field():
-- reads whichever field this call doesn't own from the existing row (or
-- defaults a brand-new row to 0), and only ever writes the field it was
-- given. Takes BOTH p_till_quantity_sold and p_added_stock_input as
-- nullable ("omit to preserve") rather than two separate functions,
-- since unlike the restaurant's role-gated split, canteen has no RBAC
-- reason to keep them apart -- one person owns both fields, so one
-- function with two independently-optional parameters avoids duplicating
-- the shared opening-stock/order-total/oversell logic twice. The route
-- layer (putCanteenField()) still calls it once per debounced field edit,
-- always passing the other parameter as null.
--
-- For canteen_supplied items, added_stock is NEVER accepted from the
-- client at all (§3.1 -- it's always server-derived via
-- canteen_supplied_total()), so p_added_stock_input is ignored whenever
-- p_is_canteen_supplied is true, exactly like save_canteen_stock_entry().
--
-- THE TWO OVERSELL CASES (resolved design call, this session): a
-- canteen_supplied item's added_stock can be genuinely 0 not because
-- Anne did anything wrong, but because the restaurant hasn't sent this
-- week's supply yet (canteen_supplied_total() sums zero rows) -- an
-- external dependency on another actor entirely, analogous to (but not
-- identical to) the restaurant cashier's "store manager hasn't logged
-- today's added stock yet" case. canteen_independent items have no such
-- external dependency -- Anne owns both fields herself for those, so an
-- oversell there is a real oversell. Distinguished via two SQLSTATEs,
-- same pattern as save_stock_entry_cashier_field():
--   - errcode P0003 ("not yet supplied"): p_is_canteen_supplied is true,
--     added_stock (canteen_supplied_total()) is 0, and the requested
--     till_quantity_sold alone exceeds opening_stock. Not a real
--     oversell -- the restaurant simply hasn't sent anything this week.
--   - errcode P0001 ("oversell", same as every other writer): either a
--     canteen_independent item's combined total is insufficient, or a
--     canteen_supplied item where added_stock > 0 but the total still
--     isn't enough (the restaurant HAS sent something, just not enough).
-- ============================================================

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

  if v_quantity_sold + v_wastage > v_total_stock then
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
    v_total_stock - v_quantity_sold - v_wastage,
    v_quantity_sold * v_selling_price,
    v_quantity_sold * v_buying_price,
    (v_total_stock - v_quantity_sold - v_wastage) * v_buying_price,
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
