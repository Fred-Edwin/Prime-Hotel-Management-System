-- ============================================================
-- Phase 8 tech-debt sweep: drop recalculate_stock_entry().
--
-- Confirmed dead code since Phase 6 (docs/phases/phase6_context.md):
-- superseded by save_stock_entry()/save_canteen_stock_entry() (Phase 4/5)
-- and apply_order_to_stock_entry() (Phase 6), which each do the full
-- upsert + recompute atomically and are the only functions any route
-- handler calls. No code path in app/ references this function.
-- See docs/01_DATA_MODEL.md §3.4 for the current mechanism.
-- ============================================================

drop function if exists public.recalculate_stock_entry(uuid, location_type, date);
