-- ============================================================
-- Delete a whole stock_entries row (client feedback, 2026-07-27: "add
-- delete options at Item Ledger... I have double entries") -- the
-- heavier sibling of 20260727090000_consumption_entry_delete.sql, for
-- the Item Ledger's main table itself, not just the Non-Sales Stock
-- Consumption rows.
--
-- stock_entries has unique(item_id, location, entry_date), so this
-- can't create a literal duplicate the way an unconstrained claim table
-- can -- but a row can still be flat-out WRONG (logged against the
-- wrong date by mistake, e.g. today's till sales accidentally saved
-- against yesterday, leaving yesterday's real row untouched and a
-- bogus extra day sitting in the ledger) and removing it outright, not
-- just zeroing its fields, is the only real fix -- zeroing would still
-- leave a phantom day's opening/closing stock in the chain.
--
-- THE MECHANISM: removing a row from the middle of an item/location's
-- date chain changes what "the previous row" is for every later row
-- (opening_stock is always carried forward from the immediately
-- preceding existing row, per §3.1/§3.4 -- there is no assumption that
-- every calendar day has a row). recompute_stock_entry_cascade() (the
-- same top-level entry point the admin ledger-edit route already calls)
-- already re-derives forward from "the from-date onward" purely by
-- re-walking whatever rows currently exist -- it never assumes the
-- deleted row is still there, so calling it with the NEXT remaining
-- row's date (or, if none, nothing to recompute) after the delete is
-- sufficient. Same atomic-rollback-on-downstream-oversell guarantee:
-- if removing this row would mean a later day's row now demands more
-- stock than the new (smaller) opening_stock provides, the whole delete
-- rolls back.
--
-- CROSS-LOCATION: deleting a RESTAURANT row for a canteen_supplied item
-- removes that day's contribution to canteen_supplied_total() (a live
-- sum over sent_out, never stored redundantly -- §3.1), so
-- recompute_stock_entry_cascade() re-syncing every canteen day from
-- that date forward (its existing canteen cross-cascade step, unchanged)
-- correctly picks up the now-smaller total. Deleting a CANTEEN row has
-- no reverse effect on the restaurant side -- the link is one-directional.
--
-- Does NOT touch orders/order_items for that date -- an order is its own
-- permanent record (§6), independent of whatever stock_entries row
-- happens to summarize it; deleting the summary row doesn't and
-- shouldn't delete the orders that fed it. If the deleted date still has
-- order_items for this item/location, the row is simply recreated (at
-- zero opening/added/wastage) the next time anything touches that date
-- -- same "row is a derived rollup, not authoritative" posture
-- stock_entries already has via the canteen_supplied auto-create path
-- (20260724150000_canteen_supplied_row_autocreate.sql). Deleting a day
-- that still has real order_items is an edge case the confirmation
-- dialog should warn about (surfaced by the impact check below), but is
-- not blocked outright -- consistent with editing a historical row also
-- not being blocked.
--
-- Admin-only, both route (requireAdmin()) and RLS (new DELETE policy --
-- stock_entries had none before this).
-- ============================================================

-- drop-if-exists guards make this file safe to re-run regardless of
-- whether a prior attempt already got partway through -- create policy
-- has no "or replace" form (unlike the create or replace function
-- statements below), so re-running without these would 42710 the same
-- way 20260727090000_consumption_entry_delete.sql's own policies did.
drop policy if exists "stock_entries_delete_admin" on public.stock_entries;
create policy "stock_entries_delete_admin" on public.stock_entries
  for delete using (public.is_admin());

create or replace function public.delete_stock_entry(
  p_item_id uuid,
  p_location location_type,
  p_entry_date date,
  p_created_by uuid default null
)
returns void
language plpgsql
security invoker
as $$
declare
  v_next_date date;
begin
  perform public.lock_stock_entry_row(p_item_id, p_location, p_entry_date);

  if not exists (
    select 1 from public.stock_entries
    where item_id = p_item_id and location = p_location and entry_date = p_entry_date
  ) then
    raise exception 'unknown_entry: stock entry not found' using errcode = 'P0007';
  end if;

  delete from public.stock_entries
  where item_id = p_item_id and location = p_location and entry_date = p_entry_date;

  select entry_date into v_next_date
  from public.stock_entries
  where item_id = p_item_id and location = p_location and entry_date > p_entry_date
  order by entry_date
  limit 1;

  if v_next_date is not null then
    perform public.recompute_stock_entry_cascade(p_item_id, p_location, v_next_date, coalesce(p_created_by, auth.uid()));
  elsif p_location = 'restaurant' then
    -- No later restaurant row exists, but a canteen_supplied item's
    -- canteen mirror still needs re-syncing for any canteen week that
    -- depended on this now-deleted day's sent_out -- recompute_stock_entry_cascade
    -- only runs its canteen cross-cascade step when called with a real
    -- restaurant from-date, so without a later restaurant row to anchor
    -- it to, resync canteen directly from p_entry_date's canteen-side
    -- equivalent (same date, since the daily-cadence conversion, §3.1).
    perform public.recompute_stock_entry_cascade(p_item_id, 'canteen', p_entry_date, coalesce(p_created_by, auth.uid()));
  end if;
end;
$$;

-- Ingredient sibling -- identical shape, no location dimension, no
-- cross-table cascade (ingredients have no canteen-link equivalent).
drop policy if exists "ingredient_entries_delete_admin" on public.ingredient_entries;
create policy "ingredient_entries_delete_admin" on public.ingredient_entries
  for delete using (public.is_admin());

create or replace function public.delete_ingredient_entry(p_ingredient_id uuid, p_entry_date date)
returns void
language plpgsql
security invoker
as $$
declare
  v_next_date date;
begin
  perform public.lock_ingredient_entry_row(p_ingredient_id, p_entry_date);

  if not exists (
    select 1 from public.ingredient_entries
    where ingredient_id = p_ingredient_id and entry_date = p_entry_date
  ) then
    raise exception 'unknown_entry: ingredient entry not found' using errcode = 'P0007';
  end if;

  delete from public.ingredient_entries
  where ingredient_id = p_ingredient_id and entry_date = p_entry_date;

  select entry_date into v_next_date
  from public.ingredient_entries
  where ingredient_id = p_ingredient_id and entry_date > p_entry_date
  order by entry_date
  limit 1;

  if v_next_date is not null then
    perform public.recompute_ingredient_entry_chain(p_ingredient_id, v_next_date);
  end if;
end;
$$;
