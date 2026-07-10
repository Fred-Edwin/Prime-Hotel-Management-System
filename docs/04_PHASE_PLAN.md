# Prime Hotel Management System — Phase Plan (Master Overview)

> This is the map, not the territory. This file replaces the old `04_SPRINT_PLAN.md` (deleted — it predated the orders/delivery feature and the Prime Hotel rebrand). It exists so any session can see the whole build arc at a glance before diving into one phase's detail.

---

## How phases replace sprints here

A **phase** is a coherent chunk of the build with its own goal, scope, and gating checklist — similar in spirit to the old "sprints," but two things are different:

1. **Phase 1 is Design**, not code. Nothing in Phase 2 onward starts until the design system exists as real, referenceable documentation and code (tokens + base components) — not a mockup, not a vibe. Every later phase's frontend work is gated on using it.
2. **Every phase ends with a gating checklist** (tests written and passing, build passing, design-system conformance where applicable) before the next phase is allowed to start. This is stricter than the old sprint plan's acceptance-criteria checkboxes — those were self-reported; this is meant to be mechanically verifiable (a person or CI can check pass/fail, not just "looks done").

Context handoff between phases (what was built, problems hit, instructions for next time) is **not** described in this file — see `CLAUDE.md` for that protocol and the `docs/phases/phaseX_context.md` file format.

---

## Phase sequence

| # | Phase | Depends on | Roughly covers |
|---|---|---|---|
| 1 | **Design System & Requirements** | None | Implement the already-documented design system (`docs/design/`) as code: tokens (`app/globals.css`) and base components (Button, Input, Stepper, Card, MetricCard, etc.), matching the docs exactly |
| 2 | **Foundation, Auth & CI/CD** | Phase 1 | Repo scaffold using the Phase 1 components where applicable, Supabase project + full schema/RLS/triggers migration (per `01_DATA_MODEL.md`, including the §3.4 concurrency fix), Name+PIN login, role/location routing, CI pipeline (lint, typecheck, test, build on every push) |
| 3 | **Admin Management Shell** | Phase 2 | Admin nav shell (styled per the design system), item master, ingredient catalog, delivery-locations catalog, staff account creation |
| 4 | **Restaurant Daily Entry** | Phase 3 | The core mobile stock entry screen (steppers, till strip, wastage), store manager's ingredient entry screen — the highest-stakes UI in the product |
| 5 | **Canteen Weekly Entry & Expenses** | Phase 4 | Adapts Phase 4's pattern to canteen's weekly cadence + the `canteen_supplied_total()` cross-location aggregation; expense logging for both locations |
| 6 | **Delivery Orders** | Phases 3, 5 | Order entry screen, `orders`/`order_items` write path, the `recalculate_stock_entry()` mechanism and idempotency key from `01_DATA_MODEL.md` §3.4 — tested specifically for the concurrent-write scenario it exists to prevent |
| 7 | **Admin Dashboard & Reporting** | Phases 4–6 | Profit dashboard, item/ingredient ledgers, wastage and order figures — needs real data flowing from prior phases to test against |
| 8 | **Polish, Hardening & Production Deploy** | Phases 1–7 | Empty states, error handling, RLS re-verification, mobile responsiveness pass, design-system conformance audit across every screen, production Supabase + Vercel deploy |

**Why this order:** Design has to exist before any UI gets built against it, or every later phase risks inventing its own styling that then needs retrofitting. Foundation (schema, auth, CI) has to exist before anything else can be built or tested meaningfully. Admin management comes before entry screens because entry screens need real items/ingredients/delivery-zones to select from. Restaurant (daily) comes before canteen (weekly) because it's the higher-frequency, higher-stakes flow — get it right once, then adapt the pattern. Orders comes after both entry flows and the delivery-locations catalog because it depends on all three and carries its own nontrivial correctness work (§3.4). Dashboard comes last among features because it has nothing real to display until entry/order flows exist and produce data. Polish is its own phase, not sprinkled throughout, so "make it feel good and correct" gets dedicated attention.

---

