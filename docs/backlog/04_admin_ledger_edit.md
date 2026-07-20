# Admin direct ledger-row edit (supersedes 04_admin_impersonation.md and 05_admin_historical_edit.md)

**Status:** Shipped, then extended post-launch (2026-07-20) — see "Post-launch correction" at the end of this file. Resolved decision #1 below ("block, don't cascade") **no longer reflects the shipped behavior**; kept here unedited as the historical record of what was originally decided and why, per this repo's convention of not rewriting a backlog doc's decision log after the fact. `docs/01_DATA_MODEL.md`'s "Historical edit cascade" section is the current source of truth for how this actually works now.

**Status (original, 2026-07-16):** Shipped. `PATCH /api/dashboard/ledger/entry`, wired into the edit modal in `app/(admin)/dashboard/ledger/LedgerClient.tsx`. Quantities-only, rejects (409) if not the most-recent row, writes an `audit_log` entry per edit.
**Depends on:** [03 (audit log)](03_audit_log.md) — done. Every edit under this feature must write an audit entry with before/after values, same pattern as the Staff routes.
**Phase-scale?** Yes — flag explicitly and confirm scope with the human before a large implementation session. Touches `stock_entries`/`ingredient_entries` write paths and the derived-quantity/opening-stock invariants those tables depend on.

## Why this replaced the original 04 and 05

The original backlog had two separate ideas: 04 ("admin acts as any staff role," an impersonation UI) and 05 ("admin-only historical-entry edit," fixing past mistakes). During scoping on 2026-07-16, the human proposed a simpler, unified mechanism instead: **admin edits `stock_entries`/`ingredient_entries` rows directly from the Ledger screen** — no "act as X" concept, no separate entry-logging UI. This covers both original use cases (logging today's numbers herself, correcting a past mistake) with one edit affordance. It inherits 05's real risk surface (price snapshots, the opening-stock cascade, `quantity_sold` being derived) starting on day one, so those questions were resolved before any code was written — see below.

## Resolved design decisions (2026-07-16)

1. **Cascade handling: block, don't cascade.** Editing day N's `stock_entries`/`ingredient_entries` row is only allowed if no later row exists for that same item+location that was derived from day N's `closing_stock` (i.e., admin can only edit the **most recent** entry per item+location — the one nothing downstream depends on yet). To correct something further back, the admin edits forward chronologically, one entry at a time, same as if she were re-living each day in order. Rejected alternative: auto-cascading the correction forward through every dependent day — correct in principle, but a single edit silently rewriting a long chain of historical rows was judged too large a blast radius for a first version. Revisit only if this constraint turns out to be genuinely too limiting in practice.
2. **Price snapshots are permanently fixed.** Editable fields are quantities only: `added_stock`, `till_quantity_sold`, `sent_out`, `wastage` (stock_entries) / `received`, `quantity_used`, `wastage` (ingredient_entries). `buying_price_snapshot`/`selling_price_snapshot` are never editable through this feature — if a price was wrong at entry time, that's a separate, deliberate problem this feature does not solve.
3. **`quantity_sold`/`closing_stock` are never directly writable.** An edit must go through the same `save_stock_entry()`/`save_canteen_stock_entry()`/`save_ingredient_entry()` functions staff writes already use (docs/01_DATA_MODEL.md §3.4), so the derivation and oversell re-check stay correct — not a raw `UPDATE` on the row.

## Scope

1. **"Most recent entry" check**, server-side, before allowing an edit: for `stock_entries`, no later `entry_date` row exists for the same `item_id`+`location`; for `ingredient_entries`, same check by `ingredient_id`. Reject with a clear message ("this isn't the latest entry for this item — edit forward from the most recent one instead") if it fails.
2. **Edit entry point on the Ledger screen** (`app/(admin)/dashboard/ledger/LedgerClient.tsx`): an edit affordance on a row (or its mobile-card expanded detail) that opens a form pre-filled with the editable quantity fields only, submits through the existing save functions.
3. **New API route** (or extend an existing one) that performs the "most recent" check, then calls the same `save_stock_entry()`/`save_ingredient_entry()` RPCs, with `created_by` staying as the row's original author (not silently reassigned to the admin) — the row's real-world attribution shouldn't change just because admin corrected a number. **Already confirmed safe, no extra work needed:** `created_by` is set only on the initial `INSERT` in `save_stock_entry()`/`save_canteen_stock_entry()`/`save_ingredient_entry()` (`supabase/migrations/20260712091633_stock_entry_row_locking.sql`, `20260716090000_ingredient_entry_row_locking.sql`) — none of their `on conflict do update set` clauses touch it, so re-calling these functions on an existing row is already attribution-safe as long as the caller passes the row's *existing* `created_by` (fetched first), not the admin's own id, as `p_created_by`. Same logic applies to price snapshots: these functions take `p_selling_price_snapshot`/`p_buying_price_snapshot` as plain parameters, never re-derived from `items` — the edit route must fetch the row's already-stored snapshot values and pass them back in unchanged, never re-read today's `items.selling_price`/`buying_price`.
4. **Audit log entry** on every successful edit: action `stock_entry.admin_edit` / `ingredient_entry.admin_edit`, before/after quantities, actor = the admin who made the correction (distinct from `created_by`, which stays the original staff member).
5. **"Log today's entry" as a special case of this**, not a separate mechanism: if no row exists yet for today for a given item+location, the same edit form (empty) becomes the create form — admin logging today's numbers herself is just editing/creating the most-recent (today's) row, no separate "act as staff" UI needed.
6. **Widen the Audit Log screen's action filter** (`app/(admin)/dashboard/audit-log/AuditLogClient.tsx`'s `ACTION_LABELS`) to include the new `stock_entry.admin_edit`/`ingredient_entry.admin_edit` actions this feature writes — the human specifically flagged (2026-07-16) that the dropdown felt too narrow while it only covered Staff actions; this is the point where it becomes genuinely broad.

