-- ============================================================
-- recalculate_stock_entry()
-- Recomputes quantity_sold (and the values derived from it) for one
-- stock_entries row from its two inputs. Called after any write to
-- till_quantity_sold, and after any order_items insert/delete that
-- touches this item/location/date. Never called with a client-supplied
-- total -- it always re-derives from the two source numbers itself,
-- so two concurrent writers can never clobber each other.
-- See docs/01_DATA_MODEL.md §3.4.
-- ============================================================

create or replace function public.recalculate_stock_entry(
  p_item_id uuid,
  p_location location_type,
  p_entry_date date
)
returns void
language plpgsql
security definer
as $$
declare
  v_order_total numeric(10,2);
begin
  select coalesce(sum(oi.quantity), 0) into v_order_total
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.item_id = p_item_id
    and o.location = p_location
    and o.order_date = p_entry_date;

  update public.stock_entries
  set quantity_sold = till_quantity_sold + v_order_total
  where item_id = p_item_id
    and location = p_location
    and entry_date = p_entry_date;

  -- closing_stock / sales_value / cost_value are then recalculated
  -- from the updated quantity_sold in the same route handler
  -- transaction, via lib/calculations.ts -- not duplicated here in SQL.
end;
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.users enable row level security;
alter table public.items enable row level security;
alter table public.ingredients enable row level security;
alter table public.ingredient_entries enable row level security;
alter table public.stock_entries enable row level security;
alter table public.expenses enable row level security;

-- Helper: is the current user an admin?
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Helper: what location is the current user scoped to? (null = admin/all)
create or replace function public.my_location()
returns location_type
language sql
security definer
stable
as $$
  select location from public.users where id = auth.uid();
$$;

-- USERS: everyone can read their own row; only admin can read/write all
create policy "users_select_own_or_admin" on public.users
  for select using (id = auth.uid() or public.is_admin());
create policy "users_admin_write" on public.users
  for all using (public.is_admin());

-- ITEMS: everyone (staff + admin) can read; only admin can write
create policy "items_select_all" on public.items
  for select using (true);
create policy "items_admin_write" on public.items
  for insert with check (public.is_admin());
create policy "items_admin_update" on public.items
  for update using (public.is_admin());

-- INGREDIENTS: restaurant staff + admin can read (canteen has no
-- reason to see ingredient catalog); only admin can write, same
-- pattern as items
create policy "ingredients_select_restaurant_or_admin" on public.ingredients
  for select using (
    public.is_admin() or public.my_location() = 'restaurant'
  );
create policy "ingredients_admin_write" on public.ingredients
  for insert with check (public.is_admin());
create policy "ingredients_admin_update" on public.ingredients
  for update using (public.is_admin());

-- INGREDIENT_ENTRIES: restaurant staff + admin can read; only the
-- authenticated user themself can insert (app-level check further
-- restricts this to the store-manager-flagged user -- see
-- 00_ARCHITECTURE.md §5.1, this is a UI/route-handler check, not
-- a separate RLS-enforced role, consistent with how store-manager
-- responsibilities are handled everywhere else); no update except
-- by admin, protects historical entries same as stock_entries
create policy "ingredient_entries_select_restaurant_or_admin" on public.ingredient_entries
  for select using (
    public.is_admin() or public.my_location() = 'restaurant'
  );
create policy "ingredient_entries_insert_restaurant" on public.ingredient_entries
  for insert with check (
    created_by = auth.uid()
    and (public.is_admin() or public.my_location() = 'restaurant')
  );
create policy "ingredient_entries_update_admin_only" on public.ingredient_entries
  for update using (public.is_admin());

-- STOCK_ENTRIES: staff see/write only their own location's rows;
-- admin sees/writes all; nobody can update a row they didn't create
-- unless they're admin (protects historical entries -- see scope doc)
create policy "stock_select_scoped" on public.stock_entries
  for select using (
    public.is_admin() or location = public.my_location()
  );
create policy "stock_insert_scoped" on public.stock_entries
  for insert with check (
    created_by = auth.uid()
    and (public.is_admin() or location = public.my_location())
  );
