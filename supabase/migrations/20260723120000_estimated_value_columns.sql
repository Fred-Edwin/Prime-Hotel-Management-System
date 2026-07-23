-- ============================================================
-- estimated_value columns — see 20260723110000_app_settings_estimated_cost_ratio.sql
-- for the full context.
--
-- Each new column is computed as:
--   quantity * (buying_price_snapshot > 0 ? buying_price_snapshot
--                                          : selling_price_snapshot * estimated_cost_ratio)
--
-- Purely additive, display-only figures. The existing wastage_value/value
-- columns (still `quantity * buying_price_snapshot`) are UNCHANGED and
-- keep feeding nothing but themselves — cost_value/closing_stock_value/
-- periodicCogs()/netProfit() never read these new columns. See
-- docs/01_DATA_MODEL.md §3.11.
-- ============================================================

alter table public.stock_entries
  add column wastage_estimated_value numeric(10,2) not null default 0;

alter table public.staff_meal_entries
  add column estimated_value numeric(10,2) not null default 0;

alter table public.complimentary_meal_entries
  add column estimated_value numeric(10,2) not null default 0;

alter table public.stock_adjustment_entries
  add column estimated_value numeric(10,2) not null default 0;
