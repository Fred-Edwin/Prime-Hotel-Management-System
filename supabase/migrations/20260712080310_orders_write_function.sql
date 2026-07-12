-- ============================================================
-- public.apply_order_to_stock_entry()
--
-- The "second writer" half of docs/01_DATA_MODEL.md §3.4's two-writers-
-- one-stock-figure mechanism. Called once per distinct item on a newly
-- created order, AFTER that order's order_items row has been inserted.
--
-- Why this isn't just a call to the existing recalculate_stock_entry()
-- stub (20260710110003_rls_and_functions.sql): that function only
-- UPDATEs an existing stock_entries row's quantity_sold -- it assumes
-- the row already exists, which is only true if a till entry has
-- already been saved for this item/location/date. An order can easily
-- be the FIRST write of the day for an item (e.g. a delivery placed at
-- 9am before the till sheet is ever touched) -- there is no row yet to
-- UPDATE, and closing_stock/sales_value/etc. have no column defaults to
-- fall back on. So this function does the same upsert save_stock_entry()
-- does, except:
--   - it NEVER writes till_quantity_sold, added_stock (except the
--     canteen_supplied re-derivation below), sent_out, or wastage --
--     those remain whatever the till-entry flow last saved (or
--     0/defaults, if no till entry exists yet)
--   - quantity_sold is always re-derived from a FRESH sum of
--     order_items for this item/location/period (till_quantity_sold +
--     that sum) -- never incremented by "this order's quantity", so
--     two orders landing back-to-back, or an order landing before/after
--     a till save, can never race and clobber each other. This mirrors
--     exactly how save_stock_entry()/save_canteen_stock_entry() already
--     recompute quantity_sold fresh on every till save (§3.4).
--   - opening_stock/prices are only computed on first insert (carried
--     forward exactly like save_stock_entry()); on conflict, the
--     existing row's opening_stock/sent_out/till_quantity_sold/wastage/
--     price snapshots are preserved untouched -- only quantity_sold
--     (and, for canteen_supplied items, added_stock) and their
--     downstream values move.
--
-- CADENCE AWARENESS (docs/phases/phase5_context.md's explicit note for
-- this phase): p_order_date is always the literal calendar day an order
-- was placed -- orders.order_date never uses the weekly-Monday
-- convention, only stock_entries.entry_date does (§3.1). For a
-- restaurant order this function's p_entry_date is just p_order_date
-- unchanged. For a CANTEEN order, this function must resolve
-- p_order_date to that week's Monday before touching stock_entries --
-- otherwise a canteen order creates a stray extra daily row instead of
-- folding into the existing weekly row, the exact "genuinely
-- cross-cadence, don't assume 'today' as-is" bug this comment exists to
-- prevent (found and fixed during this phase's own live testing, not
-- anticipated in the original design -- see phase6_context.md).
--
-- For a canteen_supplied item specifically, added_stock is never
-- trusted/left as whatever a prior row had -- it's re-derived via
-- canteen_supplied_total() on every call, mirroring
-- save_canteen_stock_entry()'s rule (§3.1), so an order placed on a
-- canteen_supplied item before any weekly save has ever happened still
-- gets the correct real added_stock, not 0.
--
-- `security invoker`: runs as the calling staff member, so the existing
-- stock_insert_scoped/stock_select_scoped/update policies still apply --
-- this is not an RLS bypass, just a way to make the read + upsert +
-- oversell recheck atomic in one round trip, same rationale as every
-- other *_stock_entry function in this schema.
--
-- Oversell re-check: uses the SAME combined-total rule as §3 -- rejects
-- if the freshly-recomputed quantity_sold (till + all orders) would
-- exceed total_stock, even though this call's own order already
-- inserted its order_items row. If it fails, the caller's transaction
-- (the whole create_order() call below) rolls back, so the order_items
-- insert is undone too -- no partial order.
-- ============================================================

create or replace function public.apply_order_to_stock_entry(
  p_item_id uuid,
  p_location location_type,
  p_order_date date,
  p_selling_price_snapshot numeric,
  p_buying_price_snapshot numeric,
  p_created_by uuid
)
returns public.stock_entries
language plpgsql
security invoker
as $$
declare
  v_entry_date date;
  v_period_end date;
  v_is_canteen_supplied boolean;
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
  v_row public.stock_entries;