## Standard gating checklist (applies to every phase, in addition to that phase's own acceptance criteria)

A phase is not complete until all of these are true. The phase's context file (see `CLAUDE.md`) must explicitly confirm each one, not just assert "done":

- [ ] **Automated tests exist for the phase's core logic** (calculation functions, validation rules, RLS-dependent behavior) **and pass.** Not every UI interaction needs a test — but anything touching money, stock quantities, or access control does.
- [ ] **`pnpm build` succeeds with zero errors.** TypeScript strict mode has zero `any` without an explaining comment (per `CLAUDE.md`'s existing rule).
- [ ] **CI pipeline is green** on the phase's final commit (from Phase 2 onward, once CI exists — see Phase 2 below).
- [ ] **Any frontend work in this phase uses only the design system's tokens and components** (`docs/design/*.md` + the component library from Phase 1) — no ad hoc hardcoded colors, spacing, or one-off styled elements that duplicate something the system already provides. If the design system genuinely doesn't cover a needed pattern, that's a flagged gap (see below), not a silent workaround.
- [ ] **RLS re-verified by testing, not by reading policy**, for any phase that touches data access (see `01_DATA_MODEL.md` §4) — log in as the relevant role/location and confirm the boundary holds.
- [ ] **Any deviation from this phase's spec, or from `01_DATA_MODEL.md`/`00_ARCHITECTURE.md`, is documented with its reason** in the phase's context file — never silently diverge (see `CLAUDE.md`).
- [ ] **Any gap found in the design system** (a needed UI pattern it doesn't cover) is flagged in the phase's context file as an explicit note for a human design decision, not silently improvised.

---

## Phase details

### Phase 1 — Design System & Requirements

**Depends on:** Nothing (first phase)
**Input already provided:** the design system is documented in `docs/design/00_FOUNDATIONS.md`, `01_COMPONENTS.md`, `02_PATTERNS_AND_CHECKLIST.md` (Prime Hotel's brand palette, type scale, spacing, component specs, patterns, and pre-ship checklist). This phase implements that system as code — it does not originate the system from scratch.

**Goal:** Turn the already-documented design system into real, working code — tokens and base components — so later phases *use* the system rather than reinvent styling per-screen.

**Scope:**
- Read `docs/design/00_FOUNDATIONS.md` and `01_COMPONENTS.md` in full.
- Implement design tokens as CSS custom properties in `app/globals.css`, matching `00_FOUNDATIONS.md` §3's token block exactly (per `00_ARCHITECTURE.md` §6's existing rule: self-hosted fonts via `next/font`, no CDN — Manrope + IBM Plex Sans, both self-hosted).
- Implement a base component library in `components/` per `01_COMPONENTS.md`'s specs (Button, Input, Stepper, TillStrip/Running Total Bar, Card, MetricCard/Stat Card, Role/Location Badge, Period Toggle, Low-Stock Indicator, Modal, Toast, Empty State, CategoryChips placeholder) using CSS Modules that reference only the tokens — no hardcoded values inside component styles.
- Integrate the Prime Hotel logo asset (`public/`) and confirm it renders correctly per `01_COMPONENTS.md` §4.1/4.12's brand-presence notes (wordmark in Manrope, no illustrated lockup).
- **No page-level screens are built in this phase** — only the token layer and reusable components. Screens get built in the phases that need them (3–8), each one required to use this layer and to pass `02_PATTERNS_AND_CHECKLIST.md` §6's review checklist.

**Explicitly not in scope:**
- Full page mockups/wireframes for entry, dashboard, or orders screens — `02_PATTERNS_AND_CHECKLIST.md` §5 already covers the cross-screen visual patterns; each relevant phase builds its own screens grounded in that, not this phase.
- Any backend/schema work.
- Changing the design system's own decisions (palette, type, spacing) — if a genuine gap or conflict is found (see `01_COMPONENTS.md` §4.15's empty-states addition as the precedent for how to handle this), flag it and extend the docs, don't silently override an existing decision.

**Acceptance criteria (in addition to the standard gating checklist):**
- [ ] `app/globals.css` defines all tokens as CSS custom properties, matching `00_FOUNDATIONS.md` §3 with no discrepancy.
- [ ] Every base component in `components/` uses only `var(--token-name)` references in its CSS Module — zero hardcoded hex/px values, verified by a quick grep, not just a visual check.
- [ ] Every component built passes the relevant items of `02_PATTERNS_AND_CHECKLIST.md` §6's review checklist (tap targets, tabular numerals, gold-on-dark-only rule, etc.).
- [ ] Logo asset is in place and renders correctly.
- [ ] A future phase can build a new screen using only the `docs/design/` files + the base components, without needing to invent a new color or spacing value for standard UI elements.

---

### Phase 2 — Foundation, Auth & CI/CD

**Depends on:** Phase 1 (design tokens/components exist for the login screen to use)
**Before starting:** Read Phase 1's context file. Read `00_ARCHITECTURE.md`, `01_DATA_MODEL.md`, and `CLAUDE.md`'s Project Structure section in full.

**Goal:** Stand up the project skeleton end-to-end: repo, Supabase project with the full schema (including the §3.4 concurrency fix, triggers, and orders tables), Next.js scaffold using Phase 1's design layer, working Name+PIN login with correct role/location routing, and a CI pipeline protecting every commit from here on.

**Scope:**
1. **Repo scaffold** — `create-next-app` (TypeScript, App Router, no Tailwind), matching `CLAUDE.md`'s Project Structure section exactly, `.env.example` committed, `README.md` pointing to `/docs`.
2. **Supabase project (dev)** — migrations applying the *entire* current `01_DATA_MODEL.md` §2 schema (enums, all 9 tables, indexes, the `set_updated_at` trigger, the `recalculate_stock_entry` function) and §4 RLS policies, in order, as separate timestamped files in `supabase/migrations/`. Generate TypeScript types.
3. **Supabase client setup** — `lib/supabase/client.ts`, `lib/supabase/server.ts`.
4. **Auth flow** — Name+PIN login screen (built using Phase 1's `Input`/`Button` components), synthetic-email mapping per `01_DATA_MODEL.md`, middleware role/location routing.
5. **Seed data** — real roster (WaPrecious admin; Janiffer Maina store manager; Sarah Makena & Mercy Wanjohi restaurant staff; Anne Gitonga canteen), sample items/ingredients/delivery-locations across categories, marked dev-only in `supabase/seed.sql`.
6. **CI/CD pipeline** — GitHub Actions (or equivalent) running on every push/PR: install, lint, typecheck, test, build. Must be green before this phase is considered complete, and from this point forward every subsequent phase's gating checklist requires a green CI run, not just a local `pnpm build`.

**Explicitly not in scope:** Item/staff management UI (Phase 3), stock entry UI (Phase 4), production deploy (Phase 8 — dev CI only here, production deployment pipeline finalized in Phase 8).

**Acceptance criteria (in addition to the standard gating checklist):**
- [ ] `pnpm dev` runs locally with no errors.
- [ ] Admin login lands on `/dashboard`; staff login lands on `/entry`.
- [ ] Staff attempting an `(admin)` route is redirected away — verified manually.
- [ ] Querying `stock_entries` as a staff account for the *other* location returns zero rows — verified by testing.
- [ ] The `recalculate_stock_entry()` function and `set_updated_at` trigger exist in the deployed dev schema and can be called/observed directly (e.g., via Supabase SQL editor) to confirm they behave as documented in `01_DATA_MODEL.md` §3.4.
- [ ] `.env.local` is gitignored, never committed.
- [ ] CI pipeline is green on the final commit of this phase, and a deliberately broken PR (e.g., a failing test) is confirmed to fail CI before merging — proving the gate actually works, not just exists.

---

### Phase 3 — Admin Management Shell

**Depends on:** Phase 2

**Goal:** Give the admin (WaPrecious) the ability to manage items, ingredients, delivery locations, and staff accounts through the UI — using Phase 1's design system throughout. Unblocks Phase 4 (entry needs real items) and Phase 6 (orders needs real delivery zones).

**Scope:**
1. **Admin shell/navigation** — styled per `docs/design/01_COMPONENTS.md` §4.12, not ad hoc.
2. **Item Master screen** — CRUD, category/supply_type selection, active/inactive toggle, Zod validation shared between client and route handler.
3. **Ingredient catalog screen** — same pattern as items.
4. **Delivery Locations screen** — admin CRUD for zone name + fixed fee (per `01_DATA_MODEL.md` §6), same soft-deactivate pattern.
5. **Staff Management screen** — create staff accounts (auto-generated `staff_code`, synthetic email + PIN), `is_store_manager` flag for restaurant staff only.
6. **API routes** — `items`, `ingredients`, `delivery-locations`, staff creation — admin-only, enforced server-side (not just RLS).

**Explicitly not in scope:** Bulk import, stock/ingredient entry UI, editing/removing staff accounts, PIN reset.

**Acceptance criteria (in addition to the standard gating checklist):**
- [ ] Admin can add/edit an item, ingredient, and delivery location, each reflected immediately on next read.
- [ ] Negative price/fee submissions rejected with a clear inline error.
- [ ] Admin can create a staff account and that person can immediately log in.
- [ ] A staff account cannot reach `/items`, `/ingredients`, `/delivery-locations`, or `/staff` — verified while logged in as staff.

---

### Phase 4 — Restaurant Daily Entry

**Depends on:** Phase 3

**Goal:** Build the mobile-first daily stock entry screen for restaurant staff — the screen used multiple times a day, where "simple, excellent UI/UX" is judged most directly. Every visual element must come from Phase 1's design system.

**Scope:**
1. **Entry screen** — category-grouped item rows, steppers, opening-stock read-only carry-forward context, closing-stock-value display, wastage input (de-emphasized but reachable), low-stock visual flag, store-manager-emphasis variant (Added stock/Sent to canteen as primary vs. Quantity sold as primary for other staff).
2. **Till strip component** — live running total, batch save (not per-tap requests).
3. **API route** (`stock-entries`) — writes `till_quantity_sold` (never `quantity_sold` directly, per §3.4), derives `opening_stock` server-side, snapshots prices, calls `recalculate_stock_entry()`, validates via Zod including the combined-total oversell check (§3.4).
4. **Bottom nav** — Entry/Expenses/Summary, Store nav item for the store-manager-flagged user only.
5. **Ingredient entry screen** (`/store`) — store-manager-only, received/quantity_used/wastage inputs, opening-stock carry-forward, closing-stock-value display.

**Explicitly not in scope:** Canteen's entry flow (Phase 5), expense logging (Phase 5), orders (Phase 6), admin dashboard (Phase 7).

**Acceptance criteria (in addition to the standard gating checklist):**
- [ ] Staff can log in, see today's items for their location only, use steppers with immediate feedback, no page reload per tap.
- [ ] Till strip total matches manual calculation.
- [ ] Save persists; reopening the page later the same day shows saved values, not a reset.
- [ ] Opening stock on day 2 correctly equals day 1's saved closing stock — verified across at least two real consecutive days.
- [ ] Wastage reduces closing stock and produces correct `wastage_value`.
- [ ] Overselling validation (`sent_out + quantity_sold + wastage > total_stock`) is rejected with a clear error.
- [ ] Canteen staff cannot see or affect restaurant entries.
- [ ] Store-manager-flagged user sees the emphasized fields and the Store nav item; other restaurant staff and canteen staff do not see the Store nav item.
- [ ] Screen is comfortably usable at ~375px width.
- [ ] `/store` entries calculate and carry forward correctly, same as the main screen.

---

### Phase 5 — Canteen Weekly Entry & Expenses

**Depends on:** Phase 4

**Goal:** Adapt Phase 4's pattern to canteen's weekly cadence and the cross-location supply aggregation, and add expense logging for both locations.

**Scope:**
1. **Canteen entry adaptation** — weekly `entry_date` convention (Monday of the current week, documented explicitly in this phase's context file), opening stock from last week's close, `added_stock` for `canteen_supplied` items pulled read-only via `canteen_supplied_total()`, `added_stock` for `canteen_independent` items as a normal editable input, wastage same as restaurant.
2. **Expense logging screen** — category pills, amount, optional note, scoped server-side to the logged-in user's location.
3. **Admin visibility check** — confirm admin can read canteen entries/expenses (manual check, no new admin UI yet — that's Phase 7).

**Explicitly not in scope:** Admin dashboard (Phase 7), delivery/pickup orders (Phase 6), any reminder/notification system for the weekly count being due.

**Acceptance criteria (in addition to the standard gating checklist):**
- [ ] Canteen staff can log a week's entry using the same interaction pattern as restaurant.
- [ ] `canteen_supplied` item's `added_stock` correctly equals the sum of the restaurant's daily `sent_out` for that item across the week — verified against real data logged on 2–3 different days.
- [ ] `canteen_independent` items remain freely editable, unaffected by aggregation.
- [ ] Canteen staff cannot query restaurant `stock_entries` rows directly, even though the aggregate function works.
- [ ] Opening stock carries forward correctly from the prior week.
- [ ] Both locations can log an expense, correctly attributed; a crafted cross-location request is rejected, not just blocked by UI.

---

### Phase 6 — Delivery Orders

**Depends on:** Phase 3 (delivery-locations catalog), Phase 5 (stock_entries + expenses pattern established; canteen may also take orders)

**Goal:** Implement the delivery/pickup order log that replaces Prime Hotel's WhatsApp-coordinated process, including the concurrency-safe write path designed in `01_DATA_MODEL.md` §3.4. This phase carries real correctness risk (two writers touching one stock figure) and needs deliberate, tested attention — not a bolt-on.

**Scope:**
1. **Order entry screen** (`app/(staff)/orders/page.tsx`) — customer name, fulfillment type (delivery/pickup), delivery zone picker (fee auto-fills from `delivery_locations`), multi-item line entry (mirrors a receipt), styled per the design system.
2. **API route** (`orders`) — inserts `orders` + `order_items`, generates/accepts `client_request_id` for idempotency, validates item/location consistency (§3.4), calls `recalculate_stock_entry()` for each affected item — never writes `quantity_sold` directly.
3. **Concurrency test** — a real, repeatable test that logs a till sale and a delivery order for the same item/location/day close together and confirms the final `quantity_sold` reflects *both*, not just whichever wrote last.
4. **Duplicate-submission test** — simulate a retried submit with the same `client_request_id` and confirm no duplicate order/stock deduction occurs.

**Explicitly not in scope:** Order status/lifecycle, rider assignment, customer accounts, WhatsApp API integration (all deliberate V1 exclusions, per `01_DATA_MODEL.md` §6).

**Acceptance criteria (in addition to the standard gating checklist):**
- [ ] Staff can log a delivery order (with zone + auto-filled fee) and a pickup order (no zone/fee).
- [ ] An order's items correctly deduct from that day's `stock_entries.quantity_sold`, verified against a manual calculation alongside any till sales already logged that day.
- [ ] The concurrency test (above) passes.
- [ ] The duplicate-submission test (above) passes.
- [ ] An order referencing an item invalid for its location (e.g., a canteen-only item on a restaurant order) is rejected with a clear error.
- [ ] Order total (`sum(order_items) + delivery_fee_snapshot`) matches a manual calculation.

---

### Phase 7 — Admin Dashboard & Reporting

**Depends on:** Phases 4–6 (real stock entries, expenses, and orders exist to report on)

**Goal:** Give WaPrecious the profit visibility that's the core value proposition — big plain numbers, not a dense table, matching the design system.

**Scope:**
1. **Dashboard screen** — period toggle (Today/Week/Month), metric cards (Total sales, Total cost, Wastage cost, Net profit, Closing stock value), per-location breakdown, "Needs attention" low-stock section.
2. **Item-level ledger view** — per-location, per-period table of every `stock_entries` column; separate ingredient ledger section (restaurant only).
3. **Profit calculation** — extends `lib/calculations.ts`, net profit = sales − cost − expenses − wastage, correctly inclusive of order-driven sales.
4. **Data fetching** — server-side SQL aggregation (`sum()`/`group by`), not row-by-row JS summing.

**Explicitly not in scope:** Trend charts beyond period toggles, exports, debtor/credit tracking.

**Acceptance criteria (in addition to the standard gating checklist):**
- [ ] Dashboard totals match a manually-verifiable test case exactly, including order-driven sales.
- [ ] Period toggle produces correct figures across a week/month boundary.
- [ ] Per-location split sums to the combined total.
- [ ] Low-stock items match current data, no staleness.
- [ ] Wastage cost card matches a manual sum across both `stock_entries` and `ingredient_entries`; net profit correctly deducts it.
- [ ] Ledger views match known test entries exactly, row-by-row.
- [ ] Dashboard query approach confirmed to aggregate in SQL, not in-memory.

---

### Phase 8 — Polish, Hardening & Production Deploy

**Depends on:** Phases 1–7 (full feature set functionally complete)

**Goal:** Take the functionally-complete app from "works when used correctly" to "ready to hand to a real, busy small-business owner and her staff," then deploy it for real.

**Scope:**
1. **Empty states** across every screen.
2. **Error handling pass** — human-readable API errors, offline/retry handling on save actions, specific oversell error messaging.
3. **Design-system conformance audit** — sweep every screen built in Phases 3–7 and confirm each still only uses tokens/components from Phase 1's system; fix any drift.
4. **Tech-debt sweep** — resolve or deliberately re-confirm every "known issue" noted across all `phaseX_context.md` files.
5. **RLS re-verification** — re-run every cross-location/cross-role check from Phases 2–6 against the final schema.
6. **Mobile responsiveness pass** — ~375px and ~768px for staff screens; admin screens at laptop width, at least usable on mobile.
7. **Production deploy** — production Supabase project, production Vercel deployment wired to the CI/CD pipeline from Phase 2 (production branch auto-deploys on green CI), real admin/staff accounts (no dev seed data), full manual smoke test end-to-end.

**Explicitly not in scope:** Any new feature not already built in Phases 1–7; automated test suite beyond what each phase already required (propose as follow-up if valuable, don't build unprompted here).

**Acceptance criteria (in addition to the standard gating checklist):**
- [ ] Every screen has a considered empty state, verified against a genuinely empty database.
- [ ] API errors are human-readable in the UI.
- [ ] Every design-system conformance gap found is fixed.
- [ ] All known issues from prior phase context files are resolved or explicitly re-confirmed as deferred with reasoning.
- [ ] RLS checks re-pass on the final schema.
- [ ] App is comfortable to use one-handed on a phone for staff-facing screens.
- [ ] Production deployment is live, backed by the production Supabase project, connected to CI/CD, and passes a full manual smoke test.
- [ ] Final phase context file explicitly lists what's deferred to Phase 2 (a *future* second product phase, not to be confused with these build phases) so the handover to the client is unambiguous.

---

## What's explicitly NOT in this phase plan

Per `01_DATA_MODEL.md` §5 and prior client scope discussions, the following remain out of scope for this build and have no phase allocated:
- Debtor/credit ledger
- Historical trend charts beyond basic period toggles
- Separate margin logic for business-center items vs. food
- Formal recipe/bill-of-materials linking ingredients to menu items
- Order status/lifecycle, rider assignment, WhatsApp API integration

If a phase session finds itself building toward any of these, stop — flag it, don't proceed.

---

## How to use this during actual development

1. Complete phases in order. Don't skip ahead even if a later phase looks more interesting — later phases assume earlier ones are done and documented.
2. After each phase, its `docs/phases/phaseX_context.md` gets written (see `CLAUDE.md` for the exact format) before the session ends, and the standard gating checklist above must be satisfied and confirmed in that file.
3. If reality diverges from this plan (a phase needs splitting, an order needs to change), update this file and say so in that phase's context file — don't let this document quietly go stale.
