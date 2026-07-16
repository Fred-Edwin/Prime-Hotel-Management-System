# Admin-only historical-entry edit capability

**SUPERSEDED 2026-07-16 — see [04_admin_ledger_edit.md](04_admin_ledger_edit.md).** This item's cascade/price-snapshot/quantity_sold risk analysis fed directly into the merged design; the open questions raised here (cascade handling, price snapshot mutability) are the ones resolved in that file. Kept only as a record, not an active brief. Don't build from this file.

**Status:** Deferred at Phase 10 scoping. Not started.
**Depends on:** Recommend [03 (audit log)](03_audit_log.md) land first — editing historical data without a trace of what changed and who changed it is the exact scenario an audit log exists to cover.
**Phase-scale?** Yes — flag explicitly and confirm with the human whether this gets its own phase-style plan. This is one of the highest-risk items in this backlog: it means mutating financial/stock history after the fact, in a system whose core selling point is trustworthy profit figures.

## The problem

Today, once a `stock_entries`/`ingredient_entries`/`orders`/`expenses` row is saved, there's no UI path to correct it if staff made a genuine data-entry mistake (wrong quantity typed, wrong item selected) — the only fix is direct DB access, which the client shouldn't need and Fred shouldn't have to do by hand every time.

## Why this is dangerous (read before scoping)

- **Prices are snapshotted at write time** (`CLAUDE.md`'s non-negotiable constraint) — an edit UI must not let editing a historical entry pull in *today's* price; it must only let the quantity/note fields change, preserving the original price snapshot, or the whole point of snapshotting is defeated.
- **`quantity_sold` is derived, never directly writable** (`recalculate_stock_entry()`, §3.4) — an edit to `till_quantity_sold` or an order's items must still flow through the same recalculation mechanism, not bypass it with a raw UPDATE.
- **Opening stock is carried forward from the prior period's closing stock** — editing one day's closing stock retroactively could desync the *next* day's already-saved opening stock, which was computed from the old (wrong) value. This needs an explicit decision: cascade the correction forward, or block edits to any entry that already has a dependent next-period entry.
- **Wastage/dashboard figures for past periods** may already have been viewed/reported to the client — silently changing history without record is the definition of what an audit log (03) exists to prevent.

## Scope for this item (needs human decision before implementation)

1. Which fields are editable — almost certainly quantities/notes only, never price snapshots.
2. How to handle the cascade-into-next-period problem above — this is the single hardest design question here and must be resolved explicitly, not glossed over.
3. Time window, if any (e.g. only same-week edits allowed, or unlimited).
4. UI: likely a new "edit" action from the Ledger screen's row-level drill-in, admin-only, behind confirmation.

## Explicitly not in scope

- Staff-initiated edits to their own past entries (this is admin-only, by design).
- Bulk historical corrections/imports.

## Acceptance criteria

- [ ] Design for the cascade problem (opening-stock desync) confirmed with the human and documented before implementation.
- [ ] Price snapshots are provably untouched by an edit — verified by testing, not by reading the code.
- [ ] `quantity_sold`-derived fields still flow through `recalculate_stock_entry()`, never a raw UPDATE.
- [ ] Every historical edit produces an audit log entry (depends on 03) with before/after values.
- [ ] `scripts/acceptance/*.mjs` script covering: an edit doesn't corrupt the next period's already-saved opening stock, and doesn't alter the price snapshot.

---

## Agent-session prompt

> You are a full-stack engineer working on the Prosper Hotel Management System, a Next.js 14 + Supabase app for a Kenyan restaurant/canteen business (see `CLAUDE.md` at the repo root for full context — read it first, especially the non-negotiable constraints on price snapshotting and the §3.4 concurrency/derived-quantity mechanism). Your task is to scope and implement admin-only historical-entry editing as described in `docs/backlog/05_admin_historical_edit.md`. This is one of the highest-risk items in the backlog and must be treated as phase-scale — explicitly ask the human whether it warrants its own phase-style plan before writing code. The hardest open question, which you must resolve with the human before implementing anything, is the cascade problem: editing a past period's closing stock can desync the *next* period's opening stock, which was already computed and saved from the old value — read the brief's "Why this is dangerous" section in full before proposing a design. Any edit must preserve the original price snapshot (never repull today's price), and any quantity_sold-affecting edit must still go through `recalculate_stock_entry()` rather than a raw UPDATE, per `docs/01_DATA_MODEL.md` §3.4. Check whether `docs/backlog/03_audit_log.md` has landed — this feature should not ship without every edit producing an audit trail. Read `docs/phases/phase9_context.md` and `docs/01_DATA_MODEL.md` in full first. Write a `scripts/acceptance/*.mjs` script proving the cascade and price-snapshot risks are actually handled, not just asserted.
