-- ============================================================
-- Stock adjustments become SIGNED (client feedback, 2026-07-22, same
-- session as docs/backlog/05_stock_consumption.md's original build):
-- physical recounts at Prosper Hotel sometimes find MORE stock than the
-- system shows (a surplus), not just less (a shortfall) -- the original
-- build only supported shortfalls (quantity > 0, same "consumption-only"
-- shape as wastage/staff meals/complimentary meals).
--
-- SIGN CONVENTION: positive quantity = shortfall (removes stock, same
-- direction every other consumption category already uses). Negative
-- quantity = surplus (adds stock back). This is the LEAST invasive
-- option: closing_stock's formula (total_stock - ... - stock_adjustments)
-- does not change shape at all -- subtracting a negative number already
-- adds it back arithmetically. The oversell check
-- (sent_out + quantity_sold + wastage + staff_meals + complimentary_meals
-- + stock_adjustments > total_stock) is ALSO already correct as-is: a
-- negative (surplus) adjustment only ever shrinks the left-hand side,
-- so it can never trigger a false oversell rejection, while a positive
-- (shortfall) adjustment is still capped exactly as before. None of the
-- six stock_entries writer functions need their oversell arithmetic
-- touched -- only this table's constraint and this function's value
-- derivation change.
--
-- value = quantity * buying_price_snapshot still works signed: a
-- shortfall gets a positive (cost) value, a surplus gets a negative
-- value -- read together with the ledger/dashboard display layer
-- (app code, not this migration) showing a surplus distinctly rather
-- than folding a negative number silently into a "usage" total that
-- implies loss.
-- ============================================================

alter table public.stock_adjustment_entries drop constraint stock_adjustment_entries_quantity_check;
alter table public.stock_adjustment_entries add constraint stock_adjustment_entries_quantity_check check (quantity <> 0);

drop function if exists public.create_stock_adjustment_entry(uuid, location_type, date, numeric, uuid, uuid, text);

create or replace function public.create_stock_adjustment_entry(
  p_item_id uuid,
  p_location location_type,
  p_meal_date date,
  p_quantity numeric,  -- signed: positive = shortfall, negative = surplus
  p_staff_id uuid,
  p_created_by uuid,
  p_note text default null
)
returns public.stock_adjustment_entries
language plpgsql
security invoker
as $$
declare
  v_entry_date date := p_meal_date;
  v_period_end date := p_meal_date;
  v_is_canteen_supplied boolean := false;
  v_buying_price numeric(10,2);
  v_selling_price numeric(10,2);
  v_existing public.stock_entries;
  v_opening_stock numeric(10,2);
  v_till_quantity_sold numeric(10,2);
  v_added_stock numeric(10,2);
  v_sent_out numeric(10,2);
  v_wastage numeric(10,2);
  v_wastage_note text;
  v_total_stock numeric(10,2);
  v_order_total numeric(10,2);
  v_quantity_sold numeric(10,2);
  v_staff_meals numeric(10,2);
  v_complimentary_meals numeric(10,2);
  v_stock_adjustments numeric(10,2);
  v_claim public.stock_adjustment_entries;
begin
  if p_quantity = 0 then
    raise exception 'invalid_quantity: adjustment quantity cannot be zero'
      using errcode = 'P0005';
  end if;

  select buying_price, selling_price into v_buying_price, v_selling_price
  from public.items
  where id = p_item_id and active;

  if v_buying_price is null then
    raise exception 'unknown_item: item is not active or does not exist'
      using errcode = 'P0004';
  end if;

  if p_location = 'canteen' then
    select supply_type = 'canteen_supplied' into v_is_canteen_supplied
    from public.items where id = p_item_id;
  end if;

  perform public.lock_stock_entry_row(p_item_id, p_location, v_entry_date);

  select * into v_existing
  from public.stock_entries
  where item_id = p_item_id
    and location = p_location
    and entry_date = v_entry_date;

  if found then
    v_opening_stock := v_existing.opening_stock;
    v_till_quantity_sold := v_existing.till_quantity_sold;
    v_added_stock := v_existing.added_stock;
    v_sent_out := v_existing.sent_out;
    v_wastage := v_existing.wastage;
    v_wastage_note := v_existing.wastage_note;
  else
    select closing_stock into v_opening_stock
    from public.stock_entries
    where item_id = p_item_id
      and location = p_location
      and entry_date < v_entry_date
    order by entry_date desc
    limit 1;

    v_opening_stock := coalesce(v_opening_stock, 0);
    v_till_quantity_sold := 0;
    v_added_stock := 0;
    v_sent_out := 0;
    v_wastage := 0;
    v_wastage_note := null;
  end if;

  if v_is_canteen_supplied then
    v_added_stock := public.canteen_supplied_total(p_item_id, v_entry_date, v_period_end);
  end if;

  v_total_stock := v_opening_stock + v_added_stock;

  select coalesce(sum(oi.quantity), 0) into v_order_total
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.item_id = p_item_id
    and o.location = p_location
    and o.order_date >= v_entry_date
    and o.order_date <= v_period_end;

  v_quantity_sold := v_till_quantity_sold + v_order_total;

  v_staff_meals := public.staff_meals_total(p_item_id, p_location, v_entry_date, v_period_end);
  v_complimentary_meals := public.complimentary_meals_total(p_item_id, p_location, v_entry_date, v_period_end);

  -- Signed: stock_adjustments_total() already sums signed quantities, so
  -- a surplus (negative p_quantity) correctly REDUCES this running total
  -- (making the oversell check's left-hand side smaller, never larger).
  select public.stock_adjustments_total(p_item_id, p_location, v_entry_date, v_period_end) + p_quantity
    into v_stock_adjustments;

  if v_sent_out + v_quantity_sold + v_wastage + v_staff_meals + v_complimentary_meals + v_stock_adjustments > v_total_stock then
    raise exception 'oversell: only % available for this item', v_total_stock
      using errcode = 'P0001';
  end if;

  insert into public.stock_adjustment_entries (
    item_id, location, meal_date, quantity,
    buying_price_snapshot, value, note, staff_id, created_by
  )
  values (
    p_item_id, p_location, p_meal_date, p_quantity,
    v_buying_price, p_quantity * v_buying_price, p_note, p_staff_id, p_created_by
  )
  returning * into v_claim;

  insert into public.stock_entries (
    item_id, location, entry_date,
    opening_stock, added_stock, sent_out,
    till_quantity_sold, quantity_sold, wastage, wastage_note,
    selling_price_snapshot, buying_price_snapshot,
    closing_stock, sales_value, cost_value, closing_stock_value, wastage_value,
    created_by
  )
  values (
    p_item_id, p_location, v_entry_date,
    v_opening_stock, v_added_stock, v_sent_out,
    v_till_quantity_sold, v_quantity_sold, v_wastage, v_wastage_note,
    v_selling_price, v_buying_price,
    v_total_stock - v_sent_out - v_quantity_sold - v_wastage - v_staff_meals - v_complimentary_meals - v_stock_adjustments,
    v_quantity_sold * v_selling_price,
    v_quantity_sold * v_buying_price,
    (v_total_stock - v_sent_out - v_quantity_sold - v_wastage - v_staff_meals - v_complimentary_meals - v_stock_adjustments) * v_buying_price,
    v_wastage * v_buying_price,
    p_created_by
  )
  on conflict (item_id, location, entry_date) do update set
    added_stock = excluded.added_stock,
    closing_stock = excluded.closing_stock,
    closing_stock_value = excluded.closing_stock_value;

  return v_claim;
end;
$$;
