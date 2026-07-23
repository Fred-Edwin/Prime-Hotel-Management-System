# Handover: simplify "estimated value" to a flat 60%-of-selling-price rule

## Context — read this first
This is a post-launch fix on the Prosper Hotel Management System (see CLAUDE.md at repo root — read it in full before doing anything, especially the "Local dev setup," "Verifying data/logic/RLS correctness," and "Post-launch maintenance work" sections). The client is WaPrecious (admin). Read `docs/01_DATA_MODEL.md` §3.10 and §3.11 before touching any of this — they document the full history below.

## The original ask (client feedback)
WaPrecious zeroed `items.buying_price` for most/all ingredient-cooked menu items, to avoid double-counting cost between menu-item-level and ingredient-level tracking (§3.10, already shipped, correct, not being touched). Side effect: `wastage_value`/`staff_meal_entries.value`/`complimentary_meal_entries.value`/`stock_adjustment_entries.value` (all `quantity * buying_price_snapshot`) read as a flat KES 0 for those items, even though real stock moves. She wants a real KES estimate for non-sales stock consumption, without it touching profit/COGS.

## What got built today (already migrated + committed + pushed to both dev and demo)
A **dual-value model**: kept the real `*_value` columns (still `quantity * buying_price_snapshot`, correctly 0 for zeroed items), and added a parallel `*_estimated_value` column/set of fields that substitutes `selling_price * estimated_cost_ratio` (a new admin-editable setting, default 0.6, in a new `app_settings` table) ONLY when `buying_price` is 0. Full details in `docs/01_DATA_MODEL.md` §3.11.

Migrations already applied to both `prosper-hotel-dev` and `prime-hotel-demo` (verified via SQL Editor object-existence checks — see conversation history if you need the verification queries):
- `20260723110000_app_settings_estimated_cost_ratio.sql`
- `20260723120000_estimated_value_columns.sql`
- `20260723130000_estimated_value_helper_functions.sql`
- `20260723140000_wastage_estimated_value.sql`
- `20260723150000_consumption_entries_estimated_value.sql`
- `20260723160000_consumption_ledger_estimated_value.sql`
- `20260723170000_dashboard_summary_estimated_values.sql`

Code already committed to `main` and pushed (commit `5bd3db2`, plus one unrelated prior commit `359e8b0`). **NOT yet deployed via `vercel --prod`** — the human has not run that yet, waiting on this rework first.

A `20260723180000_backfill_estimated_values.sql` file was drafted but **deleted, never applied anywhere** — it's obsolete under the new design, don't recreate it.

## What changed the plan: direct client correction, mid-session
While reviewing the live dashboard, the human pushed back hard on the dual-value model: **"I dont want to assume she zeroed them all. Can we have it as this. All non sales stock values are computed by multiplying with 60% of the selling price - simple."**

Confirmed via AskUserQuestion:
- The formula is **unconditional**: `value = quantity * selling_price_snapshot * estimated_cost_ratio`, for ALL wastage/staff-meal/complimentary-meal/stock-adjustment entries, regardless of what `buying_price` is. No more "only when buying_price is 0" branching.
- **Still snapshotted at entry time** (confirmed) — same discipline as every other price in this schema. A later ratio change must not retroactively alter a past day's reported figures.
- **`buying_price_snapshot`, `cost_value`, `closing_stock_value`, COGS (`periodicCogs()`), and `netProfit()` are NOT touched by this at all** — they keep using the real buying price exactly as today. This whole change is scoped ONLY to the four non-sales-consumption value columns (`stock_entries.wastage_value`, `staff_meal_entries.value`, `complimentary_meal_entries.value`, `stock_adjustment_entries.value`).
- The now-redundant parallel `*_estimated_value` columns/UI (two numbers that would now always be equal) should be **removed**, not kept alongside a duplicate.
- New migrations should **undo + replace** today's migrations (confirmed: append-only history, don't edit today's already-applied files) — write fresh migration files, don't rewrite the applied ones in place.

## The actual work required

