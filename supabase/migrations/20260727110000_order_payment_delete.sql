-- ============================================================
-- Delete/reverse a payment under Debtors (client feedback, 2026-07-27:
-- "Delete options required under Debtors for admin"). Flagged as a
-- known follow-up back in Phase 11 (docs/phases/phase11_context.md,
-- "Known issues": "No payment reversal/refund route -- a mistaken
-- payment is an operational admin problem to resolve for now") -- this
-- is that follow-up landing.
--
-- Unlike every cascade in the two sibling migrations alongside this one
-- (consumption-entry delete, stock-entry delete), a payment has NO
-- downstream figure to recompute: dashboard_debtors()/the outstanding-
-- balance calculation is entirely DERIVED at read time
-- (total_amount - sum(order_payments.amount), never denormalized --
-- see docs/01_DATA_MODEL.md §6, judgment call #1). Deleting a payment
-- row is therefore a plain RLS-gated delete, no companion cleanup RPC
-- needed -- same posture expenses' own delete already has (see the
-- comment immediately above expenses_delete_admin_only in
-- 01_DATA_MODEL.md's RLS section: "nothing... to unwind on delete --
-- only summed at read time").
--
-- Admin-only -- order_payments previously had NO delete policy at all
-- (deliberately immutable-once-logged, matching ingredient_purchases'
-- original posture before that table also gained an admin-only delete
-- path, 20260721060000_purchase_delete.sql). This mirrors that same
-- correction, applied to payments instead of purchases.
-- ============================================================

-- drop-if-exists guard makes this file safe to re-run regardless of
-- prior application state -- create policy has no "or replace" form,
-- so a bare re-run would 42710 the same way
-- 20260727090000_consumption_entry_delete.sql's own policies did before
-- this same guard was added there.
drop policy if exists "order_payments_delete_admin" on public.order_payments;
create policy "order_payments_delete_admin" on public.order_payments
  for delete using (public.is_admin());
