-- ============================================================
-- Fix: POST /api/ingredients silently failed under RLS when called
-- by the store manager, not admin.
--
-- Discovered manually testing the new inline "+ Add new ingredient"
-- flow on PurchaseModal (docs/01_DATA_MODEL.md §3.2's "Inline 'add
-- new' from the purchase form" section, added alongside this
-- migration): the route handler's own permission check
-- (canCreateIngredient() in app/api/ingredients/route.ts) was widened
-- to admin-or-store-manager, matching who can already log an
-- ingredient purchase (canLogPurchases()) -- but ingredients_admin_write
-- still only allowed is_admin() at the RLS level, so a store-manager
-- insert was rejected outright (a genuine INSERT failure, not the
-- silent zero-rows-matched UPDATE case 20260719163000 fixed).
--
-- Fix: same restaurant-location widening 20260719163000 already
-- applied to ingredients' UPDATE policy, now for INSERT too. Admin's
-- own ingredient creation on /ingredients is unaffected; this only
-- adds a second, restaurant-scoped path for the store manager, who
-- already has equivalent write access to ingredient_entries/
-- ingredient_purchases.
-- ============================================================

drop policy "ingredients_admin_write" on public.ingredients;

create policy "ingredients_admin_or_restaurant_insert" on public.ingredients
  for insert with check (
    public.is_admin() or public.my_location() = 'restaurant'
  );
