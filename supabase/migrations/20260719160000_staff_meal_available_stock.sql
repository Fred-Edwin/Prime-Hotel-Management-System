-- ============================================================
-- Bug fix: the staff-meals picker's client-side "Available: X" cap
-- (StaffMealsClient.tsx's remainingStockFor, added as a UX-audit
-- follow-up) only showed a number when TODAY's stock_entries row
-- already existed -- the common case is no row exists yet (nobody has
-- logged a till sale or store-manager field today), so the picker
-- showed no availability signal at all and let staff pick any quantity,
-- only to be rejected server-side by create_staff_meal_entry()'s real
-- oversell check. A second, related bug: even when today's row DID
-- exist, the client only computed total_stock - sent_out -
-- quantity_sold - wastage, never subtracting staff_meals already
-- claimed today, so a second claim on the same item in the same visit
-- could show a stale (too-high) available figure.
--
-- THE FIX: expose the same effective-current-stock figure
-- create_staff_meal_entry() already computes server-side, via a new
-- read-only function -- not by re-deriving the opening-stock-carry-
-- forward/staff-meals math a second time in TypeScript (CLAUDE.md's
-- "no calculation logic duplicated" rule). The key realization: TODAY's
-- stock_entries.closing_stock, when a row exists, is ALREADY net of
-- staff_meals (create_staff_meal_entry() writes closing_stock net of
-- v_staff_meals, same as every other writer nets it against wastage) --
-- so "most recent stock_entries row's closing_stock" is the single
-- correct answer whether or not today's row exists yet:
--   - row exists for today/this week: its closing_stock already
--     reflects every claim made so far today, no separate subtraction
--     needed.
--   - no row yet: the most recent PRIOR row's closing_stock is exactly
--     what carry-forward would use as opening_stock, and since no claim
--     can exist without first creating today's row, there's nothing
--     to subtract.
-- Same "each item's most recent stock_entries row" pattern as
-- dashboard_low_stock_items() (20260712121500), just scoped to one
-- location instead of admin's global view, and returning the raw
-- number (not a boolean threshold check).
--
-- available is NULL, not 0, when an item has no stock_entries row at
-- all (this or any prior period) -- deliberately distinct from a real
-- row showing a confirmed 0 remaining. A brand-new item, or one nobody
-- has logged a till sale for yet today, has UNKNOWN stock, not
-- CONFIRMED-EMPTY stock -- collapsing the two into a bare 0 would make
-- every item unclaimable in the picker until its first till sale of the
-- day, which isn't how staff actually use this (a staff meal can
-- legitimately be the first stock-touching action of the day for an
-- item). The caller treats NULL as "don't cap, don't show an Available
-- label" (mirrors OrdersClient.tsx's existing remainingStockFor
-- convention for the same "no row yet" case) -- the server's real
-- oversell check in create_staff_meal_entry() remains the actual
-- enforcement either way.
-- ============================================================

create or replace function public.staff_meal_available_stock(
  p_location location_type,
  p_as_of_date date
)
returns table (
  item_id uuid,
  available numeric
)
language sql
security invoker
stable
as $$
  select
    i.id as item_id,
    latest.closing_stock as available
  from public.items i
  left join lateral (
    select se.closing_stock
    from public.stock_entries se
    where se.item_id = i.id
      and se.location = p_location
      and se.entry_date <= (
        case when p_location = 'canteen'
          then date_trunc('week', p_as_of_date::timestamp)::date
          else p_as_of_date
        end
      )
    order by se.entry_date desc
    limit 1
  ) latest on true
  where i.active
    and i.supply_type = any (
      case when p_location = 'restaurant'
        then array['restaurant_only', 'canteen_supplied']::item_supply_type[]
        else array['canteen_supplied', 'canteen_independent']::item_supply_type[]
      end
    );
$$;
