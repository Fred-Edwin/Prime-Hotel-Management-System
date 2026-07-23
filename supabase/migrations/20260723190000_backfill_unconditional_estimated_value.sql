-- ============================================================
-- Backfill wastage_value/value on rows written BEFORE
-- 20260723180000_unconditional_estimated_value.sql, so the dashboard/
-- ledger read consistently from day one instead of mixing old
-- (buying_price_snapshot-based) and new (selling_price_snapshot *
-- estimated_cost_ratio) figures depending on when a row happened to be
-- last saved.
--
-- Confirmed with the human (2026-07-23), after inspecting real dev data:
-- every pre-migration row was still on the old formula, including at
-- least one row where buying_price_snapshot = 0 produced a silent
-- wastage_value = 0 -- the exact blind spot this whole feature exists to
-- fix, still present for all history. Human's call: this crosses this
-- schema's usual "never rewrite history" line deliberately, because that
-- convention protects PRICE history (so a later price change doesn't
-- retroactively alter past profit) -- this backfill doesn't change what
-- price was recorded, it fixes a derived-value formula that was applied
-- inconsistently depending on write timing. Scope is narrow and explicit:
-- ONLY the four *_value/wastage_value columns are touched. quantity/
-- wastage/selling_price_snapshot/buying_price_snapshot/every other
-- column on every affected row is completely untouched -- this is not a
-- backfill of prices or quantities, only of a formula result derived
-- from data that's already there.
--
-- Uses the CURRENT app_settings.estimated_cost_ratio for every row,
-- since there is no historical ratio to look up (the ratio has only
-- ever had one value, its default 0.600, since app_settings was created
-- today) -- if the ratio is ever changed going forward, this backfill is
-- not re-run; only new/edited rows pick up a changed ratio, per the
-- normal snapshot-at-write-time rule.
--
-- KNOWN LIMITATION, accepted by the human: staff_meal_entries/
-- complimentary_meal_entries/stock_adjustment_entries only ever stored
-- buying_price_snapshot, never a selling_price_snapshot of their own —
-- the writer functions read items.selling_price live at claim-write
-- time and never persisted it. This backfill has no way to recover the
-- HISTORICAL selling_price for these three tables' pre-migration rows,
-- so it joins to items.selling_price as it stands TODAY instead. If any
-- referenced item's selling_price changed between an old row's write
-- date and this backfill running, that row's backfilled `value` will be
-- computed from the wrong (current, not historical) price. Accepted as
-- an approximation rather than left un-backfilled — stock_entries.
-- wastage_value (the query above) is NOT affected by this limitation,
-- since stock_entries does store its own selling_price_snapshot.
-- ============================================================

update public.stock_entries
set wastage_value = wastage * selling_price_snapshot * public.estimated_cost_ratio()
where wastage_value <> wastage * selling_price_snapshot * public.estimated_cost_ratio();

update public.staff_meal_entries sme
set value = sme.quantity * i.selling_price * public.estimated_cost_ratio()
from public.items i
where i.id = sme.item_id
  and sme.value <> sme.quantity * i.selling_price * public.estimated_cost_ratio();

update public.complimentary_meal_entries cme
set value = cme.quantity * i.selling_price * public.estimated_cost_ratio()
from public.items i
where i.id = cme.item_id
  and cme.value <> cme.quantity * i.selling_price * public.estimated_cost_ratio();

update public.stock_adjustment_entries sae
set value = sae.quantity * i.selling_price * public.estimated_cost_ratio()
from public.items i
where i.id = sae.item_id
  and sae.value <> sae.quantity * i.selling_price * public.estimated_cost_ratio();
