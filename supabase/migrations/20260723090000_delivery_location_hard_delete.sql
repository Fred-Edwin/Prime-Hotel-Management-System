-- ============================================================
-- Delivery location hard delete (post-launch client request, 2026-07-23).
--
-- Extends items' hard-delete exception (20260721080000_item_hard_delete.sql)
-- to delivery_locations, reversing docs/01_DATA_MODEL.md §5/§6's prior
-- stance that delivery_locations "was not included in that exception and
-- stays deactivate-only." WaPrecious confirmed she wants real delete
-- available on this catalog too, same friction (impact preview +
-- type-to-confirm) as the safeguard.
--
-- Cascade scope: orders.delivery_location_id is the only FK into
-- delivery_locations, and — unlike items.id on order_items — it is
-- NULLABLE ("null for pickup", see 20260710110002_tables.sql). A past
-- order's delivery_fee_snapshot and total_amount are already frozen at
-- write time and don't reference the zone for their value, only for
-- display/reporting of which zone it was. So deleting a zone nulls out
-- delivery_location_id on any order that used it (the order becomes
-- indistinguishable from a pickup order in the zone column, but its
-- fee/total/history are untouched) rather than deleting or renumbering
-- any order — no order-line surgery like delete_item() needs.
-- ============================================================

create policy "delivery_locations_delete_admin" on public.delivery_locations
  for delete using (public.is_admin());

-- No new UPDATE policy needed for orders -- orders_update_admin_only
-- (20260710110003_rls_and_functions.sql) already grants admin
-- unconditional update access, which delete_delivery_location()'s
-- null-out below relies on.

-- delivery_location_delete_impact(p_delivery_location_id): read-only
-- preview the confirm UI calls before deleting -- how many past orders
-- reference this zone, and their total delivery-fee value, so the admin
-- sees the real (much smaller than items') blast radius before
-- confirming: those orders survive, only their zone reference is cleared.
create or replace function public.delivery_location_delete_impact(p_delivery_location_id uuid)
returns table (
  orders_affected_count bigint,
  orders_delivery_fee_value numeric
)
language sql
security invoker
stable
as $$
  select
    (select count(*) from public.orders where delivery_location_id = p_delivery_location_id),
    (select coalesce(sum(delivery_fee_snapshot), 0) from public.orders where delivery_location_id = p_delivery_location_id);
$$;

-- delete_delivery_location(p_delivery_location_id): the single write
-- path DELETE /api/delivery-locations/[id] calls. Admin-only, enforced
-- by both the route (requireAdmin()) and the DELETE/UPDATE policies
-- above (security invoker).
create or replace function public.delete_delivery_location(p_delivery_location_id uuid)
returns void
language plpgsql
security invoker
as $$
begin
  if not exists (select 1 from public.delivery_locations where id = p_delivery_location_id) then
    raise exception 'Delivery location not found' using errcode = 'P0005';
  end if;

  update public.orders
  set delivery_location_id = null
  where delivery_location_id = p_delivery_location_id;

  delete from public.delivery_locations where id = p_delivery_location_id;
end;
$$;
