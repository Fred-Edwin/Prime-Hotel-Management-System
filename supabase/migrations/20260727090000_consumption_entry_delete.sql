-- ============================================================
-- Delete a Non-Sales Stock Consumption row (client feedback, 2026-07-27:
-- "add delete options at Item Ledger... I have double entries").
--
-- staff_meal_entries / complimentary_meal_entries / stock_adjustment_entries
-- (§3.5, §3.10) are the actual source of "double entries" on this screen:
-- unlike stock_entries (unique(item_id, location, entry_date), so a
-- re-save just updates the same row), these three tables are pure
-- inserts with no unique constraint at all -- a double-tap or a
-- resubmitted claim from the Ledger's admin-entry modal genuinely lands
-- as two rows.
--
-- Same shape as the ingredient_purchases/canteen_stock_purchases
-- "Deleting a purchase" precedent (§3.2, 20260721060000_purchase_delete.sql):
-- a narrow, purpose-built reversal, not a generic delete primitive.
-- Deleting a claim removed its quantity from stock_entries.closing_stock
-- (each of the six stock_entries writer functions re-sums
-- staff_meals_total()/complimentary_meals_total()/stock_adjustments_total()
-- live from these tables every time they run -- confirmed by reading
-- save_stock_entry(): nothing is stored redundantly), so removing the row
-- and then forcing a recompute for that item/location/date is
-- sufficient -- no separate "unwind" step like the purchase functions
-- need for a weighted-average price. Calls
-- recompute_stock_entry_cascade() (the same top-level entry point the
-- admin ledger-edit route calls), not the lower-level
-- recompute_stock_entry_chain(), so a deleted claim against a
-- canteen_supplied restaurant item also re-syncs the linked canteen
-- week(s) (§3.1) -- not just this item/location's own forward chain.
-- Same atomic-rollback-on-downstream-oversell guarantee as every other
-- cascade in this schema: if removing this claim's quantity would let a
-- later day's row demand more stock than is now available (impossible in
-- practice for a claim that only ever reduced stock, but the cascade
-- re-runs the same oversell check unconditionally, so this is inherited
-- for free, not specially handled).
--
-- Admin-only, both at the route (requireAdmin()) and RLS (a new DELETE
-- policy on each table -- previously there was no delete policy at all,
-- append-only by design). security invoker, so the RLS policy below is
-- the real enforcement, matching delete_ingredient_purchase()'s posture.
-- ============================================================

-- drop-if-exists guards make this file safe to re-run: create policy has
-- no "or replace" form, and the SQL Editor runs a whole file as one
-- implicit transaction -- so without these, a re-run 42710s on the first
-- policy and rolls back EVERYTHING below it, including the three
-- create or replace function statements (which is exactly how the
-- delete_* functions ended up missing from the schema cache on
-- 2026-07-27 despite this file appearing to have been applied).
drop policy if exists "staff_meal_entries_delete_admin" on public.staff_meal_entries;
create policy "staff_meal_entries_delete_admin" on public.staff_meal_entries
  for delete using (public.is_admin());

drop policy if exists "complimentary_meal_entries_delete_admin" on public.complimentary_meal_entries;
create policy "complimentary_meal_entries_delete_admin" on public.complimentary_meal_entries
  for delete using (public.is_admin());

drop policy if exists "stock_adjustment_entries_delete_admin" on public.stock_adjustment_entries;
create policy "stock_adjustment_entries_delete_admin" on public.stock_adjustment_entries
  for delete using (public.is_admin());

create or replace function public.delete_staff_meal_entry(p_entry_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  v_entry public.staff_meal_entries;
begin
  select * into v_entry from public.staff_meal_entries where id = p_entry_id;
  if v_entry.id is null then
    raise exception 'unknown_entry: staff meal entry not found' using errcode = 'P0007';
  end if;

  perform public.lock_stock_entry_row(v_entry.item_id, v_entry.location, v_entry.meal_date);

  delete from public.staff_meal_entries where id = p_entry_id;

  perform public.recompute_stock_entry_cascade(v_entry.item_id, v_entry.location, v_entry.meal_date, auth.uid());
end;
$$;

create or replace function public.delete_complimentary_meal_entry(p_entry_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  v_entry public.complimentary_meal_entries;
begin
  select * into v_entry from public.complimentary_meal_entries where id = p_entry_id;
  if v_entry.id is null then
    raise exception 'unknown_entry: complimentary meal entry not found' using errcode = 'P0007';
  end if;

  perform public.lock_stock_entry_row(v_entry.item_id, v_entry.location, v_entry.meal_date);

  delete from public.complimentary_meal_entries where id = p_entry_id;

  perform public.recompute_stock_entry_cascade(v_entry.item_id, v_entry.location, v_entry.meal_date, auth.uid());
end;
$$;

create or replace function public.delete_stock_adjustment_entry(p_entry_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  v_entry public.stock_adjustment_entries;
begin
  select * into v_entry from public.stock_adjustment_entries where id = p_entry_id;
  if v_entry.id is null then
    raise exception 'unknown_entry: stock adjustment entry not found' using errcode = 'P0007';
  end if;

  perform public.lock_stock_entry_row(v_entry.item_id, v_entry.location, v_entry.meal_date);

  delete from public.stock_adjustment_entries where id = p_entry_id;

  perform public.recompute_stock_entry_cascade(v_entry.item_id, v_entry.location, v_entry.meal_date, auth.uid());
end;
$$;
