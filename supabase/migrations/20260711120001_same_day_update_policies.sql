-- ============================================================
-- Fix: staff couldn't re-save today's own stock/ingredient entry.
--
-- save_stock_entry()/save_ingredient_entry() (see
-- 20260711100001_entry_write_functions.sql) upsert via
-- `insert ... on conflict do update`. The first save of a day hits the
-- INSERT path (allowed by stock_insert_scoped/ingredient_entries_insert_
-- restaurant), but any RE-save the same day (correcting a stepper tap,
-- adding wastage after the fact) hits the UPDATE path, which the
-- original *_update_admin_only policies blocked for everyone but admin
-- -- surfaced as a raw "new row violates row-level security policy"
-- error with no context.
--
-- The data model's actual intent (01_DATA_MODEL.md §4) is that staff
-- can't edit PAST entries, not that they can never update their own
-- row. This replaces the blanket admin-only UPDATE policy with one that
-- also allows the creator to update their own row on the SAME day
-- (entry_date = current_date, checked server-side via now()::date, not
-- client-suppliable). Historical (prior-day) entries remain
-- admin-only-editable, exactly as before.
-- ============================================================

drop policy "stock_update_admin_only" on public.stock_entries;

create policy "stock_update_admin_or_same_day_owner" on public.stock_entries
  for update using (
    public.is_admin()
    or (created_by = auth.uid() and entry_date = current_date)
  );

drop policy "ingredient_entries_update_admin_only" on public.ingredient_entries;

create policy "ingredient_entries_update_admin_or_same_day_owner" on public.ingredient_entries
  for update using (
    public.is_admin()
    or (created_by = auth.uid() and entry_date = current_date)
  );
