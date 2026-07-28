-- ============================================================
-- Asset hard delete (client request, 2026-07-28 — "we need to
-- include a hard delete option as well in the assets table").
--
-- Extends items'/delivery_locations' hard-delete exception to assets.
-- Cascade scope: asset_events.asset_id is NOT nullable (unlike
-- orders.delivery_location_id), so there is no "keep the history,
-- clear the reference" option the way delivery_location's delete has
-- — deleting an asset deletes its full purchase/loss event history
-- too. Confirmed acceptable with the human: assets are a low-stakes
-- catalog compared to items (no sales/profit history depends on an
-- asset — only the asset register's own reporting figures,
-- dashboard_asset_purchases_total()/dashboard_asset_losses_total(),
-- which simply sum less once the deleted asset's events are gone).
-- ============================================================

create policy "assets_delete_admin" on public.assets
  for delete using (public.is_admin());

-- asset_delete_impact(p_asset_id): read-only preview the confirm UI
-- calls before deleting — how many events exist and their combined
-- purchase/loss value, so the admin sees the real blast radius
-- (this asset's own history disappearing) before confirming.
create or replace function public.asset_delete_impact(p_asset_id uuid)
returns table (
  events_affected_count bigint,
  events_total_value numeric
)
language sql
security invoker
stable
as $$
  select
    (select count(*) from public.asset_events where asset_id = p_asset_id),
    (select coalesce(sum(total_cost), 0) from public.asset_events where asset_id = p_asset_id);
$$;

-- delete_asset(p_asset_id): the single write path DELETE
-- /api/assets/[id] calls. Admin-only, enforced by both the route
-- (requireAdmin()) and the DELETE policy above (security invoker).
-- asset_events for this asset are removed first (no ON DELETE CASCADE
-- FK exists on asset_events.asset_id — see 20260728120000_assets.sql —
-- so this is an explicit delete, not a cascade the database performs
-- automatically) before the asset row itself.
create or replace function public.delete_asset(p_asset_id uuid)
returns void
language plpgsql
security invoker
as $$
begin
  if not exists (select 1 from public.assets where id = p_asset_id) then
    raise exception 'Asset not found' using errcode = 'P0005';
  end if;

  delete from public.asset_events where asset_id = p_asset_id;
  delete from public.assets where id = p_asset_id;
end;
$$;
