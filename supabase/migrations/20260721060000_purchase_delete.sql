-- ============================================================
-- Reversible delete for ingredient_purchases / canteen_stock_purchases
-- (post-launch client request, 2026-07-21 — WaPrecious needs to remove
-- a mis-logged purchase, not just correct it going forward).
--
-- Both purchase tables were deliberately built append-only, no
-- update/delete RLS policy at all (20260719161000_ingredient_purchases.sql,
-- 20260720110000_canteen_stock_purchases.sql) — "a logging mistake is a
-- business problem for admin to resolve operationally... not a UI edit
-- path." That reasoning covered *editing* a purchase (which would let a
-- past cost figure quietly change under an already-derived average) but
-- under-covered outright *removal* of a purchase that never should have
-- existed at all (wrong item, duplicate entry, fat-fingered quantity).
-- This migration adds a narrow, admin-only DELETE RLS policy on both
-- tables (no staff/store-manager delete access at all — deleting a
-- purchase is an admin-only correction, unlike logging one, which
-- ingredient_purchases also allows the store manager to do) plus two
-- security-invoker functions that correctly unwind BOTH side effects a
-- purchase caused at insert time:
--
--   1. items.buying_price / ingredients.buying_price is a running
--      weighted-average cost, recalculated on every purchase (00_ARCHITECTURE.md
--      §11). Simply deleting the purchase row would leave a stale,
--      now-unexplainable average in place. This can't be inverted with a
--      single algebraic step if a *later* purchase for the same item/
--      ingredient already blended into that average — so instead of
--      inverting, these functions REPLAY every remaining purchase for
--      that item/ingredient in chronological order from zero, which is
--      correct regardless of deletion order and requires no assumption
--      about which purchase was "last." Purchase volume for a
--      single-business app is small (dozens, not thousands, per item)
--      so a full replay is cheap — not a performance concern.
--
--   2. The purchase's quantity was folded additively into that period's
--      ingredient_entries.received / stock_entries.added_stock. Deleting
--      the purchase must subtract that quantity back out, then re-run
--      the SAME forward recompute chain (recompute_ingredient_entry_chain/
--      recompute_stock_entry_chain, 20260720100000_historical_ledger_edit_cascade.sql)
--      the admin ledger-edit path already uses — so a downstream oversell
--      the removal reveals rolls back the whole delete atomically, exactly
--      like a historical ledger edit does.
--
-- Deliberately NOT exposed as a generic "delete any row" capability —
-- these functions are purpose-built for exactly this one correction, not
-- a general table-delete primitive. They're security invoker (not
-- definer), so the admin-only DELETE policy below is the real
-- enforcement — a non-admin calling either function directly would still
-- be blocked by RLS at the `delete from` statement inside it, same
-- discipline as every other write path in this codebase (route-level
-- requireAdmin() check + RLS policy, never RLS alone per CLAUDE.md).
-- ============================================================

create policy "ingredient_purchases_delete_admin" on public.ingredient_purchases
  for delete using (public.is_admin());

create policy "canteen_stock_purchases_delete_admin" on public.canteen_stock_purchases
  for delete using (public.is_admin());

