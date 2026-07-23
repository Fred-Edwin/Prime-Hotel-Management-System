-- ============================================================
-- Expense category hard delete (post-launch client request, 2026-07-23).
--
-- Extends items' hard-delete exception (20260721080000_item_hard_delete.sql)
-- to expense_categories, reversing 20260721090000_expense_categories_catalog.sql's
-- stance that this catalog "follows the exact ingredients/delivery_locations
-- precedent: a deactivate-only catalog... never items' one-off hard-delete
-- exception... not a pattern to extend here." WaPrecious confirmed she
-- wants real delete on this catalog too, same friction (impact preview +
-- type-to-confirm) as items already has.
--
-- Cascade scope: expenses.category_id is the only FK into
-- expense_categories, and it is NOT NULL (set not null in
-- 20260721090000_expense_categories_catalog.sql) -- unlike
-- delivery_locations' nullable orders.delivery_location_id, there's no
-- "null it out" option here. Deleting a category therefore also deletes
-- every expenses row filed under it, same as delete_item() deletes
-- stock_entries: expenses.category_id has no derived value elsewhere
-- (no weighted-average cost, no stock quantity) to unwind, so this is a
-- plain cascade, no recompute needed -- matching expenses_delete_admin_only's
-- own existing "no derived side effect to unwind" reasoning
-- (20260721090000_expense_categories_catalog.sql's EXPENSES DELETE block).
-- ============================================================

create policy "expense_categories_delete_admin" on public.expense_categories
  for delete using (public.is_admin());

-- expenses_delete_admin_only (20260721090000_expense_categories_catalog.sql)
-- already grants admin unconditional delete on expenses -- reused as-is
-- by delete_expense_category() below, no new policy needed there.

-- expense_category_delete_impact(p_expense_category_id): read-only
-- preview the confirm UI calls before deleting -- count and total value
-- of every expense filed under this category, so the admin sees the
-- real blast radius before confirming.
create or replace function public.expense_category_delete_impact(p_expense_category_id uuid)
returns table (
  expenses_count bigint,
  expenses_value numeric
)
language sql
security invoker
stable
as $$
  select
    (select count(*) from public.expenses where category_id = p_expense_category_id),
    (select coalesce(sum(amount), 0) from public.expenses where category_id = p_expense_category_id);
$$;

-- delete_expense_category(p_expense_category_id): the single write path
-- DELETE /api/expense-categories/[id] calls. Admin-only, enforced by
-- both the route (requireAdmin()) and the DELETE policies (security
-- invoker).
create or replace function public.delete_expense_category(p_expense_category_id uuid)
returns void
language plpgsql
security invoker
as $$
begin
  if not exists (select 1 from public.expense_categories where id = p_expense_category_id) then
    raise exception 'Expense category not found' using errcode = 'P0005';
  end if;

  delete from public.expenses where category_id = p_expense_category_id;
  delete from public.expense_categories where id = p_expense_category_id;
end;
$$;
