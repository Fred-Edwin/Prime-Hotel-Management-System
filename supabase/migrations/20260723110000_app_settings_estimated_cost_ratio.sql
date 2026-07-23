-- ============================================================
-- app_settings — single-row table of business-wide, admin-editable
-- settings. First (and only, for now) value: estimated_cost_ratio.
--
-- Context (client feedback, 2026-07-23): WaPrecious has zeroed
-- items.buying_price for most/all ingredient-cooked menu items, to avoid
-- double-counting cost between menu-item-level and ingredient-level cost
-- tracking (see docs/01_DATA_MODEL.md §3.10). A real, deliberate choice —
-- NOT being undone here. Side effect: wastage_value/staff_meal value/
-- complimentary_meal value/stock_adjustment value (all `quantity *
-- buying_price_snapshot`) collapse to 0 for those items, even though real
-- stock is genuinely moving — she wants a non-zero, meaningful KES
-- estimate for "how much non-sales stock is being consumed" without
-- resurrecting the double-count in COGS/net profit.
--
-- estimated_cost_ratio (default 0.60, her own example) is the fallback
-- cost-as-a-fraction-of-selling-price used ONLY when buying_price is 0 —
-- see the new *_estimated_value columns added in the next migration. This
-- never touches buying_price_snapshot, cost_value, closing_stock_value,
-- periodicCogs(), or netProfit() — those stay exactly as they are today.
-- ============================================================

create table public.app_settings (
  id boolean primary key default true,
  estimated_cost_ratio numeric(4,3) not null default 0.600
    check (estimated_cost_ratio >= 0 and estimated_cost_ratio <= 1),
  updated_at timestamptz not null default now(),

  constraint app_settings_singleton check (id)
);

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

insert into public.app_settings (id) values (true);

alter table public.app_settings enable row level security;

-- Everyone who's logged in can read it (every write-function below needs
-- it, and staff-facing screens may want to show an estimate too) --
-- mirrors items/ingredients' own SELECT-for-all-authenticated convention.
-- Only admin can change it.
create policy app_settings_select_all on public.app_settings
  for select using (auth.uid() is not null);

create policy app_settings_admin_write on public.app_settings
  for update using (public.is_admin());
