-- ============================================================
-- save_stock_entry()
-- Phase 4 (docs/04_PHASE_PLAN.md) atomic write path for the daily
-- restaurant entry screen. PostgREST/the Supabase JS client has no
-- multi-statement client-driven transaction, but docs/01_DATA_MODEL.md
-- §3.4 requires the upsert + recalculate_stock_entry() call + oversell
-- re-check to happen inside one transaction -- so this function does
-- the whole write server-side in a single round trip, matching the
-- existing recalculate_stock_entry() pattern.
--
-- `security invoker` (the default, stated explicitly for clarity): runs
-- as the calling user, so the existing stock_select_scoped/
-- stock_insert_scoped RLS policies still apply -- this function is not
-- a way to bypass RLS, just a way to make several statements atomic.
--
-- opening_stock is derived here, server-side, from the prior period's
-- closing_stock for the same item+location (§3.1) -- never trusted from
-- the client.
-- ============================================================

create or replace function public.save_stock_entry(
  p_item_id uuid,
  p_location location_type,
  p_entry_date date,
  p_till_quantity_sold numeric,
  p_added_stock numeric,
  p_sent_out numeric,
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
  v_opening_stock numeric(10,2);
  v_total_stock numeric(10,2);
  v_order_total numeric(10,2);
  v_quantity_sold numeric(10,2);
  v_row public.stock_entries;
begin
  -- Opening stock = the immediately prior entry_date's closing_stock for
  -- this item+location, or 0 if none exists yet (§3.1). Never re-derived
  -- from anything the client sends.
  select closing_stock into v_opening_stock
  from public.stock_entries
  where item_id = p_item_id
    and location = p_location
    and entry_date < p_entry_date
  order by entry_date desc
  limit 1;

  v_opening_stock := coalesce(v_opening_stock, 0);
  v_total_stock := v_opening_stock + p_added_stock;

  select coalesce(sum(oi.quantity), 0) into v_order_total
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.item_id = p_item_id
    and o.location = p_location
    and o.order_date = p_entry_date;

  v_quantity_sold := p_till_quantity_sold + v_order_total;

  if p_sent_out + v_quantity_sold + p_wastage > v_total_stock then
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
    p_item_id, p_location, p_entry_date,
    v_opening_stock, p_added_stock, p_sent_out,
    p_till_quantity_sold, v_quantity_sold, p_wastage, p_wastage_note,
    p_selling_price_snapshot, p_buying_price_snapshot,
    v_total_stock - p_sent_out - v_quantity_sold - p_wastage,
    v_quantity_sold * p_selling_price_snapshot,
    v_quantity_sold * p_buying_price_snapshot,
    (v_total_stock - p_sent_out - v_quantity_sold - p_wastage) * p_buying_price_snapshot,
    p_wastage * p_buying_price_snapshot,
    p_created_by
  )
  on conflict (item_id, location, entry_date) do update set
    added_stock = excluded.added_stock,
    sent_out = excluded.sent_out,
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

-- ============================================================
-- save_ingredient_entry()
-- Same atomic-write rationale as save_stock_entry(), for the store
-- manager's ingredient entry screen (docs/01_DATA_MODEL.md §3.2).
-- No two-writer concurrency concern here (only the store manager ever
-- writes ingredient_entries), but opening_stock carry-forward and the
-- oversell check still need to be atomic with the upsert.
-- ============================================================

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
