-- ============================================================
-- Admin-authored, business-wide expenses.
--
-- Client feedback (2026-07-21): her real Excel profit formula nets out
-- whole-business costs like rent and salaries, which today can only be
-- logged by staff and are always forced onto one location. Admin needs
-- to log expenses herself, and some of them (rent, salaries) aren't
-- restaurant- or canteen-specific at all.
--
-- `location_type` only has two values ('restaurant', 'canteen') — there
-- is no third "both" enum value, so we reuse the same convention already
-- established on public.users.location ("null = admin/all locations",
-- see 20260710110002_tables.sql) rather than inventing a new one.
-- expenses.location null = a business-wide cost, not attributed to
-- either location's own P&L split, but still subtracted from the
-- combined total.
-- ============================================================

alter table public.expenses
  alter column location drop not null;

-- expenses_insert_scoped already reads "public.is_admin() or location =
-- public.my_location()" — the is_admin() branch doesn't reference
-- location at all, so admin can already insert location = null or any
-- specific location. No RLS policy change needed for insert/select.

comment on column public.expenses.location is
  'restaurant or canteen; null = business-wide expense (e.g. rent, salaries), only insertable by admin.';

-- dashboard_expenses_summary already groups by e.location, and Postgres
-- groups null into its own bucket -- no function body change needed.
-- Re-declared here only so the migration is self-documenting about the
-- nullable location this function can now return; the route handler
-- (app/api/dashboard/summary/route.ts) is what actually needs updating
-- to stop silently dropping the null-location group from every total.
create or replace function public.dashboard_expenses_summary(
  p_from date,
  p_to date
)
returns table (
  location location_type,
  total_amount numeric
)
language sql
security invoker
stable
as $$
  select
    e.location,
    coalesce(sum(e.amount), 0) as total_amount
  from public.expenses e
  where e.expense_date >= p_from and e.expense_date <= p_to
  group by e.location;
$$;
