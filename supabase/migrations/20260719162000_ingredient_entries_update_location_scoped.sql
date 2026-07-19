-- ============================================================
-- Fix: same-location restaurant staff blocked each other from
-- co-writing an ingredient_entries row on the same day.
--
-- Same bug 20260717120000_stock_update_location_scoped.sql already
-- fixed for stock_entries, discovered here while acceptance-testing
-- the new ingredient purchases feature (20260719160000_ingredient_purchases.sql):
-- ingredient_entries_update_admin_or_same_day_owner gates same-day
-- UPDATE on `created_by = auth.uid()`, so whichever writer's INSERT
-- created today's row for an ingredient becomes its sole owner for
-- the rest of the day. record_ingredient_purchase() now lets BOTH
-- admin and the store manager log a purchase for the same
-- ingredient/day (see §3.2's "Purchases" section) -- each purchase
-- calls save_ingredient_entry(), whose ON CONFLICT DO UPDATE re-
-- validates this policy. A second purchase by a *different* writer
-- than whoever's purchase created the row was wrongly rejected with
-- a 403, even though both are legitimately restaurant staff/admin
-- allowed to write this table (confirmed via
-- scripts/acceptance/post-launch-ingredient-purchases.mjs Test 2:
-- admin's purchase created the row, the store manager's second
-- purchase the same day was rejected).
--
-- Fix: an "owner" for UPDATE purposes is now any staffer scoped to
-- the restaurant location (matching the INSERT policy's own
-- `my_location() = 'restaurant'` check), not just the row's original
-- created_by. created_by itself is untouched -- still records
-- whoever's write actually created the row. Historical (prior-day)
-- entries remain admin-only-editable, unchanged.
-- ============================================================

drop policy "ingredient_entries_update_admin_or_same_day_owner" on public.ingredient_entries;

create policy "ingredient_entries_update_admin_or_same_day_location" on public.ingredient_entries
  for update using (
    public.is_admin()
    or (
      public.my_location() = 'restaurant'
      and entry_date = current_date
    )
  );
