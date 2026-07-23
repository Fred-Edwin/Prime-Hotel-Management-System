-- ============================================================
-- Ingredient hard delete (post-launch client request, 2026-07-23).
--
-- Extends items' hard-delete exception (20260721080000_item_hard_delete.sql)
-- to ingredients, reversing docs/01_DATA_MODEL.md §5's prior stance that
-- "ingredients/delivery_locations are unaffected and remain
-- deactivate-only... don't extend items' hard-delete precedent to
-- either of those tables without the same explicit client confirmation."
-- That confirmation happened directly with WaPrecious, triggered by a
-- real incident: an ingredient called "Smokies" was mistakenly tracked
-- as both a menu item and a raw ingredient, and she wants the erroneous
-- ingredient row (and its two ingredient_entries rows) gone entirely,
-- not just deactivated. She understands and accepted the same
-- consequence items' exception already carries: deleting an ingredient
-- with real history permanently rewrites already-closed days'
-- Ledger/dashboard/profit figures.
--
-- Cascade scope: every table with a not-null ingredient_id FK --
-- ingredient_entries and ingredient_purchases. (staff_meal_entries
-- references items.id, not ingredients.id, so it's out of scope here --
-- confirmed by reading its schema in 20260719150000_staff_meal_entries.sql.)
-- Unlike delete_ingredient_purchase() (20260721060000_purchase_delete.sql),
-- which unwinds a single purchase and must replay/recompute what's left,
-- deleting the ingredient itself removes the whole ledger for it -- there
-- is nothing left to recompute forward, so this is a plain cascade
-- delete, no chain-recompute call needed.
-- ============================================================

create policy "ingredients_delete_admin" on public.ingredients
  for delete using (public.is_admin());

create policy "ingredient_entries_delete_admin" on public.ingredient_entries
  for delete using (public.is_admin());

create policy "ingredient_purchases_delete_admin_ingredient" on public.ingredient_purchases
  for delete using (public.is_admin());

-- ingredient_delete_impact(p_ingredient_id): read-only preview the
-- confirm UI calls before deleting -- counts and total value of
-- everything that will be permanently removed. Mirrors
-- item_delete_impact()'s shape, adapted to ingredients' narrower
-- cascade (no orders/staff_meal_entries involvement).
create or replace function public.ingredient_delete_impact(p_ingredient_id uuid)
returns table (
  ingredient_entries_count bigint,
  ingredient_entries_closing_value numeric,
  ingredient_purchases_count bigint,
  ingredient_purchases_value numeric
)
language sql
security invoker
stable
as $$
  select
    (select count(*) from public.ingredient_entries where ingredient_id = p_ingredient_id),
    (select coalesce(sum(closing_stock_value), 0) from public.ingredient_entries where ingredient_id = p_ingredient_id),
    (select count(*) from public.ingredient_purchases where ingredient_id = p_ingredient_id),
    (select coalesce(sum(total_cost), 0) from public.ingredient_purchases where ingredient_id = p_ingredient_id);
$$;

-- delete_ingredient(p_ingredient_id): the single write path
-- DELETE /api/ingredients/[id] calls. Admin-only, enforced by both the
-- route (requireAdmin()) and every DELETE policy above (security
-- invoker, so a non-admin calling this directly would still be blocked
-- at each delete statement).
create or replace function public.delete_ingredient(p_ingredient_id uuid)
returns void
language plpgsql
security invoker
as $$
begin
  if not exists (select 1 from public.ingredients where id = p_ingredient_id) then
    raise exception 'Ingredient not found' using errcode = 'P0005';
  end if;

  delete from public.ingredient_purchases where ingredient_id = p_ingredient_id;
  delete from public.ingredient_entries where ingredient_id = p_ingredient_id;
  delete from public.ingredients where id = p_ingredient_id;
end;
$$;
