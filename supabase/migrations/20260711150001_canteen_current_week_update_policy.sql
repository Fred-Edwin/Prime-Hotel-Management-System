-- ============================================================
-- Fix: canteen staff could not re-save the current week's entry.
--
-- 20260711120001_same_day_update_policies.sql's
-- stock_update_admin_or_same_day_owner policy checks
-- `entry_date = current_date`, which is correct for the restaurant's
-- DAILY cadence (entry_date really is "today") but wrong for canteen's
-- WEEKLY cadence, where entry_date is always the Monday of the current
-- week (docs/01_DATA_MODEL.md §3.1), not today's date. A canteen staff
-- member correcting a stepper tap on any day of the current week other
-- than Monday itself hit this same UPDATE-path RLS gap that Phase 4's
-- restaurant fix (20260711120001) was meant to close for good -- found
-- live-testing Phase 5's same-week re-save scenario (see
-- docs/phases/phase5_context.md), the direct canteen analog of Phase 4's
-- "second save on the same day" bug.
--
-- Fix: a row counts as "owner-editable today" if either
--   (a) entry_date = current_date (daily/restaurant case), or
--   (b) entry_date = the Monday of the current week AND the row's
--       location is canteen (weekly case).
-- Uses date_trunc('week', current_date) rather than a hand-rolled
-- weekday calculation -- Postgres' date_trunc('week', ...) already
-- returns the Monday of the containing week (ISO week start), matching
-- lib/calculations.ts's weekStartMonday() convention exactly.
-- ============================================================

drop policy "stock_update_admin_or_same_day_owner" on public.stock_entries;

create policy "stock_update_admin_or_current_period_owner" on public.stock_entries
  for update using (
    public.is_admin()
    or (
      created_by = auth.uid()
      and (
        entry_date = current_date
        or (location = 'canteen' and entry_date = date_trunc('week', current_date)::date)
      )
    )
  );
