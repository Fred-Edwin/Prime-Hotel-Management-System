-- ============================================================
-- Add the same advisory-lock protection to save_ingredient_entry() that
-- 20260712091633_stock_entry_row_locking.sql gave save_stock_entry() /
-- save_canteen_stock_entry() / apply_order_to_stock_entry().
--
-- save_ingredient_entry()'s original docstring assumed no two-writer
-- race was possible ("only the store manager ever writes
-- ingredient_entries"), so it was never given a lock. That assumption
-- stops holding once /store moves to per-field autosave (this session):
-- a debounced autosave firing while a slow prior request for the same
-- ingredient/date is still in flight, or a retried request racing a
-- fresh one, can now hit the exact same read-decide-write race the
-- 20260712091633 migration fixed for stock_entries -- both calls read
-- "no row yet" for a first-ever save, both compute closing_stock from
-- their own inputs only, and the second INSERT ... ON CONFLICT DO
-- UPDATE fires using a stale pre-block snapshot instead of re-reading
-- the first call's already-committed row.
--
-- Fix: reuse the identical pg_advisory_xact_lock pattern, keyed on
-- (ingredient_id, entry_date) instead of (item_id, location, entry_date)
-- since ingredient_entries has no location column.
-- ============================================================

create or replace function public.lock_ingredient_entry_row(
  p_ingredient_id uuid,
  p_entry_date date
)
returns void
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_ingredient_id::text || '|' || p_entry_date::text, 0));
end;
$$;

create or replace function public.save_ingredient_entry(
  p_ingredient_id uuid,
  p_entry_date date,
  p_received numeric,
  p_quantity_used numeric,
  p_wastage numeric,
  p_buying_price_snapshot numeric,
  p_created_by uuid,
  p_wastage_note text default null
)
returns public.ingredient_entries
language plpgsql
security invoker
as $$
declare
  v_opening_stock numeric(10,2);
  v_closing_stock numeric(10,2);
  v_row public.ingredient_entries;
begin
  perform public.lock_ingredient_entry_row(p_ingredient_id, p_entry_date);

  select closing_stock into v_opening_stock
  from public.ingredient_entries
  where ingredient_id = p_ingredient_id
    and entry_date < p_entry_date
  order by entry_date desc
  limit 1;

  v_opening_stock := coalesce(v_opening_stock, 0);

  if p_quantity_used + p_wastage > v_opening_stock + p_received then
    raise exception 'oversell: only % available for this ingredient', v_opening_stock + p_received
      using errcode = 'P0001';
  end if;

  v_closing_stock := v_opening_stock + p_received - p_quantity_used - p_wastage;

  insert into public.ingredient_entries (
    ingredient_id, entry_date,
    opening_stock, received, quantity_used, wastage, wastage_note,
    buying_price_snapshot,
    closing_stock, closing_stock_value, wastage_value,
    created_by
  )
  values (
    p_ingredient_id, p_entry_date,
    v_opening_stock, p_received, p_quantity_used, p_wastage, p_wastage_note,
    p_buying_price_snapshot,
    v_closing_stock, v_closing_stock * p_buying_price_snapshot, p_wastage * p_buying_price_snapshot,
    p_created_by
  )
  on conflict (ingredient_id, entry_date) do update set
    received = excluded.received,
    quantity_used = excluded.quantity_used,
    wastage = excluded.wastage,
    wastage_note = excluded.wastage_note,
    buying_price_snapshot = excluded.buying_price_snapshot,
    closing_stock = excluded.closing_stock,
    closing_stock_value = excluded.closing_stock_value,
    wastage_value = excluded.wastage_value
  returning * into v_row;

  return v_row;
end;
$$;
