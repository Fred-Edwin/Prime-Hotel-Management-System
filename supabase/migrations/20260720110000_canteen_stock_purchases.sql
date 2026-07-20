-- ============================================================
-- canteen_stock_purchases: admin's purchase log for canteen's own
-- stock (items.supply_type = 'canteen_independent' only — cyber,
-- retail lines canteen buys and sells with no restaurant-side
-- counterpart). Mirrors ingredient_purchases/record_ingredient_purchase()
-- (20260719161000_ingredient_purchases.sql) exactly, adapted for
-- canteen's added_stock instead of ingredient_entries.received.
--
-- WHY THIS EXISTS: today, canteen_independent items' added_stock is
-- just a plain number Anne types on /entry each week (see
-- CanteenEntryClient.tsx / save_stock_entry_canteen_field()) — there is
-- no real purchase event and no real cost input behind it.
-- items.buying_price is a static, admin-typed catalog field, same
-- problem ingredients had before their own purchases redesign. This
-- closes that gap for canteen the same way, per direct user request:
-- WaPrecious (who actually buys canteen's own stock — she deals with
-- suppliers, same as ingredients) logs a real purchase (quantity + real
-- unit cost paid), which (a) recalculates items.buying_price as a
-- running weighted-average cost, and (b) folds the quantity additively
-- into that week's stock_entries.added_stock, so Anne never re-types it.
--
-- SCOPE, DELIBERATELY NARROW: canteen_supplied items are explicitly
-- EXCLUDED — their added_stock must only ever come from the
-- restaurant's sent_out via canteen_supplied_total() (§3.1). Letting
-- admin also inject stock there would double-count against that
-- aggregation and break the single-source-of-truth guarantee the whole
-- restaurant->canteen link depends on. Enforced with a trigger (not just
-- application-layer validation), since RLS/route bugs shouldn't be the
-- only thing standing between this table and a supply_type mismatch.
--
-- NOT store-manager-shared like ingredient_purchases: ingredients let
-- both admin AND the store manager log a purchase, because the
-- restaurant's store manager physically receives deliveries at the
-- central store. Canteen has no equivalent role — Anne doesn't buy
-- canteen's own stock, WaPrecious does — so this is admin-only, insert
-- and select alike.
-- ============================================================

create table public.canteen_stock_purchases (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id),
  purchase_date date not null,  -- normalized to that week's Monday server-side, same convention as canteen stock_entries (§3.1)
  quantity numeric(10,2) not null check (quantity > 0),
  unit_cost numeric(10,2) not null check (unit_cost >= 0),
  total_cost numeric(10,2) not null,  -- quantity * unit_cost, stored not generated -- see CLAUDE.md
  supplier_note text,                 -- optional free-text, mirrors expenses.note / ingredient_purchases.supplier_note

  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);

create index canteen_stock_purchases_date_idx on public.canteen_stock_purchases (purchase_date);
create index canteen_stock_purchases_item_idx on public.canteen_stock_purchases (item_id);

alter table public.canteen_stock_purchases enable row level security;

-- Admin-only, both directions -- unlike ingredient_purchases, there is
-- no store-manager-equivalent role at canteen who also buys stock.
create policy "canteen_stock_purchases_select_admin" on public.canteen_stock_purchases
  for select using (public.is_admin());
create policy "canteen_stock_purchases_insert_admin" on public.canteen_stock_purchases
  for insert with check (public.is_admin());
-- No update/delete policy: append-only log, same convention as
-- ingredient_purchases/orders/expenses -- a logging mistake is a
-- business problem for admin to resolve operationally (e.g. a
-- corrective follow-up purchase), not a UI edit path.

-- Belt-and-suspenders guard against logging a purchase for anything
-- other than a canteen_independent item -- catches both a route-layer
-- bug and any future direct-SQL/service-role misuse, not just the
-- application-level check in record_canteen_stock_purchase() below.
create or replace function public.check_canteen_stock_purchase_item()
returns trigger
language plpgsql
as $$
declare
  v_supply_type item_supply_type;
begin
  select supply_type into v_supply_type from public.items where id = new.item_id;
  if v_supply_type is distinct from 'canteen_independent' then
    raise exception 'canteen_stock_purchases.item_id must reference a canteen_independent item (got: %)', v_supply_type
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger canteen_stock_purchases_item_check
  before insert on public.canteen_stock_purchases
  for each row execute function public.check_canteen_stock_purchase_item();

