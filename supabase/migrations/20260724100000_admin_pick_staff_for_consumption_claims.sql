-- ============================================================
-- Admin can attribute a Ledger-authored staff meal / complimentary meal /
-- stock adjustment claim to a picked staff member, not always herself
-- (client feedback, 2026-07-24 -- see docs/01_DATA_MODEL.md §3.12's
-- correction). §3.12 originally hardcoded staff_id = created_by = the
-- admin's own id for every admin-authored claim; the client asked for a
-- real staff picker instead, since "who ate it" attribution is the whole
-- reason these are separate tables from stock_entries (§3.5).
--
-- All three tables share the identical original INSERT policy shape:
--   created_by = auth.uid() and staff_id = auth.uid()
--   and (is_admin() or location = my_location())
-- which hard-required self-attribution at the RLS layer, not just in
-- application code -- an admin insert with staff_id set to someone else
-- was rejected outright regardless of what the route did.
--
-- New rule: created_by must still always be the caller themselves (no
-- one can fabricate another user's authorship). staff_id must still equal
-- the caller for a staff member's own self-service claim (unchanged,
-- /expenses tabs), OR the caller may be admin, in which case staff_id can
-- be any user -- the route (app/api/dashboard/ledger/entry/route.ts)
-- narrows this further to "any active user at the claim's location", but
-- that's an application-layer nicety, not the RLS boundary; the real
-- boundary here is just "only admin gets to attribute a claim to someone
-- other than themselves."
-- ============================================================

drop policy "staff_meal_entries_insert_scoped" on public.staff_meal_entries;
create policy "staff_meal_entries_insert_scoped" on public.staff_meal_entries
  for insert with check (
    created_by = auth.uid()
    and (staff_id = auth.uid() or public.is_admin())
    and (public.is_admin() or location = public.my_location())
  );

drop policy "complimentary_meal_entries_insert_scoped" on public.complimentary_meal_entries;
create policy "complimentary_meal_entries_insert_scoped" on public.complimentary_meal_entries
  for insert with check (
    created_by = auth.uid()
    and (staff_id = auth.uid() or public.is_admin())
    and (public.is_admin() or location = public.my_location())
  );

drop policy "stock_adjustment_entries_insert_scoped" on public.stock_adjustment_entries;
create policy "stock_adjustment_entries_insert_scoped" on public.stock_adjustment_entries
  for insert with check (
    created_by = auth.uid()
    and (staff_id = auth.uid() or public.is_admin())
    and (public.is_admin() or location = public.my_location())
  );
