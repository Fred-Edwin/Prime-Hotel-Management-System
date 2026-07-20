-- ============================================================
-- Admin historical ledger edits (docs/backlog/04_admin_ledger_edit.md
-- follow-up) — lifts the "only the most-recent row is editable" 409
-- guard in PATCH /api/dashboard/ledger/entry by giving the admin edit
-- path a way to recompute every row that chained off an edited one,
-- instead of just rejecting the edit outright.
--
-- WHY editing a historical row was unsafe before this: save_stock_entry()
-- / save_canteen_stock_entry() / save_ingredient_entry() each derive
-- opening_stock for the row being WRITTEN by reading the PREVIOUS row's
-- closing_stock (see 20260712091633_stock_entry_row_locking.sql). That
-- lookup only ever runs at write time for the row being saved — nothing
-- re-derives a LATER row after an earlier one changes. Editing day 1 of
-- a 10-day chain without recomputing days 2-10 would leave every later
-- opening_stock/closing_stock/sales_value/cost_value/closing_stock_value/
-- wastage_value silently wrong.
--
-- THE FIX: two recompute-chain functions that walk forward from an
-- edited row through every existing later row for the same item/
-- location (or ingredient), re-deriving the same fields save_stock_entry
-- etc. already compute — using each row's own already-stored price
-- snapshots, never touching selling_price_snapshot/buying_price_snapshot
-- (price immutability is unchanged by this migration). If any row in the
-- chain would need more stock than is available (a downstream oversell
-- the historical correction reveals), the ENTIRE cascade raises and rolls
-- back — resolved design decision: reject the whole edit atomically
-- rather than allow negative/impossible closing stock to land, so the
-- admin fixes the downstream conflict first.
--
-- CROSS-LOCATION CASCADE: a canteen_supplied item's restaurant sent_out
-- feeds the canteen's added_stock for that week via
-- canteen_supplied_total() (§3.1) — but only when the canteen row is
-- itself (re)saved. A historical edit to a restaurant row's sent_out
-- therefore also re-runs the canteen week's derivation for every week
-- affected, cascading forward from there too, in the same transaction.
-- ============================================================

-- Recomputes opening_stock/closing_stock/sales_value/cost_value/
-- closing_stock_value/wastage_value for every stock_entries row later
-- than p_from_date for this item/location, in date order, using each
-- row's own stored inputs and price snapshots (never rewritten here).
-- Raises 'oversell' (same errcode/message convention describeSaveError()
-- already parses) if any row in the chain can no longer be satisfied.
create or replace function public.recompute_stock_entry_chain(
  p_item_id uuid,
  p_location location_type,
  p_from_date date
)
returns setof public.stock_entries
language plpgsql
security invoker
as $$
declare
  v_row record;
  v_prior_closing numeric(10,2);
  v_total_stock numeric(10,2);
  v_new_closing numeric(10,2);
  v_updated public.stock_entries;
begin
  -- Lock every row in the affected range up front so a concurrent staff
  -- write (till save, order, store-manager save) can't land mid-cascade
  -- — same advisory-lock discipline as the ordinary save path, just
  -- taken for the whole range instead of one row.
  for v_row in
    select entry_date from public.stock_entries
    where item_id = p_item_id and location = p_location and entry_date >= p_from_date
    order by entry_date
  loop
    perform public.lock_stock_entry_row(p_item_id, p_location, v_row.entry_date);
  end loop;

  select closing_stock into v_prior_closing
  from public.stock_entries
  where item_id = p_item_id and location = p_location and entry_date < p_from_date
  order by entry_date desc
  limit 1;
  v_prior_closing := coalesce(v_prior_closing, 0);

  for v_row in
    select * from public.stock_entries
    where item_id = p_item_id and location = p_location and entry_date >= p_from_date
    order by entry_date
  loop
    v_total_stock := v_prior_closing + v_row.added_stock;
    v_new_closing := v_total_stock - v_row.sent_out - v_row.quantity_sold - v_row.wastage;

    if v_row.sent_out + v_row.quantity_sold + v_row.wastage > v_total_stock then
      raise exception 'oversell: recomputing % on % would need more stock than available (% on hand)',
        p_item_id, v_row.entry_date, v_total_stock
        using errcode = 'P0001';
    end if;

    update public.stock_entries set
      opening_stock = v_prior_closing,
      closing_stock = v_new_closing,
      sales_value = quantity_sold * selling_price_snapshot,
      cost_value = quantity_sold * buying_price_snapshot,
      closing_stock_value = v_new_closing * buying_price_snapshot,
      wastage_value = wastage * buying_price_snapshot
    where id = v_row.id
    returning * into v_updated;

    return next v_updated;
    v_prior_closing := v_new_closing;
  end loop;
