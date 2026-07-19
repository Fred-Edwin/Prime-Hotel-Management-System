# Acceptance scripts

One script per phase (`phaseX-*.mjs`) — real, repeatable HTTP-level acceptance checks against a **live dev server + local Supabase stack**, reconstructing the exact assertions each phase's gating checklist made (see `docs/phases/phaseX_context.md`'s "Gating checklist results" for the prose version of what each script checks).

## Why these exist

Phases 4–6 were each verified by hand-written, one-off Node scripts during their sessions — logging in as real seeded roster accounts, hitting routes directly, checking RLS/oversell/concurrency/idempotency. Those scripts were written to `/tmp` and lost after each session, meaning that real coverage (same-day RLS bugs, INSERT-policy date-scoping, canteen aggregation math, the Phase 6 concurrency/idempotency guarantees) could only be re-verified by re-deriving the same script from scratch. These are that work, done once and kept.

## Running one

```bash
npx supabase status      # confirm the local stack is up (npx supabase start if not)
pnpm dev                 # in another terminal, leave running

node scripts/acceptance/phase4-entry.mjs
node scripts/acceptance/phase5-canteen-expenses.mjs
node scripts/acceptance/phase6-orders.mjs
node scripts/acceptance/phase7-dashboard.mjs
node scripts/acceptance/phase9-batch-save.mjs
node scripts/acceptance/phase9-staff-orders.mjs
node scripts/acceptance/post-launch-store-autosave.mjs
node scripts/acceptance/post-launch-audit-log.mjs
node scripts/acceptance/post-launch-ledger-admin-edit.mjs
node scripts/acceptance/post-launch-stock-entry-multi-writer-rls.mjs
node scripts/acceptance/post-launch-cashier-autosave.mjs
node scripts/acceptance/post-launch-staff-meals.mjs
```