### 1. Database (new migration files, `supabase/migrations/`, next timestamp after `20260723170000`)
- Rewrite all 6 `stock_entries` writer functions (`save_stock_entry`, `save_canteen_stock_entry`, `apply_order_to_stock_entry`, `save_stock_entry_store_manager_fields`, `save_stock_entry_cashier_field`, `save_stock_entry_canteen_field`) so `wastage_value := v_wastage * p_selling_price_snapshot * public.estimated_cost_ratio()` — drop the `effective_unit_cost()` buying-price branch entirely, always use selling price × ratio.
- Rewrite the 3 `create_*_entry` functions (`create_staff_meal_entry`, `create_complimentary_meal_entry`, `create_stock_adjustment_entry`) the same way: `value := p_quantity * v_selling_price * public.estimated_cost_ratio()`.
- Drop `stock_entries.wastage_estimated_value`, `staff_meal_entries.estimated_value`, `complimentary_meal_entries.estimated_value`, `stock_adjustment_entries.estimated_value` columns (now redundant/dead).
- Drop the `estimated_value` output column from `dashboard_stock_consumption_ledger()`, `dashboard_stock_summary()`, `dashboard_staff_meal_summary()`, `dashboard_complimentary_meal_summary()`, `dashboard_stock_adjustment_summary()` — back to just `value`/`wastage_value`.
- Consider whether `public.effective_unit_cost(buying_price, selling_price)` helper function is still needed at all (probably not — replace call sites with a direct `selling_price * estimated_cost_ratio()` or keep a simplified helper, your call). `public.estimated_cost_ratio()` (the settings reader) stays, still needed.
- **Remember Postgres's `CREATE OR REPLACE FUNCTION` limitation**: any function whose OUTPUT column list changes (dropping `estimated_value`/`wastage_estimated_value` from a `RETURNS TABLE`) needs an explicit `DROP FUNCTION ... ;` before the `CREATE OR REPLACE` — plain `CREATE OR REPLACE` errors with `42P13: cannot change return type of existing function` if you skip this. This bit us twice already today on `dashboard_stock_consumption_ledger()` and the `dashboard_*_summary()` functions — see the committed migrations for the exact working pattern (`20260723160000`/`20260723170000`).
- `app_settings`/`estimated_cost_ratio` column stays exactly as-is — still the one admin-editable setting.
- **Write the migration files, do NOT run them.** Per CLAUDE.md, only the human runs SQL, via the Supabase SQL Editor — dev (`prosper-hotel-dev`, ref `fbowdsdyccpsumcxcuti`) first, confirm, then demo (`prime-hotel-demo`, ref `mqtlxuwbjzsjtywhjjtf`). Tell them the exact filenames/order.
- Since real rows already exist in both databases with the dual-value model's data (some real test rows in dev from earlier today, real client historical data in demo), **do NOT attempt a backfill of the old `*_estimated_value` columns before dropping them** — those columns are being deleted, not preserved. No backfill needed for the *new* unified `value` column either, per the same "never rewrite history, only new entries follow new rules" logic that's applied everywhere else in this schema (confirm this reasoning with the human if they seem to want retroactive correction — don't assume).

### 2. `lib/calculations.ts` (+ its test file `lib/calculations.test.ts`)
- `calculateStockEntryTotals()`: `wastageValue: wastage * sellingPriceSnapshot * estimatedCostRatio` (drop the buying-price branch). Remove `wastageEstimatedValue` from `StockEntryTotals` interface and the return object — it's redundant now.
- Remove or simplify `effectiveUnitCost()` — likely just delete it, since there's no longer a "use buying price if present" branch; every call site becomes `sellingPrice * ratio` directly.
- Update `calculations.test.ts`: several tests currently pass `estimatedCostRatio` as a param and assert `wastageEstimatedValue` separately from `wastageValue` — these need rewriting since `wastageValue` itself now depends on the ratio. Also delete the `effectiveUnitCost` describe block if that function is removed.

### 3. TypeScript types (`lib/supabase/types.ts`)
Hand-edited earlier today to add the `estimated_value`/`wastage_estimated_value` columns and the `app_settings` table — now need those columns removed again (tables/functions still exist, just minus those columns). Match Postgres schema exactly; typecheck with `npx tsc --noEmit -p tsconfig.json` after editing.

### 4. API routes
- `app/api/dashboard/summary/route.ts` — remove all the `*EstimatedValue`/`estimatedTotal` fields added to the `stockConsumption` block; back to just the real fields (which are now correctly non-zero, computed via the new formula).
- `app/api/dashboard/ledger/route.ts` — no code change needed (pure pass-through of the RPC's return shape, confirmed earlier).
- `app/api/settings/route.ts` — stays as-is (still manages `estimated_cost_ratio`), though consider renaming the concept in comments/copy since "estimated" no longer implies "only for zero-priced items" — it's just "the cost ratio used for non-sales stock consumption valuation" now. Your call whether a rename is worth the churn.

### 5. UI
- **`app/(admin)/dashboard/ledger/LedgerClient.tsx`**: remove the "Estimated value" table column (currently right after "Value") and its `estimated_value` field from the `StockConsumptionLedgerRow` interface — there's only one value now. Keep the "Estimated value settings" button + modal (still the entry point for editing the ratio) but consider renaming the button label (e.g. "Cost ratio settings") since "estimated value" as a distinct concept from "value" no longer exists. **Two known-good fixes already made today, currently uncommitted in the working tree — do not lose them**: (a) the Non-Sales Stock Consumption table no longer uses `styles.ledgerTableSparse` unconditionally (now correctly fills width); (b) the Ingredients table's sparse-mode class is now conditional on `filteredIngredients.length <= 3`, matching the Items table's existing pattern, instead of being applied unconditionally (also a table-width bug, same root cause). (c) The InfoTooltip for "Estimated value" was moved from inside the table's `<th>` (where it was being clipped by the scrolling container) to the section header next to the title — if you remove the estimated-value concept, decide whether this tooltip is even still needed given the value column's meaning is more obvious as one column instead of two.
- **`app/(admin)/dashboard/DashboardClient.tsx`**: remove the "est. KES X" secondary lines from the comparison table (the `estimatedKey`/`comparisonEstimated` additions from earlier today) — the hero tile and comparison table both just show the one real (now-correctly-computed) figure. Remove the `estimatedTotal`/`*EstimatedValue` fields from `StockConsumptionFigures` interface. Remove the `.comparisonEstimated` CSS class from `dashboard.module.css` if unused elsewhere (check first).

### 6. Docs
- `docs/01_DATA_MODEL.md` §3.11 needs a full rewrite (or a superseding note, per this repo's "don't edit history, correct going forward" convention — check how §3.3/§3.10 handle superseded content for the house style) describing the simpler unconditional-60% rule instead of the dual-value fallback model. Make sure `netProfit()`/`periodicCogs()` are explicitly re-stated as untouched — that invariant matters most and should be restated clearly, not just implied.

### 7. Verification (per CLAUDE.md: curl only, no acceptance scripts for post-launch work)
- `pnpm test`, `pnpm lint`, `pnpm build` all clean.
- Start the dev server, log in as WaPrecious (PIN `1234`, see `scripts/seed-staff.ts` for the full roster), and curl-verify: log a wastage entry against a real item (`PATCH /api/dashboard/ledger/entry`), confirm `wastage_value = quantity * selling_price_snapshot * 0.6` regardless of that item's `buying_price`. Confirm `cost_value`/`netProfit` in `/api/dashboard/summary` are completely unaffected (same sales/expenses in, same profit out, independent of the wastage change).
- **Clean up any test data you create** (there's precedent for leaving stray test rows behind earlier today — restore any item price you change, zero out any test wastage/entry you log, the same way the current conversation history did).

### 8. Known outstanding item unrelated to this rework, don't fix unless asked
A stale duplicate function overload was found on `prime-hotel-demo`: `create_complimentary_meal_entry()` has two signatures (old 5-arg-then-note order, and current note-last-with-default order) — a past migration's `DROP FUNCTION` apparently didn't take effect. Harmless (app only calls the current signature), flagged to the human, they haven't decided whether to clean it up. Not part of this task — mention if you notice it again, don't fix proactively.

## Git state at handover
- Branch `main`, 2 commits ahead of nothing (both already pushed): `5bd3db2` (today's estimated-value feature) and `359e8b0` (unrelated PWA icon/date-range work from earlier).
- Working tree has ONE uncommitted change: `app/(admin)/dashboard/ledger/LedgerClient.tsx` (the two table-width fixes described in §5 above). Do not lose this when you start editing the same file further.
- **Do not run `vercel --prod`** — the human deploys, not the agent, and they're explicitly waiting on this rework before deploying.

## Who to ask if something's ambiguous
The human (project owner) is running this session live and has been making real-time product calls throughout (dual-value → single-value was their call, snapshot-at-entry was their call). Summarize your understanding back to them before writing code, per this repo's standing instruction — don't assume, ask.
