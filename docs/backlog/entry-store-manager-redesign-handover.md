# Handover prompt — `/entry` store-manager view redesign

Paste the block below as the opening message of a fresh session.

---

**Role:** You are a senior mobile UX/UI designer specializing in enterprise UI/UX design (POS/retail data-entry lens — same lens used for the prior `/store` redesign this session continues from).

I need you to apply the same redesign treatment we already did for `/store` (the ingredient entry screen) to `/entry`'s **store-manager-specific view** — the "Added stock" / "Sent to canteen" fields that render only when `is_store_manager = true`, per `app/(staff)/entry/EntryClient.tsx`. Regular staff's `/entry` view (the "quantity sold" field) is **out of scope** — do not touch it.

## Context you need

Read `docs/phases/phase9_context.md` once for current repo state if you haven't this session, then these specific docs since this is architecture/data-model-touching work:
- `docs/01_DATA_MODEL.md` §3.3 (Wastage) — already has a Phase 10 correction note from the `/store` work; read it before deciding whether a second correction is needed here.
- `docs/00_ARCHITECTURE.md` §12 (Wastage) — same, already has a Phase 10 correction note.
- `docs/SCREENS.md` — Entry/Store screen rows, already updated for `/store`'s redesign.

## What was already decided (previous session) — implement these as given, do not re-litigate

1. **Steppers → typed numeric inputs.** Replace the stepper controls for "Added stock" and "Sent to canteen" with typed numeric text inputs (`inputMode="decimal"`, no spin buttons) — same pattern as `components/IngredientRow/IngredientRow.tsx` on `/store`. `ItemEntryCard` (`components/ItemEntryCard/ItemEntryCard.tsx`) currently only supports `stepper` or `readOnlyValue` per field — you'll likely need to add a `numericInput` variant to `ItemEntryField`, since `ItemEntryCard` stays shared with `/entry`'s non-store-manager ("quantity sold") cards, which keep their stepper.
2. **Remove tooltips for store-manager fields on this screen** — drop the `tooltip` props on "Added stock"/"Sent to canteen" and drop `openingTooltip` for the store-manager branch, matching `/store`'s reasoning (plain labels don't need a "?" affordance).
3. **Fix the opaque "Sent to canteen" cap.** Today the stepper's `max` is `opening + addedStock - tillQuantitySold - wastage`, but `tillQuantitySold` (today's till sales, logged by regular staff) is never shown to the store manager — so a "Only 3 left" limit message has no visible number explaining it. Surface `tillQuantitySold` as a small read-only line on the card for the store-manager view so the cap is traceable.
4. **Restore the low-stock indicator for store managers.** `EntryClient.tsx` currently has `const isLow = !isStoreManager && remaining <= LOW_STOCK_THRESHOLD;` — change to `const isLow = remaining <= LOW_STOCK_THRESHOLD;` so store managers see the same low-stock dot regular staff see. (This was judged backwards: the store manager is the person deciding how much to send to canteen, so they need this signal at least as much as anyone.)
5. **Switch to per-field autosave, same as `/store`.** Replace the batch `POST /api/stock-entries` + `TillStrip` Save-button flow (for the store-manager's two fields only) with debounced per-field autosave + the existing `components/StatusStrip` component, mirroring `/store`'s pattern exactly:
   - You will need a **new per-row save endpoint** for `stock_entries` (there is currently only the batch path — see `app/api/stock-entries/route.ts`'s `POST` handler and the `save_stock_entry()` / `save_stock_entries_batch()` SQL functions in `supabase/migrations/`). Mirror how `PUT /api/ingredient-entries` was added in this session (see `app/api/ingredient-entries/route.ts`'s `PUT` handler and `lib/validation.ts`'s `ingredientEntryLineSaveSchema`) — same shape, but for `stock_entries`'s `added_stock`/`sent_out` fields.
   - **Important wrinkle not present on `/store`:** `stock_entries` already has the `lock_stock_entry_row()` advisory lock (added in `supabase/migrations/20260712091633_stock_entry_row_locking.sql`) because of a real documented concurrency issue between till sales and orders writing to the same row (see `docs/01_DATA_MODEL.md` §3.4 — "two writers, one stock figure"). A new per-field autosave path from the store manager becomes a **third** concurrent writer to the same row. Read §3.4 in full and confirm the existing lock + `recalculate_stock_entry()`-style re-derivation (or equivalent in `save_stock_entry()`) is sufficient before assuming it "just works" — this is exactly the kind of race the `/store` session had to reason about carefully (see `supabase/migrations/20260716090000_ingredient_entry_row_locking.sql`'s own header comment for the pattern/reasoning to reuse).
   - Regular staff's "quantity sold" field and its existing batch save flow are **unaffected** — only the store-manager's two fields move to autosave. Confirm with the user whether this means the store-manager and regular-staff views of `/entry` now have two different save models on the same screen (batch Save button for regular staff's own field entry, autosave status strip for the store-manager's fields) — this is a real UX inconsistency worth flagging explicitly before building, not something to silently decide.

## New instruction from this session's end — CONFIRM BEFORE BUILDING, don't assume

The user said **"Remove wastage"** for this screen as their last instruction before ending the session, but this contradicts what was explicitly settled earlier in the same conversation (see the audit write-up: "Wastage still present here — and that's correct, don't touch it... this screen's wastage is `stock_entries.wastage` (finished menu items), which stays store-manager/staff-entered"). It's unclear whether:

(a) the user changed their mind and now wants `stock_entries.wastage` removed from **this whole screen** (both store-manager and regular-staff cards, since wastage isn't currently branched by `isStoreManager` in `EntryClient.tsx` — it's a shared field), which would be a much bigger scope change requiring the same kind of "who logs it now" architectural decision the `/store` session made for `ingredient_entries.wastage` (see `docs/01_DATA_MODEL.md` §3.3's existing Phase 10 correction as the precedent for how to document this), or

(b) they meant something narrower — e.g. just removing wastage from the store-manager's *specific two fields' UI* while regular staff keep logging `stock_entries.wastage` as before (which would be a smaller, more contained change, and wouldn't require touching the wastage architecture at all since store managers don't currently have a wastage-entry affordance distinct from regular staff's on this screen — check `EntryClient.tsx`'s current JSX to confirm wastage rendering isn't already store-manager-gated before assuming either way).

**Do not implement either interpretation without asking the user directly first.** If (a), this is genuinely phase-scale-adjacent (new admin write path or explicit "uncollectable" decision, doc updates in `01_DATA_MODEL.md`/`00_ARCHITECTURE.md` §12, likely a new acceptance script) — flag that explicitly per `CLAUDE.md`'s guidance on request scale, same as this session did.

## Process reminders (same discipline as the `/store` session)

- Summarize your understanding back to the user before writing code, including your read on the wastage-removal ambiguity above.
- Any new/changed DB write path needs `pnpm build`, `curl`-based verification (happy path, oversell rejection, RBAC, and — if autosave is built — a concurrent-write race test, per the `/store` session's `scripts/acceptance/post-launch-store-autosave.mjs` as the template), and a visual check via the `verify` skill.
- Update `docs/01_DATA_MODEL.md`/`docs/00_ARCHITECTURE.md`/`docs/SCREENS.md` in the same piece of work if anything architectural changes — don't leave docs stale.
- Write or extend a `scripts/acceptance/post-launch-*.mjs` script for the new autosave endpoint, same bar as `post-launch-store-autosave.mjs`.
- This is post-launch maintenance work, not a new phase — no `docs/phases/phaseX_context.md` file needed, per `CLAUDE.md`.