end;
$$;

-- Ingredient sibling — same shape, no location dimension.
create or replace function public.recompute_ingredient_entry_chain(
  p_ingredient_id uuid,
  p_from_date date
)
returns setof public.ingredient_entries
language plpgsql
security invoker
as $$
declare
  v_row record;
  v_prior_closing numeric(10,2);
  v_new_closing numeric(10,2);
  v_updated public.ingredient_entries;
begin
  for v_row in
    select entry_date from public.ingredient_entries
    where ingredient_id = p_ingredient_id and entry_date >= p_from_date
    order by entry_date
  loop
    perform public.lock_ingredient_entry_row(p_ingredient_id, v_row.entry_date);
  end loop;

  select closing_stock into v_prior_closing
  from public.ingredient_entries
  where ingredient_id = p_ingredient_id and entry_date < p_from_date
  order by entry_date desc
  limit 1;
  v_prior_closing := coalesce(v_prior_closing, 0);

  for v_row in
    select * from public.ingredient_entries
    where ingredient_id = p_ingredient_id and entry_date >= p_from_date
    order by entry_date
  loop
    if v_row.quantity_used + v_row.wastage > v_prior_closing + v_row.received then
      raise exception 'oversell: recomputing % on % would need more stock than available (% on hand)',
        p_ingredient_id, v_row.entry_date, v_prior_closing + v_row.received
        using errcode = 'P0001';
    end if;

    v_new_closing := v_prior_closing + v_row.received - v_row.quantity_used - v_row.wastage;

    update public.ingredient_entries set
      opening_stock = v_prior_closing,
      closing_stock = v_new_closing,
      closing_stock_value = v_new_closing * buying_price_snapshot,
      wastage_value = wastage * buying_price_snapshot
    where id = v_row.id
    returning * into v_updated;

    return next v_updated;
    v_prior_closing := v_new_closing;
  end loop;
end;
$$;

-- Top-level entry point the admin edit route calls after saving the
-- edited row itself: recomputes the same-item/location forward chain,
-- and — for a canteen_supplied item whose restaurant sent_out changed —
-- also re-derives every canteen week touched by the edited date range
-- and cascades that forward too. Returns every stock_entries row this
-- touched (across both the primary and any canteen cascade) so the
-- caller can report a count/date-range to the admin and log the full
-- cascade to audit_log — not just apply it silently.
-- p_edited_location/p_edited_from_date describe the row that was just
-- directly edited (already saved by the caller via
-- save_stock_entry/save_canteen_stock_entry before this is invoked).
create or replace function public.recompute_stock_entry_cascade(
  p_item_id uuid,
  p_edited_location location_type,
  p_edited_from_date date
)
returns setof public.stock_entries
language plpgsql
security invoker
as $$
declare
  v_supply_type item_supply_type;
  v_week record;
begin
  return query select * from public.recompute_stock_entry_chain(p_item_id, p_edited_location, p_edited_from_date);

  if p_edited_location = 'restaurant' then
    select supply_type into v_supply_type from public.items where id = p_item_id;

    if v_supply_type = 'canteen_supplied' then
      -- Every canteen week whose [entry_date, entry_date+6] range
      -- overlaps the edited date onward needs its added_stock re-pulled
      -- from canteen_supplied_total(), since that restaurant sent_out
      -- may have just changed. entry_date - 6 catches a canteen week
      -- that started before the edited date but still spans it.
      for v_week in
        select entry_date from public.stock_entries
        where item_id = p_item_id
          and location = 'canteen'
          and entry_date >= p_edited_from_date - 6
        order by entry_date
      loop
        perform public.lock_stock_entry_row(p_item_id, 'canteen', v_week.entry_date);

        update public.stock_entries
        set added_stock = public.canteen_supplied_total(p_item_id, v_week.entry_date, v_week.entry_date + 6)
        where item_id = p_item_id and location = 'canteen' and entry_date = v_week.entry_date;

        -- Re-derive that week's own closing/value fields against the
        -- corrected added_stock, then cascade forward from it too.
        return query select * from public.recompute_stock_entry_chain(p_item_id, 'canteen', v_week.entry_date);
      end loop;
    end if;
  end if;
end;
$$;
