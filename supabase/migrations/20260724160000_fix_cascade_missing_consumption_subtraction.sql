-- ============================================================
-- Fix: recompute_stock_entry_chain() never subtracted staff_meals /
-- complimentary_meals / stock_adjustments from closing_stock (found
-- auditing the historical-edit cascade while investigating the
-- canteen Chapati carry-forward issue, 2026-07-24).
--
-- THE BUG: every ordinary write path (save_stock_entry(),
-- save_stock_entry_store_manager_fields(), save_stock_entry_cashier_field(),
-- save_stock_entry_canteen_field(), apply_order_to_stock_entry() --
-- 20260722080000_stock_entries_complimentary_meals_and_adjustments.sql
-- onward) correctly derives closing_stock as:
--   opening_stock + added_stock - sent_out - quantity_sold - wastage
--   - staff_meals - complimentary_meals - stock_adjustments
-- but recompute_stock_entry_chain() -- the function that ripples a
-- historical admin edit forward through every later row for that
-- item/location -- only ever computed:
--   opening_stock + added_stock - sent_out - quantity_sold - wastage
-- missing the last three terms entirely. Any admin edit to a row at or
-- before a date where staff meals/complimentary meals/stock adjustments
-- exist for that item/location would silently recompute every later
-- row's closing_stock too HIGH by the sum of those categories, from
-- that point forward.
--
-- No known bad data from this: confirmed via direct query that no
-- canteen_supplied item currently has any staff_meal_entries /
-- complimentary_meal_entries / stock_adjustment_entries rows against
-- canteen at all, so nothing has actually triggered this yet. It's a
-- landmine that happened to still be harmless, not a live data problem
-- -- fixed now regardless, before it becomes one.
--
-- THE FIX: mirror save_stock_entry_canteen_field()'s exact approach --
-- staff_meals_total()/complimentary_meals_total()/stock_adjustments_total(),
-- each scoped to (item_id, location, entry_date, entry_date), subtracted
-- alongside wastage. Also added to the oversell check for the same
-- reason the ordinary write paths already include them there.
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
  v_staff_meals numeric(10,2);
  v_complimentary_meals numeric(10,2);
  v_stock_adjustments numeric(10,2);
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

    v_staff_meals := public.staff_meals_total(p_item_id, p_location, v_row.entry_date, v_row.entry_date);
    v_complimentary_meals := public.complimentary_meals_total(p_item_id, p_location, v_row.entry_date, v_row.entry_date);
    v_stock_adjustments := public.stock_adjustments_total(p_item_id, p_location, v_row.entry_date, v_row.entry_date);

    v_new_closing := v_total_stock - v_row.sent_out - v_row.quantity_sold - v_row.wastage
      - v_staff_meals - v_complimentary_meals - v_stock_adjustments;

    if v_row.sent_out + v_row.quantity_sold + v_row.wastage + v_staff_meals + v_complimentary_meals + v_stock_adjustments > v_total_stock then
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