-- ============================================================
-- record_canteen_stock_purchase(): the single write path
-- /dashboard/canteen-purchases calls. Same weighted-average costing
-- formula as record_ingredient_purchase(), same "reuse the existing
-- single-field save function rather than duplicate its oversell/lock
-- logic" approach.
--
-- Reuses lock_stock_entry_row(item_id, 'canteen', week_start) — the
-- SAME advisory lock save_stock_entry_canteen_field() itself takes, so
-- this serializes correctly against a concurrent autosave from Anne's
-- /entry screen touching the same item/week (the same race
-- record_ingredient_purchase() already guards against for ingredients,
-- via lock_ingredient_entry_row()).
-- ============================================================

create or replace function public.record_canteen_stock_purchase(
  p_item_id uuid,
  p_purchase_date date,   -- any date in the target week; normalized to that week's Monday here
  p_quantity numeric,
  p_unit_cost numeric,
  p_created_by uuid,
  p_supplier_note text default null
)
returns public.canteen_stock_purchases
language plpgsql
security invoker
as $$
declare
  v_week_start date := date_trunc('week', p_purchase_date::timestamp)::date;
  v_supply_type item_supply_type;
  v_selling_price numeric(10,2);
  v_buying_price numeric(10,2);
  v_qty_on_hand numeric(10,2);
  v_old_avg_cost numeric(10,2);
  v_new_avg_cost numeric(10,2);
  v_existing_entry public.stock_entries;
  v_purchase public.canteen_stock_purchases;
begin
  select supply_type, selling_price, buying_price
    into v_supply_type, v_selling_price, v_buying_price
  from public.items where id = p_item_id;

  if v_supply_type is distinct from 'canteen_independent' then
    raise exception 'Only canteen_independent items can have a canteen stock purchase logged'
      using errcode = '23514';
  end if;

  perform public.lock_stock_entry_row(p_item_id, 'canteen', v_week_start);

  -- Quantity on hand right now = this week's opening_stock + added_stock
  -- so far (mirrors record_ingredient_purchase()'s own derivation), or
  -- the prior week's closing_stock if this week has no row yet.
  select * into v_existing_entry
  from public.stock_entries
  where item_id = p_item_id and location = 'canteen' and entry_date = v_week_start;

  if v_existing_entry.id is not null then
    v_qty_on_hand := v_existing_entry.opening_stock + v_existing_entry.added_stock;
  else
    select closing_stock into v_qty_on_hand
    from public.stock_entries
    where item_id = p_item_id and location = 'canteen' and entry_date < v_week_start
    order by entry_date desc
    limit 1;
    v_qty_on_hand := coalesce(v_qty_on_hand, 0);
  end if;

  v_old_avg_cost := v_buying_price;

  -- Weighted average: blend existing stock's cost with this purchase's
  -- cost, proportional to quantity -- same formula as
  -- record_ingredient_purchase() / 00_ARCHITECTURE.md §11's worked
  -- example. If there's no stock on hand yet, the new cost is just this
  -- purchase's price.
  if v_qty_on_hand + p_quantity = 0 then
    v_new_avg_cost := p_unit_cost;
  else
    v_new_avg_cost := (v_qty_on_hand * coalesce(v_old_avg_cost, 0) + p_quantity * p_unit_cost)
      / (v_qty_on_hand + p_quantity);
  end if;

  insert into public.canteen_stock_purchases (
    item_id, purchase_date, quantity, unit_cost, total_cost, supplier_note, created_by
  )
  values (
    p_item_id, v_week_start, p_quantity, p_unit_cost, p_quantity * p_unit_cost, p_supplier_note, p_created_by
  )
  returning * into v_purchase;

  update public.items
  set buying_price = v_new_avg_cost
  where id = p_item_id;

  -- Fold additively into this week's stock_entries.added_stock and
  -- recompute closing_stock/values at the fresh average -- reuses
  -- save_stock_entry_canteen_field() so oversell-checking and the
  -- advisory lock stay in exactly one place, matching how
  -- record_ingredient_purchase() reuses save_ingredient_entry().
  -- till_quantity_sold is omitted (null) so it's preserved from
  -- whatever the row already has, same "omit to preserve" convention
  -- as every other canteen autosave call.
  perform public.save_stock_entry_canteen_field(
    p_item_id,
    v_week_start,
    false,  -- p_is_canteen_supplied: always false here, enforced above
    null,   -- p_till_quantity_sold: preserve
    coalesce(v_existing_entry.added_stock, 0) + p_quantity,
    v_selling_price,
    v_new_avg_cost,
    p_created_by
  );

  return v_purchase;
end;
$$;
