-- ============================================================
-- Expense categories become a real, admin-managed catalog, not a fixed
-- enum -- client request, 2026-07-21: WaPrecious wants to log/name her
-- own expense types (rent, salaries, water, ...), not be limited to
-- the four hardcoded values (electricity/gas/charcoal/other) shipped
-- at launch. Both roles share one catalog -- staff's /expenses picker
-- and admin's /dashboard/expenses picker both read from the same
-- table, same convention as items/ingredients (one shared catalog,
-- not two parallel lists).
--
-- Follows the exact ingredients/delivery_locations precedent: a
-- deactivate-only catalog (active boolean, no delete route), never
-- items' one-off hard-delete exception (20260721080000_item_hard_delete.sql
-- is a deliberate, narrow exception for that table only -- see its own
-- header comment -- not a pattern to extend here).
--
-- expenses.category (enum) -> expenses.category_id (FK, live reference,
-- same as stock_entries.item_id) -- see 01_DATA_MODEL.md's `items`
-- section for why only *price*, not the catalog FK itself, gets
-- snapshotted elsewhere. A category's name isn't snapshotted onto each
-- expense row: renaming "Charcoal" to "Fuel" should relabel every past
-- entry consistently, the same way renaming an item still shows its
-- new name on old stock_entries rows.
-- ============================================================

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index expense_categories_active_idx on public.expense_categories (active);

create trigger expense_categories_set_updated_at
  before update on public.expense_categories
  for each row execute function public.set_updated_at();

alter table public.expense_categories enable row level security;

-- Same triad as items/ingredients: everyone (staff + admin) can read
-- (staff need this to populate their own /expenses category picker),
-- only admin can write. No delete policy -- deactivate only.
create policy "expense_categories_select_all" on public.expense_categories
  for select using (true);
create policy "expense_categories_admin_write" on public.expense_categories
  for insert with check (public.is_admin());
create policy "expense_categories_admin_update" on public.expense_categories
  for update using (public.is_admin());

-- Backfill: one row per existing expense_category enum value, so
-- current data has somewhere to point once expenses.category_id exists.
insert into public.expense_categories (name) values
  ('Electricity'), ('Gas'), ('Charcoal'), ('Other');

-- Add the new column, backfill every existing expenses row from its
-- old enum value by name match, then swap it in.
alter table public.expenses add column category_id uuid references public.expense_categories(id);

update public.expenses e
set category_id = ec.id
from public.expense_categories ec
where lower(ec.name) = e.category::text;

alter table public.expenses alter column category_id set not null;
alter table public.expenses drop column category;

-- expense_category enum is now unused -- left in place rather than
-- dropped, in case anything outside this migration still references it
-- transiently; harmless to leave orphaned, matches how this codebase
-- has generally not bothered dropping now-unused enums after a
-- superseding change.

create index expenses_category_id_idx on public.expenses (category_id);

-- ============================================================
-- Admin-only delete for expenses (client request, 2026-07-21, same
-- session as the category catalog above). expenses_update_admin_only
-- already covers corrections in place; this adds outright removal for
-- a mistaken/duplicate entry. Unlike ingredient_purchases/
-- canteen_stock_purchases (20260721060000_purchase_delete.sql), an
-- expense has no derived side effect to unwind on delete -- it isn't
-- folded into a running weighted-average cost or a stock quantity,
-- only summed at read time by dashboard_expenses_summary() -- so a
-- plain RLS-gated `delete from` is sufficient, no companion RPC needed.
-- ============================================================
create policy "expenses_delete_admin_only" on public.expenses
  for delete using (public.is_admin());
