-- ============================================================
-- ENUMS
-- ============================================================

create type user_role as enum ('admin', 'staff');
create type location_type as enum ('restaurant', 'canteen');
create type item_category as enum (
  'beverages', 'snacks', 'meals', 'fruits', 'cyber', 'retail', 'ingredients'
);
create type expense_category as enum ('electricity', 'gas', 'charcoal', 'other');

-- Distinguishes how an item flows between the two locations.
-- See docs/01_DATA_MODEL.md §3.1 for why this exists -- the restaurant's
-- central store supplies a SUBSET of items to canteen daily; canteen
-- also stocks its own items (cyber, some retail) that never touch
-- the restaurant.
create type item_supply_type as enum (
  'restaurant_only',       -- never appears on canteen's sheet
  'canteen_supplied',      -- restaurant sends this to canteen; restaurant logs sent_out daily
  'canteen_independent'    -- canteen stocks/sells this on its own; restaurant never touches it
);

create type order_fulfillment_type as enum ('delivery', 'pickup');

-- ============================================================
-- updated_at TRIGGER
-- Every table below with an `updated_at` column gets this trigger
-- attached. Without it, `updated_at` is just a column app code has
-- to remember to set on every UPDATE -- an implicit contract that
-- silently breaks the first time a future session forgets. Attach
-- once here, forget about it everywhere else.
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
