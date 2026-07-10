-- ============================================================
-- DEV-ONLY SEED DATA
-- Applied automatically by `supabase db reset` / `supabase start`
-- against the LOCAL dev Supabase project only. Never run against
-- production. Staff accounts (which need Supabase Auth, not plain
-- SQL) are seeded separately by `scripts/seed-staff.ts` — run that
-- after this file, once the local stack is up.
-- ============================================================

-- ITEMS — sample catalog spanning categories and supply_types
insert into public.items (name, category, supply_type, buying_price, selling_price) values
  ('Chapati', 'meals', 'canteen_supplied', 15.00, 25.00),
  ('Beef Stew', 'meals', 'restaurant_only', 120.00, 220.00),
  ('Pilau', 'meals', 'canteen_supplied', 80.00, 150.00),
  ('African Tea', 'beverages', 'canteen_supplied', 10.00, 30.00),
  ('Soda 500ml', 'beverages', 'canteen_supplied', 45.00, 60.00),
  ('Mandazi', 'snacks', 'canteen_supplied', 8.00, 15.00),
  ('Samosa', 'snacks', 'restaurant_only', 20.00, 35.00),
  ('Bananas', 'fruits', 'canteen_independent', 5.00, 10.00),
  ('Watermelon Slice', 'fruits', 'canteen_independent', 15.00, 30.00),
  ('Printing (per page)', 'cyber', 'canteen_independent', 2.00, 5.00),
  ('Photocopy (per page)', 'cyber', 'canteen_independent', 2.00, 5.00),
  ('Exercise Book', 'retail', 'canteen_independent', 30.00, 50.00),
  ('Pen', 'retail', 'canteen_independent', 10.00, 20.00);

-- INGREDIENTS — raw materials at the central store, restaurant-only
insert into public.ingredients (name, unit, buying_price) values
  ('Wheat Flour', 'kg', 120.00),
  ('Cooking Oil', 'litre', 280.00),
  ('Sugar', 'kg', 150.00),
  ('Beef', 'kg', 650.00),
  ('Rice', 'kg', 180.00),
  ('Onions', 'kg', 90.00),
  ('Tomatoes', 'kg', 100.00),
  ('Tea Leaves', 'kg', 400.00),
  ('Charcoal (Cooking)', 'bag', 900.00);

-- DELIVERY_LOCATIONS — admin-managed zone + fixed fee catalog
insert into public.delivery_locations (name, fee) values
  ('Estate A', 100.00),
  ('Ridgeways', 150.00),
  ('Kasarani Town', 200.00),
  ('Roysambu', 120.00);
