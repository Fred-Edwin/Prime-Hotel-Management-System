-- ============================================================
-- Phase 9 — soft-deactivate for public.users.
--
-- /staff (Phase 3) was create-only: no way to fix a mistake, change a
-- role/location, reset a forgotten PIN, or remove a departed staff
-- member without direct DB access. Hard-delete is unsafe here: unlike
-- items/ingredients/delivery_locations (which already use a soft
-- `active` flag for exactly this reason -- see 01_DATA_MODEL.md §5),
-- public.users has no ON DELETE CASCADE/SET NULL from
-- stock_entries.created_by / ingredient_entries.created_by /
-- expenses.created_by / orders.created_by -- a hard delete would either
-- fail on the FK (if any row references this user) or, if it were ever
-- changed to CASCADE, silently blow away historical entries. A boolean
-- flag, checked at login, is the correct fix: deactivated staff can no
-- longer sign in, but every past entry they created keeps its correct
-- attribution untouched.
-- ============================================================

alter table public.users
  add column active boolean not null default true;

comment on column public.users.active is
  'Soft-deactivate flag (Phase 9). A deactivated account cannot log in (checked in app/api/auth/login/route.ts before the Supabase Auth sign-in attempt), but historical stock_entries/ingredient_entries/expenses/orders.created_by references remain valid and unchanged -- never hard-delete a users row.';
