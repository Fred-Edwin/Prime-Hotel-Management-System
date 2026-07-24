-- Phase 11 — Credit/debtor ledger (docs/04_PHASE_PLAN.md Phase 11,
-- docs/01_DATA_MODEL.md §6). Adds a third order_fulfillment_type value,
-- 'counter', for walk-in till/counter sales staff explicitly choose to
-- log as a named-customer order-style transaction (typically because
-- it's on credit, but a counter order can also be paid in full
-- immediately — see the companion migration's order_payments table).
--
-- Split into its own migration, in its own transaction, because Postgres
-- requires `alter type ... add value` to commit before the new value can
-- be referenced by any later statement in the same session — see the
-- existing precedent, 20260713120000_add_item_categories.sql, which hit
-- this same constraint first. Everything else this phase needs
-- (customers table, order_payments table, orders.customer_id, RLS) lives
-- in 20260724140000_credit_ledger.sql, which runs after this commits.
--
-- The existing stepper-based till flow on /entry (till_quantity_sold) is
-- completely untouched by this — 'counter' is only ever used by the new
-- order-style counter-sale flow, never by the stepper.

alter type order_fulfillment_type add value 'counter';
