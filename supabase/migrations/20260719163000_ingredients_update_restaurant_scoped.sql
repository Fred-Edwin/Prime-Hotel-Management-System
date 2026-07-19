-- ============================================================
-- Fix: record_ingredient_purchase() silently failed to update
-- ingredients.buying_price when called by the store manager.
--
-- Discovered manually testing the ingredient purchases feature
-- (docs/01_DATA_MODEL.md §3.2's "Purchases" section,
-- 20260719161000_ingredient_purchases.sql): record_ingredient_purchase()
-- is `security invoker` (this project's standing convention for all
-- write functions, see phase9_context.md), so its
-- `update public.ingredients set buying_price = ...` runs as whichever
-- user called it. ingredients_admin_update only allowed is_admin(), so
-- when the store manager (not admin) logged a purchase, that UPDATE
-- silently matched zero rows under RLS -- no error, the purchase and
-- ingredient_entries.buying_price_snapshot still saved correctly, but
-- the ingredients.buying_price catalog figure never moved. Confirmed
-- directly: two purchases logged as Janiffer Maina (store manager) at
-- different unit costs left ingredients.buying_price completely
-- unchanged (stale updated_at from hours earlier), even though
-- ingredient_entries.buying_price_snapshot correctly showed the fresh
-- weighted average both times.
--
-- Fix: widen ingredients' UPDATE policy to match the same
-- restaurant-location shape already used by ingredient_entries/
-- ingredient_purchases (01_DATA_MODEL.md §4), rather than making
-- record_ingredient_purchase() security definer -- that would break
-- this project's deliberate security-invoker convention for write
-- functions. Admin's manual price edits on /ingredients are
-- unaffected; this only adds a second, restaurant-scoped path that
-- was already implicitly expected to exist by the purchases feature.
-- ============================================================

drop policy "ingredients_admin_update" on public.ingredients;

create policy "ingredients_admin_or_restaurant_update" on public.ingredients
  for update using (
    public.is_admin() or public.my_location() = 'restaurant'
  );