Post-launch (non-phase) fixes with real correctness risk get a `post-launch-<short-name>.mjs` script instead of a `phaseX-*.mjs` one — same shape, same discipline, just not tied to a phase number (see `CLAUDE.md`'s "Post-launch maintenance work" section). `post-launch-store-autosave.mjs` covers the `/store` per-field-autosave redesign's new `PUT /api/ingredient-entries` route: row carry-forward across independent field saves, the oversell check, store-manager-only RBAC, and the new `lock_ingredient_entry_row()` advisory lock. `post-launch-audit-log.mjs` covers the audit log (`docs/backlog/03_audit_log.md`): Staff edit/deactivate/reactivate/PIN-reset each write the right action, admin can read via the API and staff cannot (both the route guard and the underlying RLS policy, checked separately via `psqlAsUser`), and — the actual point of an audit trail — no role, including admin, can INSERT into `audit_log` directly through the client; only the `write_audit_log()` security-definer function may write. `post-launch-ledger-admin-edit.mjs` covers admin direct ledger-row editing (`docs/backlog/04_admin_ledger_edit.md`, `PATCH /api/dashboard/ledger/entry`): editing a non-most-recent `stock_entries`/`ingredient_entries` row is rejected (409) and leaves the row untouched, editing the actual most-recent row correctly re-derives `closing_stock`/`sales_value`/`wastage_value`, price snapshots are provably byte-for-byte unchanged, `created_by` stays the original staff member (not reassigned to the editing admin) while a brand-new "today" row legitimately gets the admin's own id, and every edit writes a `stock_entry.admin_edit`/`ingredient_entry.admin_edit` audit entry with the admin as actor.

`post-launch-stock-entry-multi-writer-rls.mjs` is a permanent regression check for a real bug found and fixed 2026-07-17 while manually testing the store-manager `/entry` screen: the old `stock_update_admin_or_current_period_owner` policy's `created_by = auth.uid()` USING clause meant whichever restaurant staffer's write created today's `stock_entries` row for an item became its sole owner — every *other* same-location staffer (store manager vs. cashier, or cashier vs. cashier) was then blocked with a `403` from writing that same item/day, even though the schema is designed for the store manager's `added_stock`/`sent_out` autosave and any cashier's till-sale save to coexist on one row. This broke CLAUDE.md's "two writers, one stock figure" invariant across three real staff (Janiffer, Sarah, Mercy) working the same restaurant location. Fixed by `20260717120000_stock_update_location_scoped.sql`, which replaced the policy with a location-scoped check (`location = my_location()`) instead of a creator-scoped one, matching the INSERT policy's existing logic — see the script's own header comment for full detail.

`post-launch-cashier-autosave.mjs` covers the `/entry` cashier (non-store-manager) redesign's new `PUT /api/stock-entries` cashier branch (`docs/01_DATA_MODEL.md` §3.4's fifth writer, `save_stock_entry_cashier_field()`): happy-path autosave with `added_stock`/`sent_out` preserved across repeated saves, RBAC (store-manager-vs-cashier split on the same route, canteen staff forbidden entirely), the row-locking concurrent-first-writer race, and — the actual correctness risk this redesign introduced — the two *distinct* oversell rejection cases: a genuine oversell (`added_stock > 0`, still not enough) keeps the original generic message, while "nothing added yet today" (no row, or a row with `added_stock = 0`, and even `opening_stock` alone can't cover the sale) gets a specifically-diagnosed message instead of being misdiagnosed as user error — checked on both the new PUT autosave (SQLSTATE `P0002`) and the pre-existing batch `POST` path (a route-level pre-check, same root cause, same fix, added to keep both call sites consistent).

`post-launch-staff-meals.mjs` covers staff meal / unpaid-food consumption accounting (`docs/backlog/02_staff_meals.md`, `docs/01_DATA_MODEL.md` §3.5, `POST /api/staff-meals` → `create_staff_meal_entry()`): a claim reduces `stock_entries.closing_stock` and is valued at `buying_price_snapshot` (never `selling_price_snapshot`), the oversell check now treats `staff_meals` as a genuine third contributor alongside `wastage` (a claim that would push the combined total over available stock is rejected with `409`, and the row is provably unchanged after rejection), a subsequent claim for exactly the remaining stock still succeeds after an earlier rejection, location scoping blocks a cross-location claim, the route is staff-only (admin gets `403`), `staffMealValue` appears as its own field on the dashboard summary distinct from `wastageValue`, and claims are itemized with real staff names (not just ids) on the admin ledger. **Does not use `psql()`** — this repo's `.env.local` currently points at a hosted dev Supabase project, not local Docker (`docs/00_ARCHITECTURE.md` §7), so fixture setup/teardown goes through a direct service-role Supabase client instead; see the script's own header for what this means is *not* covered (direct RLS-policy impersonation, backdated-row concurrency fixtures) and how to extend it if a future session moves back to local Docker.

If your local Supabase container name differs from `_lib.mjs`'s default (check with `docker ps` — the project's local containers are currently named `supabase_db_mqtlxuwbjzsjtywhjjtf_Reference_used_in_A`, a Docker-volume-naming artifact from a prior backup-restore, not the project's actual ref), override it: `ACCEPTANCE_DB_CONTAINER=<name> node scripts/acceptance/phaseX-*.mjs`.

Each script logs in as the real seeded roster accounts (`scripts/seed-staff.ts`'s names/PINs — same roster `scripts/verify-screenshot.mjs` uses), prints `PASS`/`FAIL` per check, and exits non-zero if anything failed.

## What they mutate, and how they clean up

These scripts create real rows (`stock_entries`, `orders`, `expenses`, etc.) against your local dev database, then delete everything they created before exiting — every script is safe to re-run any number of times without leaving residue or needing a `supabase db reset`. Two techniques make this safe:

- **Orders/expenses are tagged** with a `[acceptance-test]` marker in `customer_name`/`note`, so cleanup targets exactly (and only) that script's own data — never a blanket wipe that could delete real dev data you're separately working with.
- **`stock_entries` fixtures are manufactured via direct SQL** (`psql()` in `_lib.mjs`), not through the app's own API — the app's write paths are correctly date-scoped (see `docs/phases/phase5_context.md`) and will reject a backdated write from a real client. Direct SQL is the documented, correct way to build test fixtures for these date-scoped tables (carry-forward tests need a "yesterday"/"last week" row; concurrency tests need real opening stock to sell against).

If a script is interrupted mid-run (Ctrl-C, crash) its cleanup won't have run — check `git status`-style: query `stock_entries`/`orders` for today's date, or just re-run the script (its own `cleanup()` runs first, wiping any partial leftovers from the previous attempt) before doing anything else.

## When to use these vs. other verification

Per `CLAUDE.md`'s "Verifying data/logic/RLS correctness" section:

- **A data/RLS/calculation/concurrency claim** ("does the oversell check work," "is canteen actually blocked from restaurant's rows," "does a retried order submission double-deduct stock") → these scripts (or plain `curl`/`fetch` for a one-off check).
- **A layout/positioning/visual claim** ("is this element pinned to the bottom," "does this look right at 390px") → the `verify` skill (`.claude/skills/verify/SKILL.md`), a real headless browser.
- **Pure calculation logic with no DB/RLS involved** (`lib/calculations.ts`'s formulas) → `pnpm test` (`vitest`), already covers this — no live stack needed.

These scripts are **not** run in CI and are **not** part of `pnpm test` — they need a live local Supabase stack + seeded roster data that CI doesn't provision, and they're slower (real HTTP round trips) than the unit suite. Run them locally, by hand, whenever you're touching RLS policies, the `stock_entries` write path, orders, or canteen's weekly-cadence logic — or any time you want to re-confirm an earlier phase's correctness claims still hold after a later change.

## Adding a script for a new phase

1. Copy the shape of an existing script (imports from `_lib.mjs`, a `cleanup()` at both the top and bottom of `main()`, one `console.log("=== TEST N: ... ===")` block per scenario, `check(label, condition, detail)` for each assertion, `summarizeAndExit(phaseName)` at the end).
2. Reconstruct the assertions from that phase's `docs/phases/phaseX_context.md` gating-checklist section (or write new ones as you build/test the phase — don't wait until after the session to backfill).
3. Tag any orders/expenses/other free-text-bearing rows you create with a distinctive marker so cleanup can target them precisely.
4. Prefer manufacturing backdated/cross-period fixtures via `psql()` over trying to trick the app's date-scoped write paths — it won't work, and isn't the point of the test anyway.
5. Run it twice in a row and confirm identical output both times, and confirm the DB is back to its pre-run state after — that's the bar for "safe to re-run anytime."
