-- Phase 8 tech-debt sweep: ingredients get the same real, admin-editable
-- per-row low-stock threshold items got in Phase 7
-- (20260712120000_low_stock_threshold.sql). Previously
-- dashboard_low_stock_ingredients() used a hardcoded default-5 constant for
-- every ingredient -- a known, flagged simplification (Phase 7's context
-- file). Follows the exact same migration pattern.

alter table public.ingredients
  add column low_stock_threshold numeric(10,2) not null default 5
    check (low_stock_threshold >= 0);

comment on column public.ingredients.low_stock_threshold is
  'Admin-editable per ingredient (Ingredient Catalog, Phase 3 screen). An '
  'ingredient_entries row''s closing_stock at or below this value surfaces '
  'it on the dashboard''s "Needs attention" section (Phase 7/8). Defaults '
  'to 5 for pre-existing ingredients, matching items.low_stock_threshold''s '
  'default.';
