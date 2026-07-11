-- ============================================================
-- Fix: stock_insert_scoped (and ingredient_entries' insert policy) had
-- no date restriction at all -- only the UPDATE-path policies
-- (20260711120001, 20260711150001) constrain entry_date to "today" (or
-- "this week," for canteen). Since save_stock_entry()/
-- save_canteen_stock_entry() upsert, a *first-ever* save for a given
-- item+location+date goes through the INSERT branch, which was
-- completely unguarded -- a client could write an entry for any
-- arbitrary past or future date/week, not just the current period.
--
-- Found live-testing Phase 5's canteen flow (see
-- docs/phases/phase5_context.md): POSTing entry_date=2026-07-14 (a
-- future Monday, computed from an arbitrary future date the client
-- sent) against Anne's canteen account succeeded with HTTP 200, because
-- stock_insert_scoped only checked location, never entry_date. This is
-- the INSERT-side sibling of the same "staff can't edit past/future
-- entries" gap the UPDATE-path migrations already closed for the
-- re-save case -- it went unexercised until now because Phase 4's UI
-- only ever sends "today," never a manufactured date.
--
-- Fix: both stock_entries and ingredient_entries' INSERT policies now
-- require entry_date to fall in the current writable period (today, or
-- this week's Monday for a canteen row), same rule the UPDATE policies
-- already enforce, admin exempted as always.
-- ============================================================

drop policy "stock_insert_scoped" on public.stock_entries;

create policy "stock_insert_current_period_scoped" on public.stock_entries
  for insert with check (
    created_by = auth.uid()
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

drop policy "ingredient_entries_insert_restaurant" on public.ingredient_entries;

create policy "ingredient_entries_insert_current_day_restaurant" on public.ingredient_entries
  for insert with check (
    created_by = auth.uid()
    and (
      public.is_admin()
      or (public.my_location() = 'restaurant' and entry_date = current_date)
    )
  );