-- Rebuilds ingredients.buying_price from scratch by replaying every
-- remaining ingredient_purchases row for this ingredient, oldest first,
-- using the exact same weighted-average formula record_ingredient_purchase()
-- applies incrementally. If no purchases remain, buying_price is left
-- untouched (there's nothing to derive it from — admin's manual catalog
-- price, if any, stands).
create or replace function public.rebuild_ingredient_buying_price(p_ingredient_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  v_purchase record;
  v_qty_on_hand numeric(10,2) := 0;
  v_avg_cost numeric(10,2);
  v_found boolean := false;
begin
  select buying_price into v_avg_cost from public.ingredients where id = p_ingredient_id;

  for v_purchase in
    select quantity, unit_cost from public.ingredient_purchases
    where ingredient_id = p_ingredient_id
    order by purchase_date, created_at
  loop
    v_found := true;
    if v_qty_on_hand + v_purchase.quantity = 0 then
      v_avg_cost := v_purchase.unit_cost;
    else
      v_avg_cost := (v_qty_on_hand * coalesce(v_avg_cost, 0) + v_purchase.quantity * v_purchase.unit_cost)
        / (v_qty_on_hand + v_purchase.quantity);
    end if;
    v_qty_on_hand := v_qty_on_hand + v_purchase.quantity;
  end loop;

  if v_found then
    update public.ingredients set buying_price = v_avg_cost where id = p_ingredient_id;
  end if;
end;
$$;

-- Canteen sibling — identical shape, items.buying_price instead of
-- ingredients.buying_price.
create or replace function public.rebuild_canteen_item_buying_price(p_item_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  v_purchase record;
  v_qty_on_hand numeric(10,2) := 0;
  v_avg_cost numeric(10,2);
  v_found boolean := false;
begin
  select buying_price into v_avg_cost from public.items where id = p_item_id;

  for v_purchase in
    select quantity, unit_cost from public.canteen_stock_purchases
    where item_id = p_item_id
    order by purchase_date, created_at
  loop
    v_found := true;
    if v_qty_on_hand + v_purchase.quantity = 0 then
      v_avg_cost := v_purchase.unit_cost;
    else
      v_avg_cost := (v_qty_on_hand * coalesce(v_avg_cost, 0) + v_purchase.quantity * v_purchase.unit_cost)
        / (v_qty_on_hand + v_purchase.quantity);
    end if;
    v_qty_on_hand := v_qty_on_hand + v_purchase.quantity;
  end loop;

  if v_found then
    update public.items set buying_price = v_avg_cost where id = p_item_id;
  end if;
end;
$$;

-- delete_ingredient_purchase(): the single write path
-- DELETE /api/ingredient-purchases/[id] calls. Admin-only (enforced in
-- the route handler, same as every other admin write in this codebase —
-- RLS has no delete policy on ingredient_purchases at all, so this
-- function is the only way a purchase can ever be removed).
create or replace function public.delete_ingredient_purchase(p_purchase_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  v_purchase public.ingredient_purchases;
  v_entry public.ingredient_entries;
begin
  select * into v_purchase from public.ingredient_purchases where id = p_purchase_id;
  if v_purchase.id is null then
    raise exception 'Purchase not found' using errcode = 'P0005';
  end if;

  perform public.lock_ingredient_entry_row(v_purchase.ingredient_id, v_purchase.purchase_date);

  select * into v_entry from public.ingredient_entries
  where ingredient_id = v_purchase.ingredient_id and entry_date = v_purchase.purchase_date;

  delete from public.ingredient_purchases where id = p_purchase_id;

  -- Subtract the purchase's quantity back out of that day's received,
  -- then let recompute_ingredient_entry_chain() re-derive
  -- opening_stock/closing_stock/values forward from here (and raise on
  -- a downstream oversell the removal reveals) — same cascade the admin
  -- ledger-edit route already relies on.
  if v_entry.id is not null then
    update public.ingredient_entries
    set received = greatest(v_entry.received - v_purchase.quantity, 0)
    where id = v_entry.id;

    perform public.recompute_ingredient_entry_chain(v_purchase.ingredient_id, v_purchase.purchase_date);
  end if;

  perform public.rebuild_ingredient_buying_price(v_purchase.ingredient_id);
end;
$$;

-- delete_canteen_stock_purchase(): canteen sibling. Mirrors the
-- ingredient version, adjusting added_stock instead of received and
-- reusing recompute_stock_entry_chain() (location = 'canteen') instead
-- of the ingredient chain function.
create or replace function public.delete_canteen_stock_purchase(p_purchase_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  v_purchase public.canteen_stock_purchases;
  v_entry public.stock_entries;
begin
  select * into v_purchase from public.canteen_stock_purchases where id = p_purchase_id;
  if v_purchase.id is null then
    raise exception 'Purchase not found' using errcode = 'P0005';
  end if;

  perform public.lock_stock_entry_row(v_purchase.item_id, 'canteen', v_purchase.purchase_date);

  select * into v_entry from public.stock_entries
  where item_id = v_purchase.item_id and location = 'canteen' and entry_date = v_purchase.purchase_date;

  delete from public.canteen_stock_purchases where id = p_purchase_id;

  if v_entry.id is not null then
    update public.stock_entries
    set added_stock = greatest(v_entry.added_stock - v_purchase.quantity, 0)
    where id = v_entry.id;

    perform public.recompute_stock_entry_chain(v_purchase.item_id, 'canteen', v_purchase.purchase_date);
  end if;

  perform public.rebuild_canteen_item_buying_price(v_purchase.item_id);
end;
$$;
