-- ============================================================
-- Phase 9 — batch save wrappers for stock_entries/ingredient_entries.
--
-- THE PROBLEM: app/api/stock-entries/route.ts (and
-- app/api/ingredient-entries/route.ts) looped over every line item in a
-- day's/week's sheet and awaited one supabase.rpc() call per line, each a
-- separate network round trip to Postgres. With the real 132-item catalog
-- (Phase 8), a single "Save" tap on /entry or /store means dozens of
-- sequential round trips -- the reported "Save feels slow" complaint from
-- live client testing.
--
-- THE FIX: one new plpgsql function per write path that accepts the whole
-- batch as jsonb and loops SERVER-SIDE, calling the existing single-row
-- save_stock_entry()/save_canteen_stock_entry()/save_ingredient_entry()
-- for each line exactly as before. This is a pure loop relocation (Node
-- process -> Postgres), not a rewrite of the money-critical logic those
-- functions contain -- each line still goes through the same
-- lock_stock_entry_row() advisory lock + oversell re-check + upsert as
-- Phase 4-6 built and Phase 8 hardened (docs/01_DATA_MODEL.md §3.4).
-- Locking stays per-row (item_id, location, entry_date), same as before --
-- this does NOT lock the whole batch as one unit, so a till save and a
-- concurrent delivery order on a different item in the same batch still
-- don't block each other unnecessarily.
--
-- One route -> one RPC call -> one function invocation -> N in-process
-- function calls inside a single transaction, instead of N round trips.
-- A failure on any line raises (the whole batch's transaction rolls back
-- together, same effect as before where a failed line returned an error
-- and the client simply hadn't gotten to the not-yet-attempted lines --
-- but now genuinely atomic instead of "some already committed, some not").
-- ============================================================

create or replace function public.save_stock_entries_batch(
  p_location location_type,
  p_entry_date date,
  p_created_by uuid,
  p_lines jsonb  -- array of {item_id, till_quantity_sold, added_stock, sent_out, wastage, wastage_note, selling_price_snapshot, buying_price_snapshot}
)
returns setof public.stock_entries
language plpgsql
security invoker
as $$
declare
  v_line jsonb;
  v_row public.stock_entries;
begin
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_row := public.save_stock_entry(
      p_item_id => (v_line->>'item_id')::uuid,
      p_location => p_location,
      p_entry_date => p_entry_date,
      p_till_quantity_sold => (v_line->>'till_quantity_sold')::numeric,
      p_added_stock => (v_line->>'added_stock')::numeric,
      p_sent_out => (v_line->>'sent_out')::numeric,
      p_wastage => (v_line->>'wastage')::numeric,
      p_selling_price_snapshot => (v_line->>'selling_price_snapshot')::numeric,
      p_buying_price_snapshot => (v_line->>'buying_price_snapshot')::numeric,
      p_created_by => p_created_by,
      p_wastage_note => v_line->>'wastage_note'
    );
    return next v_row;
  end loop;
end;
$$;

create or replace function public.save_canteen_stock_entries_batch(
  p_entry_date date,
  p_created_by uuid,
  p_lines jsonb  -- array of {item_id, is_canteen_supplied, added_stock_input, till_quantity_sold, wastage, wastage_note, selling_price_snapshot, buying_price_snapshot}
)
returns setof public.stock_entries
language plpgsql
security invoker
as $$
declare
  v_line jsonb;
  v_row public.stock_entries;
begin
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_row := public.save_canteen_stock_entry(
      p_item_id => (v_line->>'item_id')::uuid,
      p_entry_date => p_entry_date,
      p_is_canteen_supplied => (v_line->>'is_canteen_supplied')::boolean,
      p_added_stock_input => (v_line->>'added_stock_input')::numeric,
      p_till_quantity_sold => (v_line->>'till_quantity_sold')::numeric,
      p_wastage => (v_line->>'wastage')::numeric,
      p_selling_price_snapshot => (v_line->>'selling_price_snapshot')::numeric,
      p_buying_price_snapshot => (v_line->>'buying_price_snapshot')::numeric,
      p_created_by => p_created_by,
      p_wastage_note => v_line->>'wastage_note'
    );
    return next v_row;
  end loop;
end;
$$;

create or replace function public.save_ingredient_entries_batch(
  p_entry_date date,
  p_created_by uuid,
  p_lines jsonb  -- array of {ingredient_id, received, quantity_used, wastage, wastage_note, buying_price_snapshot}
)
returns setof public.ingredient_entries
language plpgsql
security invoker
as $$
declare
  v_line jsonb;
  v_row public.ingredient_entries;
begin
  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_row := public.save_ingredient_entry(
      p_ingredient_id => (v_line->>'ingredient_id')::uuid,
      p_entry_date => p_entry_date,
      p_received => (v_line->>'received')::numeric,
      p_quantity_used => (v_line->>'quantity_used')::numeric,
      p_wastage => (v_line->>'wastage')::numeric,
      p_buying_price_snapshot => (v_line->>'buying_price_snapshot')::numeric,
      p_created_by => p_created_by,
      p_wastage_note => v_line->>'wastage_note'
    );
    return next v_row;
  end loop;
end;
$$;
