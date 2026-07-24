-- ============================================================
-- Phase 11 — Credit/debtor ledger
-- (docs/04_PHASE_PLAN.md Phase 11, docs/01_DATA_MODEL.md §6's new
-- "Credit sales and customer payments" subsection)
--
-- Client (WaPrecious) request: track customers who take goods/services
-- on credit until payment is made. Previously an explicit V1 exclusion
-- (docs/PRD.md §2, 01_DATA_MODEL.md §5, 04_PHASE_PLAN.md's "What's
-- explicitly NOT in this phase plan") — now in scope per direct client
-- input, same pattern as wastage (§3.3) and orders (§6) both reversing
-- an earlier "not in V1" call after real client need surfaced.
--
-- SHAPE (confirmed with the human before this migration was written,
-- not a fresh design call made here):
--   1. A credit sale — whether from a delivery/pickup order or a
--      walk-in counter sale — is modeled as an `orders` row, using the
--      new `fulfillment_type = 'counter'` value added by the companion
--      migration 20260724130000_credit_ledger_enum.sql. The existing
--      stepper-based till flow on /entry is completely unchanged.
--   2. `customers` — a lightweight catalog, not a "customer account"
--      system (no login, no order history UI beyond what orders/
--      debtors screens already show). Both staff and admin can create
--      one.
--   3. `orders.customer_id` — nullable FK, so cash/till-derived orders
--      don't need one, but linking a cash order to a customer is still
--      allowed if useful (e.g. a regular who always pays cash but whose
--      admin wants a record of their orders). `orders.customer_name`
--      (free text) is UNCHANGED and stays the display/fallback label —
--      not removed, not superseded.
--   4. `order_payments` — an append-only ledger (NOT a boolean/status
--      column on `orders`), mirroring how this schema already treats
--      `ingredient_purchases`/`canteen_stock_purchases` as append-only
--      buying logs rather than a single mutable balance field. An
--      order's outstanding balance is always DERIVED:
--      orders.total_amount - coalesce(sum(order_payments.amount), 0).
--
-- WHY NO STORED/DENORMALIZED `orders.payment_status` COLUMN: the brief
-- explicitly allowed either choice, provided a denormalized field (if
-- chosen) is kept correctly in sync via a recompute function, never
-- application code. Judgment call made here: derive it entirely, no
-- stored column. Reasoning — the debtors list (GET /api/admin/debtors)
-- is the only place this is queried at any real volume, it's naturally
-- scoped to "orders with customer_id is not null" (a small subset of
-- all orders, not the full table), and a plain
-- `sum(order_payments.amount) group by order_id` join is cheap at this
-- business's actual scale (low hundreds of entries/day, per PRD §6).
-- A stored `payment_status` would need the exact same historical-edit-
-- cascade discipline §3.4 already had to build for stock_entries
-- (recompute forward on every payment write) for a genuinely marginal
-- read-performance win this app doesn't need — not worth the second
-- source of truth. If debtor-list query performance ever becomes a
-- real problem at higher volume, a materialized view is a better fix
-- than a hand-synced column.
--
-- ROW LOCKING: `record_order_payment()` below takes the same
-- pg_advisory_xact_lock discipline §3.4 already established for
-- stock_entries (lock_stock_entry_row(), 20260712091633) and
-- ingredient_entries (lock_ingredient_entry_row(), 20260716090000) —
-- two concurrent payments against the same order (e.g. a part-payment
-- recorded twice in quick succession, or two different staff members
-- both recording a payment for the same debtor at the till) must not
-- both pass an overpayment check computed from the same stale
-- outstanding-balance snapshot. Locked on order_id directly (no
-- existing lock_*_row() helper fits order_payments' key shape, so a
-- small dedicated lock function is added here, following the exact
-- same shape as its two predecessors).
-- ============================================================

-- ============================================================
-- CUSTOMERS
-- Lightweight catalog — not tied to one location (a customer may place
-- orders at either location, e.g. a regular estate-delivery customer
-- who also picks up from canteen). Both staff and admin can create a
-- record (a cashier meets a new credit customer at the till), matching
-- how ingredients_admin_or_restaurant_insert already widens catalog
-- INSERT beyond admin-only where a non-admin genuinely originates the
-- record (§4).
-- ============================================================

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  location location_type,  -- nullable -- a customer isn't tied to one location, don't force it
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);

