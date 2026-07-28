-- ============================================================
-- Fix: asset_events_insert_scoped's 'loss' branch never bypassed
-- for admin, even though the policy's first clause
-- (created_by = auth.uid() or is_admin()) implies admin should be
-- able to log a loss for ANY asset, at any location.
--
-- Bug found live-testing on localhost (2026-07-28): admin
-- (WaPrecious) tried to log a loss against a restaurant-located
-- asset ("Spoons") and got a 403 -- Postgres error 42501, "new row
-- violates row-level security policy for table asset_events".
--
-- Root cause: the original policy's 'loss' arm
-- (20260728120000_assets.sql) was:
--   event_type = 'loss'
--   and exists (
--     select 1 from public.assets a
--     where a.id = asset_events.asset_id
--       and (a.location is null or a.location = public.my_location())
--   )
-- public.my_location() returns NULL for an admin account (admin has
-- no location, see 01_DATA_MODEL.md's users.location convention).
-- For a restaurant-located asset, `a.location is null` is false and
-- `a.location = public.my_location()` is `'restaurant' = null`,
-- which is NULL (not true) in SQL's three-valued logic -- so the
-- whole EXISTS is false and the insert is rejected, even though
-- admin should always be allowed to log a loss anywhere.
--
-- Fix: give the 'loss' arm the same is_admin() bypass every other
-- location check in this schema already has (see
-- assets_select_own_location_or_admin, asset_events_select_own_
-- location_or_admin, both already correctly is_admin()-first).
-- ============================================================

drop policy if exists "asset_events_insert_scoped" on public.asset_events;

create policy "asset_events_insert_scoped" on public.asset_events
  for insert with check (
    (created_by = auth.uid() or public.is_admin())
    and (
      (
        event_type = 'loss'
        and (
          public.is_admin()
          or exists (
            select 1 from public.assets a
            where a.id = asset_events.asset_id
              and (a.location is null or a.location = public.my_location())
          )
        )
      )
      or (
        event_type = 'purchase'
        and (public.is_admin() or public.my_location() = 'restaurant')
      )
    )
  );
