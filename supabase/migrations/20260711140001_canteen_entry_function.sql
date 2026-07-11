-- ============================================================
-- save_canteen_stock_entry()
-- Phase 5 (docs/04_PHASE_PLAN.md) atomic write path for the canteen
-- weekly reconciliation screen. Mirrors save_stock_entry()'s shape
-- (same oversell re-check, same upsert-on-conflict pattern) but with
-- two genuine differences documented in docs/01_DATA_MODEL.md §3.1:
--
-- 1. Opening stock carries forward from the prior WEEK's closing_stock
--    (entry_date < p_week_start), not the prior day's.
-- 2. added_stock for a `canteen_supplied` item is never trusted from
--    the client -- it's derived server-side from
--    public.canteen_supplied_total(), the sum of the restaurant's daily
--    sent_out across the week. For a `canteen_independent` item (no
--    restaurant-side source), added_stock is the caller-supplied value,
--    same as the restaurant screen's added_stock field.
--
-- No `sent_out` parameter -- canteen never sends stock onward, that
-- column stays 0 for canteen rows (schema default).
--
-- `security invoker` (default, stated explicitly): runs as the calling
-- user, so stock_select_scoped/stock_insert_scoped/the same-day-or-admin
-- update policy all still apply. canteen_supplied_total() itself is
-- `security definer` (already defined in
-- 20260710110003_rls_and_functions.sql) so this function can read the
-- narrow aggregate without canteen's own RLS-scoped session needing
-- direct access to restaurant's stock_entries rows.
-- ============================================================

create or replace function public.save_canteen_stock_entry(
  p_item_id uuid,
  p_entry_date date,        -- Monday of the target week
  p_is_canteen_supplied boolean,
  p_added_stock_input numeric,  -- ignored for canteen_supplied items; used as-is for canteen_independent
  p_till_quantity_sold numeric,
  p_wastage numeric,
  p_selling_price_snapshot numeric,
  p_buying_price_snapshot numeric,
  p_created_by uuid,
  p_wastage_note text default null
)
returns public.stock_entries
language plpgsql
security invoker
as $$
declare
  v_week_end date := p_entry_date + 6;
  v_opening_stock numeric(10,2);
  v_added_stock numeric(10,2);
  v_total_stock numeric(10,2);
  v_order_total numeric(10,2);
  v_quantity_sold numeric(10,2);
  v_row public.stock_entries;
begin
  -- Opening stock = the prior WEEK's closing_stock for this item+canteen,
  -- or 0 if none exists yet (§3.1). Never re-derived from the client.
  select closing_stock into v_opening_stock
  from public.stock_entries
  where item_id = p_item_id
    and location = 'canteen'
    and entry_date < p_entry_date
  order by entry_date desc
  limit 1;

  v_opening_stock := coalesce(v_opening_stock, 0);

  if p_is_canteen_supplied then
    v_added_stock := public.canteen_supplied_total(p_item_id, p_entry_date, v_week_end);
  else
    v_added_stock := p_added_stock_input;
  end if;

  v_total_stock := v_opening_stock + v_added_stock;

  select coalesce(sum(oi.quantity), 0) into v_order_total
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.item_id = p_item_id
    and o.location = 'canteen'
    and o.order_date >= p_entry_date
    and o.order_date <= v_week_end;

  v_quantity_sold := p_till_quantity_sold + v_order_total;

  if v_quantity_sold + p_wastage > v_total_stock then
    raise exception 'oversell: only % available for this item', v_total_stock
      using errcode = 'P0001';
  end if;

  insert into public.stock_entries (
    item_id, location, entry_date,
    opening_stock, added_stock, sent_out,
    till_quantity_sold, quantity_sold, wastage, wastage_note,
    selling_price_snapshot, buying_price_snapshot,
    closing_stock, sales_value, cost_value, closing_stock_value, wastage_value,
    created_by
  )
  values (
    p_item_id, 'canteen', p_entry_date,
    v_opening_stock, v_added_stock, 0,
    p_till_quantity_sold, v_quantity_sold, p_wastage, p_wastage_note,
    p_selling_price_snapshot, p_buying_price_snapshot,
    v_total_stock - v_quantity_sold - p_wastage,
    v_quantity_sold * p_selling_price_snapshot,
    v_quantity_sold * p_buying_price_snapshot,
    (v_total_stock - v_quantity_sold - p_wastage) * p_buying_price_snapshot,
    p_wastage * p_buying_price_snapshot,
    p_created_by
  )
  on conflict (item_id, location, entry_date) do update set
    added_stock = excluded.added_stock,
    till_quantity_sold = excluded.till_quantity_sold,
    quantity_sold = excluded.quantity_sold,
    wastage = excluded.wastage,
    wastage_note = excluded.wastage_note,
    selling_price_snapshot = excluded.selling_price_snapshot,
    buying_price_snapshot = excluded.buying_price_snapshot,
    closing_stock = excluded.closing_stock,
    sales_value = excluded.sales_value,
    cost_value = excluded.cost_value,
    closing_stock_value = excluded.closing_stock_value,
    wastage_value = excluded.wastage_value
  returning * into v_row;

  return v_row;
end;
$$;