create policy "stock_update_admin_only" on public.stock_entries
  for update using (public.is_admin());

-- EXPENSES: same pattern as stock_entries
create policy "expenses_select_scoped" on public.expenses
  for select using (
    public.is_admin() or location = public.my_location()
  );
create policy "expenses_insert_scoped" on public.expenses
  for insert with check (
    created_by = auth.uid()
    and (public.is_admin() or location = public.my_location())
  );
create policy "expenses_update_admin_only" on public.expenses
  for update using (public.is_admin());

-- DELIVERY_LOCATIONS: everyone (staff + admin) can read, same
-- pattern as items; only admin can write
alter table public.delivery_locations enable row level security;

create policy "delivery_locations_select_all" on public.delivery_locations
  for select using (true);
create policy "delivery_locations_admin_write" on public.delivery_locations
  for insert with check (public.is_admin());
create policy "delivery_locations_admin_update" on public.delivery_locations
  for update using (public.is_admin());

-- ORDERS: same location-scoped pattern as stock_entries/expenses
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

create policy "orders_select_scoped" on public.orders
  for select using (
    public.is_admin() or location = public.my_location()
  );
create policy "orders_insert_scoped" on public.orders
  for insert with check (
    created_by = auth.uid()
    and (public.is_admin() or location = public.my_location())
  );
create policy "orders_update_admin_only" on public.orders
  for update using (public.is_admin());

-- ORDER_ITEMS: no location column of its own -- scoped via a join
-- back to the parent order's location, same principle as every
-- other location boundary in this schema
create policy "order_items_select_scoped" on public.order_items
  for select using (
    exists (
      select 1 from public.orders
      where orders.id = order_items.order_id
        and (public.is_admin() or orders.location = public.my_location())
    )
  );
create policy "order_items_insert_scoped" on public.order_items
  for insert with check (
    exists (
      select 1 from public.orders
      where orders.id = order_items.order_id
        and orders.created_by = auth.uid()
        and (public.is_admin() or orders.location = public.my_location())
    )
  );

-- ============================================================
-- Cross-location exception: canteen needs the RESTAURANT's
-- sent_out totals for canteen_supplied items to populate its
-- weekly added_stock (see §3.1). Table-level RLS on stock_entries
-- stays fully location-scoped -- do NOT widen the select policy
-- above to let canteen read restaurant rows directly. Instead,
-- expose only the narrow aggregate through a security definer
-- function, so canteen staff can never see the restaurant's
-- opening/closing stock, sales, or unrelated items.
-- ============================================================
create or replace function public.canteen_supplied_total(
  p_item_id uuid,
  p_week_start date,
  p_week_end date
)
returns numeric
language sql
security definer
stable
as $$
  select coalesce(sum(sent_out), 0)
  from public.stock_entries
  where item_id = p_item_id
    and location = 'restaurant'
    and entry_date >= p_week_start
    and entry_date <= p_week_end
    and exists (
      select 1 from public.items
      where id = p_item_id and supply_type = 'canteen_supplied'
    );
$$;

-- Callable by any authenticated canteen staff member or admin --
-- enforced in the route handler that calls it (canteen location
-- check), not by a table grant, since the function itself only
-- ever returns a single summed number, never full rows.

-- ============================================================
-- login_roster()
-- Login UX addition (Phase 2) not present in the original
-- 01_DATA_MODEL.md draft, flagged and documented there in the same
-- phase per CLAUDE.md's change-handling rule. The login screen is a
-- name picker (00_ARCHITECTURE.md §5), but users_select_own_or_admin
-- requires auth.uid() -- an anonymous pre-login client can't read
-- anything from public.users. This narrow security-definer function
-- exposes ONLY `name`, nothing else (no staff_code, no role, no
-- location, no PIN-adjacent data) -- same "narrow function instead
-- of widening a table policy" pattern as canteen_supplied_total().
-- The login route handler resolves the selected name to staff_code/
-- synthetic email server-side after this call.
-- ============================================================
create or replace function public.login_roster()
returns table (name text)
language sql
security definer
stable
as $$
  select name from public.users order by name;
$$;

grant execute on function public.login_roster() to anon;
