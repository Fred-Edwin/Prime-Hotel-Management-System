-- ============================================================
-- Fix: delete_order() never recomputed stock_entries.quantity_sold
-- after removing an order's order_items, so closing_stock/sales_value/
-- cost_value all stayed stale after a whole-order delete (found via
-- curl verification immediately after 20260728050000_order_delete.sql
-- was applied: deleted a 20-unit credit order, but the item's
-- quantity_sold/closing_stock/sales_value were unchanged afterward).
--
-- ROOT CAUSE: recompute_stock_entry_cascade()/recompute_stock_entry_chain()
-- (§3.4's historical-edit cascade, reused by every delete in §3.16) were
-- built for admin Ledger EDITS, where quantity_sold is already correct
-- by the time the cascade runs (the ordinary save_stock_entry*()/
-- apply_order_to_stock_entry() writer set it just before). The cascade
-- only re-derives opening_stock/closing_stock/sales_value/cost_value/
-- closing_stock_value FROM each row's existing quantity_sold/sent_out/
-- wastage -- it never re-sums order_items itself. delete_order()
-- deleted the order's order_items (via cascade) and then called the
-- stock_entries cascade expecting it to notice the missing order_items
-- and shrink quantity_sold accordingly -- it never does that, for any
-- caller, by design.
--
-- THE FIX: before calling the cascade, delete_order() now explicitly
-- recomputes each affected row's till_quantity_sold + order_items sum
-- (the exact same formula apply_order_to_stock_entry() etc. already
-- use) and writes it directly to quantity_sold, THEN calls
-- recompute_stock_entry_cascade() to re-derive closing_stock/values
-- from that corrected number -- same two-step shape the ordinary
-- writers use in one function, just split into two calls here since
-- the row already exists and only needs quantity_sold nudged, not a
-- full re-insert.
-- ============================================================

create or replace function public.delete_order(p_order_id uuid, p_created_by uuid default null)
returns void
language plpgsql
security invoker
as $$
declare
  v_order public.orders;
  v_item_ids uuid[];
  v_item_id uuid;
  v_till_quantity_sold numeric(10,2);
  v_order_total numeric(10,2);
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'unknown_entry: order not found' using errcode = 'P0007';
  end if;

  select array_agg(distinct item_id) into v_item_ids
  from public.order_items
  where order_id = p_order_id;

  -- Lock every distinct item this order touches at its own location/
  -- date up front, before deleting anything -- same discipline as every
  -- other delete in this schema, so a concurrent till save/order/
  -- store-manager write against the same item/day can't land mid-
  -- operation.
  foreach v_item_id in array coalesce(v_item_ids, array[]::uuid[])
  loop
    perform public.lock_stock_entry_row(v_item_id, v_order.location, v_order.order_date);
  end loop;

  -- Deletes order_items and order_payments too (on delete cascade,
  -- see 01_DATA_MODEL.md §2) -- no manual cleanup of either needed.
  delete from public.orders where id = p_order_id;

  foreach v_item_id in array coalesce(v_item_ids, array[]::uuid[])
  loop
    -- quantity_sold is never re-derived by the cascade below (see this
    -- migration's own header) -- explicitly recompute it here, the
    -- same formula every ordinary stock_entries writer already uses,
    -- BEFORE calling the cascade so closing_stock/values derive from
    -- the corrected number, not the stale one.
    select till_quantity_sold into v_till_quantity_sold
    from public.stock_entries
    where item_id = v_item_id and location = v_order.location and entry_date = v_order.order_date;

    if found then
      select coalesce(sum(oi.quantity), 0) into v_order_total
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.item_id = v_item_id
        and o.location = v_order.location
        and o.order_date = v_order.order_date;

      update public.stock_entries
      set quantity_sold = coalesce(v_till_quantity_sold, 0) + v_order_total
      where item_id = v_item_id and location = v_order.location and entry_date = v_order.order_date;
    end if;

    perform public.recompute_stock_entry_cascade(
      v_item_id, v_order.location, v_order.order_date, coalesce(p_created_by, auth.uid())
    );
  end loop;
end;
$$;
