-- ============================================================
-- Fix recompute_stock_entry_chain() using the stale pre-§3.11 wastage_value
-- formula (client-reported bug, found auditing the Non-Sales Stock
-- Consumption table, 2026-07-24).
--
-- THE BUG: 20260723180000_unconditional_estimated_value.sql (§3.11)
-- switched wastage_value/staff_meal_entries.value/complimentary_meal_
-- entries.value/stock_adjustment_entries.value to an unconditional
-- `quantity * selling_price_snapshot * estimated_cost_ratio()` formula,
-- and rewrote all nine writer functions that set those columns to match.
-- recompute_stock_entry_chain() (20260720100000_historical_ledger_edit_
-- cascade.sql) was never included in that rewrite -- it still computes
-- `wastage_value = wastage * buying_price_snapshot`, the OLD formula.
--
-- This function runs whenever an admin's Ledger edit to a historical
-- stock_entries row cascades forward through later rows for the same
-- item/location (§3.4's "Historical edit cascade"). Every row the cascade
-- touches gets wastage_value silently recomputed with the wrong formula
-- -- for any item with buying_price_snapshot = 0 (the common case for
-- in-house-cooked menu items, per §3.10), this zeroes out a wastage_value
-- that had just been correctly set to a nonzero figure by save_stock_entry(),
-- even on the very row the admin just edited (the cascade always includes
-- the edited row itself, not just later ones).
--
-- THE FIX: same one-line change §3.11 already made to every other writer
-- -- wastage * buying_price_snapshot becomes
-- wastage * selling_price_snapshot * estimated_cost_ratio(). No other line
-- in this function changes; closing_stock/sales_value/cost_value/
-- closing_stock_value are untouched, per §3.11's explicit "COGS and
-- closing stock value are untouched by any of this" invariant.
--
-- recompute_ingredient_entry_chain() and save_ingredient_entry() are
-- DELIBERATELY NOT touched by this migration -- confirmed with the human:
-- ingredients have no selling_price at all (never sold directly, §3.2),
-- so the §3.11 formula cannot apply to them the way it does to
-- stock_entries. Ingredient wastage_value was never part of the original
-- zero-buying-price problem §3.11 was built to fix (that was specifically
-- about in-house-cooked menu items' buying_price being deliberately
-- zeroed, §3.10) -- ingredients keep their original, still-correct
-- `wastage * buying_price_snapshot` formula unchanged.
-- ============================================================

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
      wastage_value = wastage * selling_price_snapshot * public.estimated_cost_ratio()
    where id = v_row.id
    returning * into v_updated;

    return next v_updated;
    v_prior_closing := v_new_closing;
  end loop;
end;
$$;