create index customers_name_idx on public.customers (name);
create index customers_location_idx on public.customers (location);

alter table public.customers enable row level security;

-- Any authenticated staff or admin can read the full catalog -- a
-- debtor/customer isn't confidential to one location the way
-- stock_entries/expenses are, and a cashier at either location may
-- need to find an existing customer record rather than create a
-- duplicate. Same "everyone reads, scoped insert" shape as
-- delivery_locations_select_all / items_select_all (§4), except here
-- INSERT is also open to any staff member, not just admin -- see the
-- catalog comment above.
create policy "customers_select_all" on public.customers
  for select using (true);

create policy "customers_insert_any_authenticated" on public.customers
  for insert with check (
    created_by = auth.uid()
  );

-- Admin-only update -- correcting a customer's name/phone/location
-- after the fact (a typo, a customer relocating) is an admin
-- correction, same "admin edits, staff only append" shape as
-- stock_entries/ingredient_entries updates outside the same-day
-- window (§4). No delete policy -- customers referenced by orders
-- follow the same "no cascade-delete a referenced catalog row without
-- explicit client confirmation" posture as every other hard-delete
-- decision in §5; not requested for this phase.
create policy "customers_update_admin_only" on public.customers
  for update using (public.is_admin());

-- ============================================================
-- ORDERS: add customer_id
-- Nullable -- cash/till-only orders don't need one. Linking a
-- cash-paid order to a customer is still allowed (e.g. a regular
-- customer's order history), not restricted to credit orders only.
-- customer_name (free text) is UNCHANGED and remains the
-- display/fallback label on every existing screen -- this is additive,
-- not a replacement.
-- ============================================================

alter table public.orders
  add column customer_id uuid references public.customers(id);

create index orders_customer_id_idx on public.orders (customer_id);

-- ============================================================
-- ORDER_PAYMENTS
-- Append-only ledger -- see the file header above for why this is not
-- a single mutable balance/status column. Mirrors
-- ingredient_purchases' "append-only log of an event, immutable once
-- logged" shape (§2) more than it mirrors stock_entries' upsert-per-
-- period shape, since a payment is a discrete event with its own
-- timestamp, not a daily aggregate.
-- ============================================================

create table public.order_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  recorded_by uuid not null references public.users(id),
  note text,
  created_at timestamptz not null default now()

  -- No updated_at / update trigger, no update/delete RLS policy:
  -- payments are immutable once logged, same posture as
  -- ingredient_purchases (§2) -- a mistaken payment entry is a
  -- business problem for admin to resolve operationally (e.g. logging
  -- a correcting reversal is a real future feature if ever needed),
  -- not a UI edit path.
);

create index order_payments_order_id_idx on public.order_payments (order_id);

alter table public.order_payments enable row level security;

-- Scoped via a join back to the parent order's location, same
-- principle order_items already uses (§4) -- order_payments has no
-- location column of its own.
create policy "order_payments_select_scoped" on public.order_payments
  for select using (
    exists (
      select 1 from public.orders
      where orders.id = order_payments.order_id
        and (public.is_admin() or orders.location = public.my_location())
    )
  );

