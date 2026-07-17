-- ============================================================
-- Fix: same-location staff blocked each other from saving stock
-- entries on the same item/day.
--
-- Found while manually testing the store-manager /entry screens
-- (2026-07-17): stock_update_admin_or_current_period_owner's
-- `created_by = auth.uid()` clause means whichever restaurant staffer's
-- write creates today's row for an item becomes its sole owner --
-- every OTHER staffer at that same location (store manager vs.
-- cashier, or cashier vs. cashier) is then blocked with a raw RLS
-- 403 from updating that same row for the rest of the day, even
-- though docs/01_DATA_MODEL.md §3.4/§5.5 explicitly design for the
-- store manager's added_stock/sent_out autosave and any cashier's
-- till-sale save to land on the same row. Reproduced via the real
-- app API in scripts/acceptance/post-launch-stock-entry-multi-writer-
-- rls.mjs (Janiffer-then-Sarah, and Sarah-then-Mercy both wrongly
-- 403'd).
--
-- Fix: an "owner" for UPDATE purposes is now any staffer scoped to
-- the row's own location (matching stock_insert_current_period_scoped's
-- existing `location = my_location()` check), not just the row's
-- original created_by. created_by itself is untouched -- it still
-- records whoever's write actually created the row; it just stops
-- being the gate on who else may update it. Historical (prior-
-- period) entries remain admin-only-editable, exactly as before --
-- only same-day (or same-week, for canteen) rows are affected.
-- ============================================================

drop policy "stock_update_admin_or_current_period_owner" on public.stock_entries;

create policy "stock_update_admin_or_current_period_location" on public.stock_entries
  for update using (
    public.is_admin()
    or (
      location = public.my_location()
      and (
        entry_date = current_date
        or (location = 'canteen' and entry_date = date_trunc('week', current_date)::date)
      )
    )
  );