begin
  if p_location = 'canteen' then
    -- Monday of p_order_date's ISO week -- same date_trunc('week', ...)
    -- convention already used by the same-week RLS policies
    -- (20260711150001/20260711160001), which is Monday-start by
    -- definition and matches lib/calculations.ts's weekStartMonday().
    v_entry_date := date_trunc('week', p_order_date::timestamp)::date;
    v_period_end := v_entry_date + 6;

    select supply_type = 'canteen_supplied' into v_is_canteen_supplied
    from public.items where id = p_item_id;
  else
    v_entry_date := p_order_date;
    v_period_end := p_order_date;
    v_is_canteen_supplied := false;
  end if;

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
    -- First-ever write for this item+location+period -- derive opening
    -- stock from the prior period's closing_stock, same rule as
    -- save_stock_entry()/save_canteen_stock_entry() (§3.1). Everything
    -- else starts at 0, same as the column defaults a direct till save
    -- would have used.
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

  if v_sent_out + v_quantity_sold + v_wastage > v_total_stock then
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
    p_item_id, p_location, v_entry_date,
    v_opening_stock, v_added_stock, v_sent_out,
    v_till_quantity_sold, v_quantity_sold, v_wastage, v_wastage_note,
    p_selling_price_snapshot, p_buying_price_snapshot,
    v_total_stock - v_sent_out - v_quantity_sold - v_wastage,
    v_quantity_sold * p_selling_price_snapshot,
    v_quantity_sold * p_buying_price_snapshot,
    (v_total_stock - v_sent_out - v_quantity_sold - v_wastage) * p_buying_price_snapshot,
    v_wastage * p_buying_price_snapshot,
    p_created_by
  )
  on conflict (item_id, location, entry_date) do update set
    added_stock = excluded.added_stock,
    quantity_sold = excluded.quantity_sold,
    closing_stock = excluded.closing_stock,
    sales_value = excluded.sales_value,
    cost_value = excluded.cost_value,
    closing_stock_value = excluded.closing_stock_value
    -- till_quantity_sold, sent_out, wastage, wastage_note, and price
    -- snapshots are intentionally NOT in this SET list -- an order must
    -- never overwrite what the till-entry flow owns. added_stock IS
    -- included, but only ever moves for canteen_supplied items (where
    -- it's always freshly re-derived above, never order-specific) --
    -- for every other item v_added_stock is just the existing row's own
    -- value, so this is a no-op write for them.
  returning * into v_row;

  return v_row;
end;
$$;

-- ============================================================
-- public.create_order()
--
-- Atomic write path for a delivery/pickup order (docs/01_DATA_MODEL.md
-- §6, §3.4). Inserts the order + its order_items, then calls
-- apply_order_to_stock_entry() for each distinct item on the order, all
-- inside one function invocation (= one transaction, same rationale as
-- save_stock_entry()/save_canteen_stock_entry() -- PostgREST/the
-- Supabase JS client has no client-driven multi-statement transaction).
--
-- Idempotency (§3.4): relies on orders' existing
-- unique(created_by, client_request_id) constraint. If a retried
-- submit hits that constraint, this function catches the unique
-- violation specifically and returns the ALREADY-CREATED order instead
-- of erroring or inserting a second one -- the caller (route handler)
-- cannot tell a first-time save apart from a no-op retry from the
-- response shape alone, which is the point: neither creates a
-- duplicate order or double-deducts stock.
--
-- p_items is a jsonb array of {item_id, quantity, selling_price_snapshot}
-- objects -- passing a composite array keeps this a single round trip
-- rather than N+1 RPC calls from the route handler.
--
-- `security invoker`: runs as the calling staff member, so
-- orders_insert_scoped/order_items_insert_scoped and
-- stock_insert_scoped (via apply_order_to_stock_entry) all still apply.
-- ============================================================

create or replace function public.create_order(
  p_location location_type,
  p_order_date date,
  p_customer_name text,
  p_fulfillment_type order_fulfillment_type,
  p_total_amount numeric,
  p_client_request_id uuid,
  p_created_by uuid,
  p_items jsonb,
  p_buying_prices jsonb,  -- {item_id: buying_price_snapshot}, needed for stock_entries cost_value; not stored on order_items itself
  p_delivery_location_id uuid default null,
  p_delivery_fee_snapshot numeric default 0
)
returns public.orders
language plpgsql
security invoker
as $$
declare
  v_order public.orders;
  v_item jsonb;
  v_existing_order public.orders;
begin
  begin
    insert into public.orders (
      location, order_date, customer_name, fulfillment_type,
      delivery_location_id, delivery_fee_snapshot, total_amount,
      client_request_id, created_by
    )
    values (
      p_location, p_order_date, p_customer_name, p_fulfillment_type,
      p_delivery_location_id, p_delivery_fee_snapshot, p_total_amount,
      p_client_request_id, p_created_by
    )
    returning * into v_order;
  exception when unique_violation then
    -- Retried submit with the same client_request_id (§3.4) -- return
    -- the order that already exists instead of creating a duplicate or
    -- erroring. No new order_items/stock writes happen on this path.
    select * into v_existing_order
    from public.orders
    where created_by = p_created_by
      and client_request_id = p_client_request_id;

    return v_existing_order;
  end;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (order_id, item_id, quantity, selling_price_snapshot)
    values (
      v_order.id,
      (v_item->>'item_id')::uuid,
      (v_item->>'quantity')::numeric,
      (v_item->>'selling_price_snapshot')::numeric
    );

    perform public.apply_order_to_stock_entry(
      (v_item->>'item_id')::uuid,
      p_location,
      p_order_date,
      (v_item->>'selling_price_snapshot')::numeric,
      (p_buying_prices->>(v_item->>'item_id'))::numeric,
      p_created_by
    );
  end loop;

  return v_order;
end;
$$;
