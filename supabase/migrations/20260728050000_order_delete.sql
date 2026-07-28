-- ============================================================
-- Delete a whole order (client feedback, 2026-07-28: "Debtor's delete
-- was supposed to delete the debt. We currently just have reverse
-- payment" — 20260727110000_order_payment_delete.sql only let admin
-- remove one payment, not the debt itself. This is that follow-up: a
-- real, whole-order delete, distinct from and additional to the
-- existing payment delete.
--
-- CORRECTED same day (20260728051000_fix_order_delete_quantity_sold.sql):
-- this file's ORIGINAL delete_order() below assumed
-- recompute_stock_entry_cascade()/recompute_stock_entry_chain() would
-- re-derive quantity_sold from order_items the same way the ordinary
-- write paths do. That's wrong -- the cascade function was built for
-- historical LEDGER EDITS (§3.4), where quantity_sold is already
-- correctly set by whichever save_stock_entry*()/apply_order_to_
-- stock_entry() writer ran just before the cascade; the cascade only
-- re-derives opening_stock/closing_stock/values FROM whatever
-- quantity_sold/sent_out/wastage already sit on the row -- it never
-- re-sums order_items itself. Deleting an order's order_items therefore
-- left the affected row's quantity_sold/closing_stock/sales_value
-- stale until the follow-up migration explicitly recomputed
-- quantity_sold first. See that migration's own header for the fix and
-- how it was found (curl verification against a real credit order).
--
-- WHY THIS IS SAFE WITHOUT A MANUAL "UNWIND" (correct once
-- quantity_sold is explicitly recomputed, see the follow-up migration):
-- stock_entries.quantity_sold is never stored per-order — every writer
-- (§3.4) re-derives it as till_quantity_sold + sum(order_items for that
-- item/location/date) at write time. So deleting an order's order_items
-- (which happens automatically via `on delete cascade` when the parent
-- orders row is deleted, per the schema in 01_DATA_MODEL.md §2), then
-- explicitly recomputing quantity_sold the same way, then forcing the
-- standard stock_entries cascade recompute for closing_stock/values, is
-- sufficient to correctly remove the order's contribution -- same
-- "recompute, don't algebraically subtract" posture every other delete
-- in this file's sibling migrations already uses.
--
-- order_payments also cascade-deletes automatically (on delete cascade,
-- same schema) -- deleting an order with recorded payments removes
-- those payment records too. This was an explicit, confirmed choice
-- (not blocking the delete until payments are manually removed first)
-- -- the UI's confirmation step is responsible for warning the admin
-- how much payment history a given delete would remove, this function
-- doesn't gate on it.
--
-- Multiple items per order means potentially multiple item/location/
-- date cascades to run -- one per distinct item_id in the order's
-- order_items, all against the same location/date (an order is single-
-- location, single-date by construction). The affected item_ids are
-- captured into an array BEFORE the delete, since order_items rows for
-- this order no longer exist to query once the cascade fires. Same
-- atomic-rollback-on-downstream-oversell guarantee as every other
-- delete here: the recompute re-derives + re-checks each affected
-- item's chain unconditionally, so any resulting conflict rolls back
-- the whole delete.
--
-- Admin-only, both route (requireAdmin()) and RLS -- orders previously
-- had no delete policy at all (orders_select_scoped/orders_insert_scoped/
-- orders_update_admin_only only, 20260712121500-era schema).
-- ============================================================

drop policy if exists "orders_delete_admin" on public.orders;
create policy "orders_delete_admin" on public.orders
  for delete using (public.is_admin());

create or replace function public.delete_order(p_order_id uuid, p_created_by uuid default null)
returns void
language plpgsql
security invoker
as $$
declare
  v_order public.orders;
  v_item_ids uuid[];
  v_item_id uuid;
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
    perform public.recompute_stock_entry_cascade(
      v_item_id, v_order.location, v_order.order_date, coalesce(p_created_by, auth.uid())
    );
  end loop;
end;
$$;