## Explicitly not in scope

- Any impersonation/"act as staff member X" UI concept — deliberately dropped in this redesign.
- Auto-cascading corrections through dependent future rows (see resolved decision #1).
- Editing price snapshots (see resolved decision #2).
- Orders (`orders`/`order_items`) — this feature covers `stock_entries`/`ingredient_entries` only; orders editing is a separate future scoping question if ever needed.

## Acceptance criteria

- [ ] Admin can edit the most-recent `stock_entries`/`ingredient_entries` row for an item+location; attempting to edit an older row with a dependent later row is rejected with a clear message.
- [ ] Editing correctly re-derives `quantity_sold`/`closing_stock` via the existing save functions — verified against a manual calculation, not just "no error thrown."
- [ ] Price snapshot fields are provably untouched by an edit.
- [ ] `created_by` on the edited row is unchanged; the audit log records who actually made the edit.
- [ ] Every edit produces an audit_log entry with before/after quantities.
- [ ] Admin logging a brand-new "today" entry (no existing row) works through the same UI/mechanism, not a separate one.
- [ ] `scripts/acceptance/*.mjs` covering: the most-recent-row check rejects correctly, quantities re-derive correctly, price snapshot immutability, audit log entries are correct.
- [ ] `docs/01_DATA_MODEL.md` updated if any new columns/functions are added.

---

## Agent-session prompt

> You are a full-stack engineer working on the Prosper Hotel Management System, a Next.js 14 + Supabase app for a Kenyan restaurant/canteen business (see `CLAUDE.md` at the repo root for full context — read it first, especially the non-negotiable constraints on price snapshotting and the §3.4 concurrency/derived-quantity mechanism). Your task is to implement admin direct ledger-row editing as described in `docs/backlog/04_admin_ledger_edit.md` — this supersedes two earlier, separately-scoped backlog items (04_admin_impersonation.md, 05_admin_historical_edit.md), so read the "Why this replaced..." section first for context on what changed and why. The design's three hard questions are already resolved (read "Resolved design decisions" in full): edits are blocked on any row that has a dependent later row (no auto-cascade), price snapshots are permanently immutable through this feature, and `quantity_sold`/`closing_stock` must always flow through the existing `save_stock_entry()`/`save_canteen_stock_entry()`/`save_ingredient_entry()` functions, never a raw UPDATE. Build the edit entry point on the existing Ledger screen (`app/(admin)/dashboard/ledger/LedgerClient.tsx`), add the "most recent entry" server-side check, and make sure `created_by` stays the original staff member while the audit log (`lib/audit.ts`, see `docs/backlog/03_audit_log.md`) separately records which admin made the correction. Read `docs/phases/phase9_context.md` and `docs/01_DATA_MODEL.md` §3.4 first. Write a `scripts/acceptance/*.mjs` script covering the most-recent-row rejection, correct re-derivation, and price-snapshot immutability. Flag explicitly to the human whether this warrants a phase-style plan before starting, per its phase-scale flag.

---

## Post-launch correction (2026-07-20): "block, don't cascade" replaced with a recompute cascade

Resolved decision #1 above ("Cascade handling: block, don't cascade") was reversed after real post-launch use: blocking any edit but the single most-recent row meant a genuine data-entry mistake found even a few days later couldn't be corrected at its source at all — the exact problem this feature exists to solve. The human asked directly for historical edits to be allowed; "block forever" wasn't revisited as a limitation found in practice so much as replaced outright once asked for.

**What changed:** `PATCH /api/dashboard/ledger/entry` no longer rejects editing a non-latest row. Instead, after the edited row's own save succeeds, it calls a new recompute cascade (`recompute_stock_entry_cascade()` / `recompute_ingredient_entry_chain()`, `supabase/migrations/20260720100000_historical_ledger_edit_cascade.sql`) that walks forward through every later row for that item/location (or ingredient), re-deriving `opening_stock`/`closing_stock`/value fields from each row's own already-stored inputs and price snapshots — never touching a price. For a `canteen_supplied` item whose restaurant `sent_out` changed, the cascade also re-derives the linked canteen week(s).

**New resolved decisions made when this was reversed:**
- Unrestricted historical range (no "current month only" cutoff).
- A downstream oversell revealed by the recompute rejects the *entire* cascade atomically (same transaction) rather than allowing negative/impossible closing stock to land — the admin must resolve the conflicting downstream row first.
- The confirmation UI (a new `GET /api/dashboard/ledger/entry/impact` read-only pre-check, called when the edit modal opens) shows count + date range only ("This will also recalculate N later entries, through `<date>`"), not a full per-row before/after preview.

**Full detail, current source of truth:** `docs/01_DATA_MODEL.md`'s "Historical edit cascade" subsection (under §3.4's "Admin direct ledger-row edit"). Decisions #2 and #3 above (price immutability, `created_by` preservation) were **not** revisited and still hold exactly as originally decided.
