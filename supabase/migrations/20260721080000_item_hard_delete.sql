-- ============================================================
-- Item hard delete (post-launch client request, 2026-07-21).
--
-- Reverses the deactivate-only stance docs/01_DATA_MODEL.md §5 has held
-- for items/ingredients/delivery_locations since V1: "delivery_locations
-- follows the same admin-CRUD, soft-deactivate pattern as
-- items/ingredients... since past orders reference a zone." That
-- reasoning is still correct for ingredients/delivery_locations
-- (unchanged by this migration) — this is a deliberate, explicit
-- exception for items only, confirmed directly with the client after
-- flagging the consequence: deleting an item with real history
-- (stock_entries, orders, canteen_stock_purchases, staff_meal_entries)
-- permanently removes that history too, changing already-closed days'
-- Ledger/dashboard/profit figures retroactively. This is the opposite of
-- every other "never rewrite history" guarantee in this schema
-- (snapshotted prices, no soft-delete on stock_entries/expenses,
-- immutable purchases) — confirmed twice with the client before
-- building, not a default any future session should extend to another
-- table without the same explicit confirmation.
--
-- Cascade scope: every table with a not-null item_id FK and no existing
-- ON DELETE behavior — stock_entries, canteen_stock_purchases,
-- staff_meal_entries, order_items. order_items additionally requires
-- orders.total_amount to be corrected (recomputed from remaining lines)
-- or the whole orders row removed (if the deleted item was its only
-- line) — a plain FK cascade on order_items alone would leave a
-- now-wrong total_amount on the parent order, an orphaned receipt.
-- ============================================================

create policy "items_delete_admin" on public.items
  for delete using (public.is_admin());

create policy "stock_entries_delete_admin" on public.stock_entries
  for delete using (public.is_admin());

create policy "canteen_stock_purchases_delete_admin_item" on public.canteen_stock_purchases
  for delete using (public.is_admin());

create policy "staff_meal_entries_delete_admin" on public.staff_meal_entries
  for delete using (public.is_admin());

create policy "order_items_delete_admin" on public.order_items
  for delete using (public.is_admin());

create policy "orders_delete_admin" on public.orders
  for delete using (public.is_admin());

-- No new UPDATE policy needed for orders -- orders_update_admin_only
-- (20260710110003_rls_and_functions.sql) already grants admin
-- unconditional update access, which delete_item()'s total_amount
-- recompute below relies on.

-- item_delete_impact(p_item_id): read-only preview the confirm UI calls
-- before deleting — counts and total value of everything that will be
-- permanently removed, so the admin sees the real blast radius before
-- confirming, not after.
create or replace function public.item_delete_impact(p_item_id uuid)
returns table (
  stock_entries_count bigint,
  stock_entries_sales_value numeric,
  orders_affected_count bigint,
  orders_to_delete_count bigint,
  canteen_purchases_count bigint,
  canteen_purchases_value numeric,
  staff_meal_entries_count bigint
)
language sql
security invoker
stable
as $$
  select
    (select count(*) from public.stock_entries where item_id = p_item_id),
    (select coalesce(sum(sales_value), 0) from public.stock_entries where item_id = p_item_id),
    (select count(distinct order_id) from public.order_items where item_id = p_item_id),
    (
      select count(*) from public.orders o
      where exists (select 1 from public.order_items oi where oi.order_id = o.id and oi.item_id = p_item_id)
        and not exists (select 1 from public.order_items oi2 where oi2.order_id = o.id and oi2.item_id <> p_item_id)
    ),
    (select count(*) from public.canteen_stock_purchases where item_id = p_item_id),
    (select coalesce(sum(total_cost), 0) from public.canteen_stock_purchases where item_id = p_item_id),
    (select count(*) from public.staff_meal_entries where item_id = p_item_id);
$$;

-- delete_item(p_item_id): the single write path DELETE /api/items/[id]
-- calls. Admin-only, enforced by both the route (requireAdmin()) and
-- every DELETE policy above (security invoker, so a non-admin calling
-- this directly would still be blocked at each delete statement).
create or replace function public.delete_item(p_item_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  v_order record;
  v_remaining_total numeric(10,2);
begin
  if not exists (select 1 from public.items where id = p_item_id) then
    raise exception 'Item not found' using errcode = 'P0005';
  end if;

  delete from public.staff_meal_entries where item_id = p_item_id;
  delete from public.canteen_stock_purchases where item_id = p_item_id;
  delete from public.stock_entries where item_id = p_item_id;

  -- Every order that has a line for this item: remove that line, then
  -- either delete the whole order (if it had no other lines -- an
  -- orphaned receipt with a stale total_amount is worse than no receipt)
  -- or recompute total_amount from what's left (sum of remaining
  -- order_items' quantity * selling_price_snapshot, plus the order's
  -- own delivery_fee_snapshot -- same formula lib/calculations.ts's
  -- orderTotal() applies at write time, reapplied here since this is a
  -- direct SQL correction, not a new order submission).
  for v_order in
    select distinct o.id, o.delivery_fee_snapshot
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    where oi.item_id = p_item_id
  loop
    delete from public.order_items where order_id = v_order.id and item_id = p_item_id;

    if not exists (select 1 from public.order_items where order_id = v_order.id) then
      delete from public.orders where id = v_order.id;
    else
      select coalesce(sum(quantity * selling_price_snapshot), 0) into v_remaining_total
      from public.order_items
      where order_id = v_order.id;

      update public.orders
      set total_amount = v_remaining_total + v_order.delivery_fee_snapshot
      where id = v_order.id;
    end if;
  end loop;

  delete from public.items where id = p_item_id;
end;
$$;
