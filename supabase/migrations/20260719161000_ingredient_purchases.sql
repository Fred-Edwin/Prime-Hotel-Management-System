-- ============================================================
-- ingredient_purchases: a real purchase log, separate from the
-- daily ingredient_entries stock-movement ledger.
--
-- Problem this fixes: ingredients.buying_price was a static,
-- admin-typed catalog field, and ingredient_entries.received was a
-- single per-day upserted number -- if two purchases landed on the
-- same day (e.g. admin buys some flour, then the store manager
-- receives a separate delivery later that day), the second
-- save_ingredient_entry() call would silently overwrite the first
-- one's `received` and `buying_price_snapshot`, losing both the
-- quantity and the price of whichever purchase saved first. There
-- was also no history of individual purchases or their prices at
-- all -- only "today's ingredient_entries row," clobbered on every
-- write.
--
-- Fix: ingredient_purchases is an append-only log, one row per
-- buying event (quantity, unit_cost, who, when), immutable once
-- written -- both admin and the store manager can insert. Each
-- insert folds additively into that day's ingredient_entries.received
-- (never overwrites) and recalculates ingredients.buying_price as a
-- running weighted-average cost across current stock on hand, via
-- record_ingredient_purchase(). ingredient_entries.buying_price_snapshot
-- keeps its existing immutability guarantee (01_DATA_MODEL.md's
-- "price snapshots are permanently immutable" rule) -- it still
-- freezes whatever the average was at the moment that day's entry
-- last saved; only the catalog price it's sourced from is now a
-- real computed average instead of a static manually-typed number.
--
-- ingredients.buying_price remains manually editable by admin on
-- /ingredients at any time (a deliberate override/correction path,
-- e.g. fixing a fat-fingered unit cost) -- this migration does not
-- remove that, it only adds a second, automatic writer to the same
-- column.
-- ============================================================

create table public.ingredient_purchases (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients(id),
  purchase_date date not null,
  quantity numeric(10,2) not null check (quantity > 0),
  unit_cost numeric(10,2) not null check (unit_cost >= 0),
  total_cost numeric(10,2) not null,  -- quantity * unit_cost, stored not generated -- see CLAUDE.md
  supplier_note text,                 -- optional free-text, mirrors expenses.note / wastage_note convention

  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);

create index ingredient_purchases_date_idx on public.ingredient_purchases (purchase_date);
create index ingredient_purchases_ingredient_idx on public.ingredient_purchases (ingredient_id);

alter table public.ingredient_purchases enable row level security;

-- Same shape as ingredient_entries_select_restaurant_or_admin /
-- ingredient_entries_insert_restaurant (01_DATA_MODEL.md §4) --
-- restaurant-location-scoped, admin sees everything. No update/delete
-- policy at all: purchases are an append-only log, not an editable
-- row -- a logging mistake is a business problem for admin to resolve
-- operationally (e.g. a corrective follow-up purchase), not a UI edit
-- path, matching how orders/expenses are never retroactively edited
-- either.
create policy "ingredient_purchases_select_restaurant_or_admin" on public.ingredient_purchases
  for select using (
    public.is_admin() or public.my_location() = 'restaurant'
  );
create policy "ingredient_purchases_insert_restaurant" on public.ingredient_purchases
  for insert with check (
    (created_by = auth.uid() or public.is_admin())
    and (public.is_admin() or public.my_location() = 'restaurant')
  );

-- ============================================================
-- record_ingredient_purchase(): the single write path both admin's
-- new /dashboard/purchases screen and the store manager's /store
-- "Log purchase" action call.
--
-- Reuses lock_ingredient_entry_row() (20260716090000) to serialize
-- against concurrent purchases/entry-saves for the same
-- ingredient+date -- the same race save_ingredient_entry() was
-- already protected against, now extended to this new write path
-- too (two purchases landing for the same ingredient on the same day,
-- one from admin and one from the store manager, must not race each
-- other's weighted-average recalculation).
-- ============================================================

create or replace function public.record_ingredient_purchase(
  p_ingredient_id uuid,
  p_purchase_date date,
  p_quantity numeric,
  p_unit_cost numeric,
  p_created_by uuid,
  p_supplier_note text default null
)
returns public.ingredient_purchases
language plpgsql
security invoker
as $$
declare
  v_qty_on_hand numeric(10,2);
  v_old_avg_cost numeric(10,2);
  v_new_avg_cost numeric(10,2);
  v_existing_entry public.ingredient_entries;
  v_purchase public.ingredient_purchases;
begin
  perform public.lock_ingredient_entry_row(p_ingredient_id, p_purchase_date);

  -- Quantity on hand right now = latest closing_stock strictly before
  -- today, plus whatever's already been received today (mirrors
  -- save_ingredient_entry()'s own opening_stock derivation, but also
  -- accounts for an earlier purchase that already landed today).
  select * into v_existing_entry
  from public.ingredient_entries
  where ingredient_id = p_ingredient_id and entry_date = p_purchase_date;

  if v_existing_entry.id is not null then
    v_qty_on_hand := v_existing_entry.opening_stock + v_existing_entry.received;
  else
    select closing_stock into v_qty_on_hand
    from public.ingredient_entries
    where ingredient_id = p_ingredient_id
      and entry_date < p_purchase_date
    order by entry_date desc
    limit 1;
    v_qty_on_hand := coalesce(v_qty_on_hand, 0);
  end if;

  select buying_price into v_old_avg_cost
  from public.ingredients
  where id = p_ingredient_id;

  -- Weighted average: blend existing stock's cost with this purchase's
  -- cost, proportional to quantity -- see 00_ARCHITECTURE.md §11 for
  -- the worked example of why this isn't a simple replace. If there's
  -- no stock on hand yet, the new cost is just this purchase's price.
  if v_qty_on_hand + p_quantity = 0 then
    v_new_avg_cost := p_unit_cost;
  else
    v_new_avg_cost := (v_qty_on_hand * coalesce(v_old_avg_cost, 0) + p_quantity * p_unit_cost)
      / (v_qty_on_hand + p_quantity);
  end if;

  insert into public.ingredient_purchases (
    ingredient_id, purchase_date, quantity, unit_cost, total_cost, supplier_note, created_by
  )
  values (
    p_ingredient_id, p_purchase_date, p_quantity, p_unit_cost, p_quantity * p_unit_cost, p_supplier_note, p_created_by
  )
  returning * into v_purchase;

  update public.ingredients
  set buying_price = v_new_avg_cost
  where id = p_ingredient_id;

  -- Fold additively into today's ingredient_entries.received and
  -- recompute closing_stock/closing_stock_value at the fresh average
  -- -- reuses save_ingredient_entry() so oversell-checking and the
  -- advisory lock stay in exactly one place, rather than duplicating
  -- that logic here. quantity_used/wastage are preserved from
  -- whatever the row already has (0 for a brand-new row), matching
  -- the "preserve, don't zero" convention already established for
  -- wastage (20260717093000_preserve_wastage_on_stock_entry_save.sql).
  perform public.save_ingredient_entry(
    p_ingredient_id,
    p_purchase_date,
    coalesce(v_existing_entry.received, 0) + p_quantity,
    coalesce(v_existing_entry.quantity_used, 0),
    coalesce(v_existing_entry.wastage, 0),
    v_new_avg_cost,
    p_created_by,
    v_existing_entry.wastage_note
  );

  return v_purchase;
end;
$$;