-- INSERT is not exposed directly to staff/admin via a plain table
-- insert -- see record_order_payment() below, which is the only
-- supported write path (it needs to run the overpayment check and
-- advisory lock atomically, the same "one function call = one
-- transaction" discipline every other stock_entries/order writer in
-- this schema already follows). No RLS INSERT policy is defined here
-- on purpose: with no INSERT policy at all, RLS denies every insert on
-- this table by default -- including from inside a plain `security
-- invoker` function, which runs as the calling user and is subject to
-- the exact same RLS as a bare client insert would be. That's why
-- record_order_payment() below is `security definer`, not `security
-- invoker` -- it needs to actually perform the insert despite there
-- being no INSERT policy granting it, with its own explicit
-- `is_admin() or location = my_location()` check taking over as the
-- real authorization boundary. (A same-shaped bug was already caught
-- once in this schema on record_ingredient_purchase() -- see
-- 01_DATA_MODEL.md's ingredients-RLS note -- though that case was
-- fixed by widening the underlying UPDATE policy instead, since a
-- direct client update was still meant to be allowed there. Here,
-- direct client inserts are deliberately never meant to be allowed at
-- all, so `security definer` is the correct fix, not a widened
-- policy.) See docs/01_DATA_MODEL.md §4's write_audit_log()/
-- canteen_supplied_total() for this schema's existing `security
-- definer` precedent for "the function must act with elevated
-- privilege because RLS at the table level is deliberately closed."
--
-- (Note: this differs from every other append-only table in this
-- schema, which DOES expose a plain RLS-gated INSERT policy alongside
-- its write function/route, e.g. ingredient_purchases_insert_restaurant.
-- The difference here is that recording a payment MUST pass through
-- the overpayment recheck + advisory lock inside one transaction --
-- a bare client-side insert has no way to enforce "don't exceed the
-- outstanding balance" itself, whereas ingredient_purchases' plain
-- insert has no equivalent invariant to protect.)

-- ============================================================
-- record_order_payment()
-- The only write path for order_payments. Validates the order exists,
-- is visible to the caller (their own location, or admin), and that
-- the new payment does not push the order's total paid beyond its
-- total_amount -- rejected with a clear error (errcode P0005,
-- 'overpayment: ...') if so, same "distinct SQLSTATE per rejection
-- reason" convention §3.4 already established (P0002/P0003/P0004). An
-- order that doesn't exist or isn't visible to the caller uses a
-- separate code, P0006 ('unknown_order: ...') -- kept distinct from
-- P0004's existing 'unknown_item' meaning on create_staff_meal_entry()
-- (§3.5) so the two "not found" cases can't collide into the wrong
-- describeSaveError() message.
--
-- Row locking: pg_advisory_xact_lock keyed on the order's id, taken
-- before reading the existing sum of payments -- same rationale as
-- lock_stock_entry_row()/lock_ingredient_entry_row() (§3.4): two
-- concurrent payment inserts against the same order must not both
-- compute their overpayment check from the same stale
-- already-paid snapshot and both pass when only one legitimately
-- should.
--
-- `security definer` + `set search_path = public`: runs with the
-- function owner's privilege, since order_payments has no INSERT
-- policy of its own for it to run as the caller against (see the
-- comment above the table's RLS block). The function's own explicit
-- `is_admin() or location = my_location()` check on the orders lookup
-- below is what actually enforces the same location boundary
-- order_payments_select_scoped applies for reads -- this is a
-- deliberate, narrow RLS bypass for this one write path, not a general
-- one, matching this schema's existing `security definer` precedent
-- (write_audit_log(), canteen_supplied_total() -- see
-- docs/01_DATA_MODEL.md §4) rather than record_ingredient_purchase()'s
-- `security invoker` precedent, which doesn't apply here since that
-- function relies on an UPDATE policy that was (correctly) widened to
-- allow the caller directly -- there is no equivalent "direct client
-- insert should be allowed" case for order_payments.
-- ============================================================

create or replace function public.lock_order_payments_row(p_order_id uuid)
returns void
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtext('order_payments:' || p_order_id::text));
end;
$$;

create or replace function public.record_order_payment(
  p_order_id uuid,
  p_amount numeric,
  p_recorded_by uuid,
  p_note text default null,
  p_paid_at timestamptz default now()
)
returns public.order_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_already_paid numeric(10,2);
  v_outstanding numeric(10,2);
  v_row public.order_payments;
begin
  perform public.lock_order_payments_row(p_order_id);

  select * into v_order
  from public.orders
  where id = p_order_id
    and (public.is_admin() or location = public.my_location());

  if not found then
    raise exception 'unknown_order: order not found or not visible to this user'
      using errcode = 'P0006';
  end if;

  select coalesce(sum(amount), 0) into v_already_paid
  from public.order_payments
  where order_id = p_order_id;

  v_outstanding := v_order.total_amount - v_already_paid;

  if p_amount > v_outstanding then
    raise exception 'overpayment: only % outstanding on this order', v_outstanding
      using errcode = 'P0005';
  end if;

  insert into public.order_payments (order_id, amount, paid_at, recorded_by, note)
  values (p_order_id, p_amount, coalesce(p_paid_at, now()), p_recorded_by, p_note)
  returning * into v_row;

  return v_row;
end;
$$;

-- ============================================================
-- public.create_order() -- extended with p_customer_id
-- (20260712080310_orders_write_function.sql's original definition)
--
-- Adds a new, optional, trailing parameter (p_customer_id, default
-- null) via `create or replace function` -- Postgres allows this
-- without dropping/recreating the function or breaking any existing
-- caller that doesn't pass it, since it's appended after every
-- pre-existing parameter (all of which keep their exact names,
-- positions, and defaults). Every line of the original function body
-- is otherwise byte-for-byte unchanged; only the INSERT's column list
-- gains customer_id.
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
  p_delivery_fee_snapshot numeric default 0,
  p_customer_id uuid default null
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
      client_request_id, created_by, customer_id
    )
    values (
      p_location, p_order_date, p_customer_name, p_fulfillment_type,
      p_delivery_location_id, p_delivery_fee_snapshot, p_total_amount,
      p_client_request_id, p_created_by, p_customer_id
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

-- ============================================================
-- dashboard_outstanding_total()
-- Admin dashboard's new "Total Outstanding" figure (brief's item 6 —
-- outstanding credit is a SEPARATE reporting concern from net profit,
-- never a delay/adjustment to it; a credit sale already counts toward
-- sales/COGS/profit immediately via the existing orders -> stock_entries
-- path, unchanged by this phase). Sums every order's outstanding
-- balance (total_amount - sum(order_payments.amount)) across every
-- order that has a customer_id at all -- not period-scoped, since an
-- unpaid balance from last month is still owed today; this is a
-- point-in-time balance figure, not a period flow like sales/cost/
-- expenses. Admin-only in practice (only called from
-- GET /api/dashboard/summary), but not itself RLS-dependent for its
-- correctness -- security invoker, same convention as every other
-- dashboard_*() function (§4), so it only ever sums orders already
-- visible under orders_select_scoped to whoever calls it.
-- ============================================================

create or replace function public.dashboard_outstanding_total()
returns numeric
language sql
security invoker
stable
as $$
  select coalesce(sum(
    o.total_amount - coalesce(p.paid, 0)
  ), 0)
  from public.orders o
  left join (
    select order_id, sum(amount) as paid
    from public.order_payments
    group by order_id
  ) p on p.order_id = o.id
  where o.customer_id is not null
    and o.total_amount > coalesce(p.paid, 0);
$$;

-- ============================================================
-- dashboard_debtors()
-- Aggregated outstanding-balance-per-customer view for the admin
-- debtors screen (GET /api/admin/debtors) -- one row per customer with
-- at least one order carrying an outstanding balance, across BOTH
-- locations (a debtor isn't scoped to one location any more than the
-- customers catalog itself is, §4). Optional p_from/p_to narrows which
-- ORDERS count toward the total (matching the existing period-filter
-- convention on dashboard_stock_summary() etc.) -- both null means
-- "all orders, no date filter," which is the debtors list's natural
-- default (an old unpaid balance doesn't stop being owed just because
-- it falls outside "this week").
-- ============================================================

create or replace function public.dashboard_debtors(
  p_from date default null,
  p_to date default null
)
returns table (
  customer_id uuid,
  customer_name text,
  customer_phone text,
  total_amount numeric,
  total_paid numeric,
  outstanding numeric,
  order_count bigint,
  oldest_unpaid_date date
)
language sql
security invoker
stable
as $$
  select
    c.id as customer_id,
    c.name as customer_name,
    c.phone as customer_phone,
    sum(o.total_amount) as total_amount,
    sum(coalesce(p.paid, 0)) as total_paid,
    sum(o.total_amount - coalesce(p.paid, 0)) as outstanding,
    count(*) as order_count,
    min(o.order_date) as oldest_unpaid_date
  from public.orders o
  join public.customers c on c.id = o.customer_id
  left join (
    select order_id, sum(amount) as paid
    from public.order_payments
    group by order_id
  ) p on p.order_id = o.id
  where o.customer_id is not null
    and o.total_amount > coalesce(p.paid, 0)
    and (p_from is null or o.order_date >= p_from)
    and (p_to is null or o.order_date <= p_to)
  group by c.id, c.name, c.phone
  order by outstanding desc;
$$;
