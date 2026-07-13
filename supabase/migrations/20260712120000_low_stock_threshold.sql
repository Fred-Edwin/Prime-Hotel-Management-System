-- Phase 7 (docs/04_PHASE_PLAN.md): the admin dashboard's "Needs attention"
-- low-stock section needs a real per-item threshold, not a guessed constant.
-- No such field existed anywhere in the original schema (docs/01_DATA_MODEL.md
-- only described "low stock" qualitatively, PRD §4.6) -- this is a genuine,
-- flagged data-model addition, not a silent deviation. See
-- docs/01_DATA_MODEL.md §2's updated `items` table comment and
-- docs/phases/phase7_context.md for the full rationale.

alter table public.items
  add column low_stock_threshold numeric(10,2) not null default 5
    check (low_stock_threshold >= 0);

comment on column public.items.low_stock_threshold is
  'Admin-editable per item (Item Master, Phase 3 screen). A stock_entries row''s '
  'closing_stock at or below this value surfaces the item on the dashboard''s '
  '"Needs attention" section (Phase 7). Defaults to 5 for pre-existing items.';
