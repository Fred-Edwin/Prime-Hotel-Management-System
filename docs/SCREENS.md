# Prosper Hotel Management System — Screens & User Flows Inventory

> This is the single place to find "what screens does this product have, who sees them, and which phase builds them." It doesn't duplicate the *why* (see `PRD.md` §4 for narrative user journeys) or the *visual treatment* (see `docs/design/02_PATTERNS_AND_CHECKLIST.md` §5 for cross-screen visual patterns) — it's an index that points at both.

---

## How to read this

- **Route** is the actual Next.js path, matching `CLAUDE.md`'s Project Structure section — if this document and the code ever disagree, the code plus `CLAUDE.md` win; fix this file.
- **Phase** is which `docs/04_PHASE_PLAN.md` phase builds the screen. Don't build a screen ahead of its listed phase, and don't be surprised a screen doesn't exist yet if its phase hasn't happened — check `docs/phases/phaseX_context.md` for actual current state.
- **PRD journey** cross-references `PRD.md` §4's numbered user journeys for the business "why" behind the screen.
- **Design pattern** cross-references `docs/design/02_PATTERNS_AND_CHECKLIST.md` §5 where a screen has a named visual pattern beyond standard components.

---

## Staff-facing screens

| Screen | Route | Who sees it | Purpose | PRD journey | Design pattern | Phase |
|---|---|---|---|---|---|---|
| Login | `/login` | Everyone (unauthenticated) | Name + PIN authentication, routes to the right area based on role | — | Components §4.1 | 2 |
| Restaurant Daily Entry | `/entry` (restaurant-scoped) | Restaurant staff (all) | Log today's till sales (no wastage — moved to admin, see `00_ARCHITECTURE.md` §12's post-launch `/entry` correction); store-manager-flagged user instead sees kitchen-output split (added stock / sent to canteen, typed numeric inputs, autosaved per field) plus a read-only "sold at till today" line | §4.1, §4.2 | Patterns §5 "Daily entry" (store-manager fields redesigned post-launch, own `PUT /api/stock-entries` autosave path — no longer the batch TillStrip flow) | 4 (store-manager view redesigned post-launch) |
| Ingredient Entry (Store) | `/store` | Restaurant staff, store-manager-flagged only | Log raw ingredient receiving and usage at the central store, one field autosaved at a time (no wastage — moved to admin, see `00_ARCHITECTURE.md` §12's Phase 10 correction) | §4.2 | Compact per-ingredient cards, own stylesheet (`store.module.css`) — no longer shares `/entry`'s "Daily entry" card/stepper pattern | 4 (redesigned Phase 10) |
| Canteen Weekly Entry | `/entry` (canteen-scoped) | Canteen staff | Log this week's stock reconciliation (no wastage — moved to admin, same post-launch correction as restaurant); `canteen_supplied` items show pre-filled read-only `added_stock` | §4.3 | Patterns §5 "Weekly reconciliation" (sunken header band, date-range label) | 5 |
| Expenses | `/expenses` | All staff (both locations) | Log operating costs (electricity, gas, charcoal, other), scoped to own location | §4.5 | Standard components only, no named pattern | 5 |
| Orders | `/orders` | All staff (both locations, if canteen delivers) | Log a delivery or pickup order — customer name, zone/fee or pickup, item lines | §4.4 | Patterns §5 "Delivery/pickup order entry" (reuses stepper + running-total bar) | 6 |
| Summary | `/summary` | All staff | Read-only view of today's/this week's own saved entries | (supporting, not a distinct PRD journey) | Standard components only | Stubbed opportunistically in Phase 4 if time allows; otherwise flag as deferred — see Phase 4's context file |

## Admin-facing screens

| Screen | Route | Who sees it | Purpose | PRD journey | Design pattern | Phase |
|---|---|---|---|---|---|---|
| Dashboard | `/dashboard` | Admin only | Period-toggled profit metrics (sales, cost, wastage, net profit, closing stock value), per-location split, low-stock section | §4.6 | Patterns §5 "Admin dashboard" (only screen using the dark aubergine hero band) | 7 |
| Item Ledger | `/dashboard/ledger` | Admin only | Detailed per-item, per-period table — every `stock_entries` column; separate ingredient ledger section | §4.6 | Standard table (Components §4.11), light surface | 7 |
| Items | `/items` | Admin only | CRUD for the sellable menu item catalog (name, category, supply_type, prices, active flag) | §4.7 | Patterns §5 "Catalog/staff management" (table + modal) | 3 |
| Ingredients | `/ingredients` | Admin only | CRUD for the raw ingredient catalog | §4.7 | Patterns §5 "Catalog/staff management" | 3 |
| Delivery Locations | `/delivery-locations` | Admin only | CRUD for delivery zones + fixed fees | §4.7 | Patterns §5 "Catalog/staff management" | 3 |
| Staff | `/staff` | Admin only | Create, edit (name/role/location/store-manager flag), soft-deactivate/reactivate, and PIN-reset staff accounts. No hard delete — see `01_DATA_MODEL.md`'s `users.active` note | §4.7 | Patterns §5 "Catalog/staff management" (edit modal + PIN-reset modal added Phase 9) | 3, edit/deactivate/PIN-reset added Phase 9 |
| Order Detail (admin) | `/dashboard/orders` | Admin only | Read-only list of delivery/pickup orders across both locations, period-toggled, with drill-in to an individual order's line items | §6 | Standard table (Components §4.11) + Modal drill-in, light surface, same pattern as Item Ledger | 9 (not in the original 1–8 plan — see `docs/phases/phase9_context.md`) |

---

## Shared/structural (not a distinct screen, but part of every flow)

| Element | Purpose | Design spec | Phase |
|---|---|---|---|
| Bottom tab nav (staff) | Entry / Orders / Expenses / Summary, plus Store for the store-manager-flagged user only | Components §4.12 | 4 |
| Top bar + Role/Location badge | Shows which location a staff member is scoped to, or "Admin · All locations" | Components §4.6, §4.12 | Introduced alongside whichever screen first needs it (Phase 2's login shell at the latest) |
| Empty states | Every list/table/dashboard screen above needs one — no exceptions | Components §4.15 | Verified per-screen as each phase builds it; swept for completeness in Phase 8 |

---

## What's deliberately not a screen

Per `PRD.md` §2 and `04_PHASE_PLAN.md`'s "What's explicitly NOT in this phase plan": no debtor/credit ledger screen, no trend-chart screen, no order status/rider-tracking screen, no customer-facing screen of any kind (this is 100% internal staff/admin tooling — Prosper Hotel's customers never log in).

---

## Keeping this current

Whichever phase builds or changes a screen updates this file in the same phase, and notes the change in that phase's `docs/phases/phaseX_context.md` — same rule as any other doc under `CLAUDE.md`'s "don't silently deviate" principle. If a screen's route, purpose, or phase assignment here conflicts with `04_PHASE_PLAN.md`'s phase details, `04_PHASE_PLAN.md` wins for phase sequencing; this file wins for the definitive screen list — reconcile and flag the conflict rather than silently picking one.
