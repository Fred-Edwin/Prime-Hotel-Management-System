-- ============================================================
-- Fix: admin direct ledger-row editing (docs/backlog/04_admin_ledger_edit.md)
-- was rejected with a false "new row violates row-level security policy"
-- whenever the route edited an EXISTING stock_entries/ingredient_entries
-- row while correctly preserving the row's original created_by (a
-- deliberate design decision -- see docs/01_DATA_MODEL.md §3.4's "Admin
-- direct ledger-row edit" note -- the row's real-world author shouldn't
-- change just because admin corrected a number).
--
-- ROOT CAUSE: save_stock_entry()/save_canteen_stock_entry()/
-- save_ingredient_entry() upsert via `insert ... on conflict do update`.
-- Postgres re-validates the INSERT policy's WITH CHECK clause on the DO
-- UPDATE branch of ON CONFLICT too -- not just genuine inserts, and not
-- routed through the separate UPDATE policy at all. The CURRENT insert
-- policies (renamed by 20260711160001_insert_current_period_only.sql,
-- from the stock_insert_scoped/ingredient_entries_insert_restaurant
-- names docs/01_DATA_MODEL.md's reference SQL block still shows --
-- that doc's own §4 block had drifted from the real migrated schema,
-- corrected below) are:
--   stock_insert_current_period_scoped
--   ingredient_entries_insert_current_day_restaurant
-- Both require `created_by = auth.uid()` unconditionally, which is
-- correct for an ordinary staff save (staff can only ever write rows
-- attributed to themselves) but wrongly also applies to admin's edit
-- path, where p_created_by is deliberately the ORIGINAL staff author's
-- id, not the admin's own auth.uid().
--
-- FIRST ATTEMPT AT THIS FIX WAS WRONG: an earlier version of this
-- migration dropped/recreated policies literally named
-- "stock_insert_scoped"/"ingredient_entries_insert_restaurant" (the
-- stale names from the outdated doc), which no longer existed under
-- those names -- the DROP was a silent no-op and the CREATE added a
-- SECOND, more permissive policy alongside the real (renamed) one.
-- Postgres OR's multiple permissive policies together, so the new lax
-- policy alone was enough to let a future-dated write through, silently
-- reopening the exact date-scoping gap 20260711160001 had closed --
-- caught by re-running the full existing scripts/acceptance/*.mjs
-- regression suite after this change (phase5-canteen-expenses.mjs's
-- "future-dated canteen write rejected" check), not assumed safe.
-- Corrected here to target the real, currently-active policy names and
-- preserve their date-scoping logic unchanged, only widening the
-- created_by clause.
--
-- FIX: widen both policies' created_by clause to `created_by =
-- auth.uid() or public.is_admin()`, preserving every other clause
-- (location scoping, current-period date scoping) unchanged. This
-- preserves the property that a non-admin staff member can never
-- insert/upsert a row attributed to anyone but themselves, or write a
-- non-current-period row at all -- the `or public.is_admin()` branch
-- only ever applies when the caller is actually admin, and admin was
-- already exempted from the date-scoping clause before this change.
-- ============================================================

drop policy "stock_insert_current_period_scoped" on public.stock_entries;

create policy "stock_insert_current_period_scoped" on public.stock_entries
  for insert with check (
    (created_by = auth.uid() or public.is_admin())
    and (
      public.is_admin()
      or (
        location = public.my_location()
        and (
          entry_date = current_date
          or (location = 'canteen' and entry_date = date_trunc('week', current_date)::date)
        )
      )
    )
  );

drop policy "ingredient_entries_insert_current_day_restaurant" on public.ingredient_entries;

create policy "ingredient_entries_insert_current_day_restaurant" on public.ingredient_entries
  for insert with check (
    (created_by = auth.uid() or public.is_admin())
    and (
      public.is_admin()
      or (public.my_location() = 'restaurant' and entry_date = current_date)
    )
  );
