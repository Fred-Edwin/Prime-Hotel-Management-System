# Prime Hotel Management System — Product Requirements Document

**Client:** Prime Hotel (a restaurant + university canteen business, Kenya)
**Product name:** Prime Hotel Management System
**Status:** Pre-build — requirements finalized, build not yet started
**Related docs:** `00_ARCHITECTURE.md` (how it's built), `01_DATA_MODEL.md` (database schema, the source of truth for calculations), `04_PHASE_PLAN.md` (build sequence)

> This document describes **what** the system must do and **why**, from the business's point of view. It does not repeat schema or stack detail already covered in the architecture/data-model docs — it exists so a reader can understand the product without reverse-engineering it from SQL.

---

## 1. The business problem

Prime Hotel runs two connected operations:

- **The restaurant** — a central store/kitchen that cooks and sells food and drinks daily, on-site.
- **The university canteen** — a second retail location the restaurant partially supplies, serving a student population, reconciling stock weekly rather than daily.

Today, both locations track stock, sales, and costs by hand in Excel. This creates four concrete, recurring problems:

1. **Manual carry-forward is slow and error-prone.** Every day (restaurant) or week (canteen), staff re-type yesterday's/last week's leftover count as today's/this week's starting point. Mistakes compound silently.
2. **No true profit visibility.** The admin can see rough sales figures but has no systematic way to net out cost of goods sold, operating expenses (electricity, gas, charcoal), and wastage to get a real profit number. "Are we actually making money" is a manual, error-prone exercise done occasionally, not a number available on demand.
3. **The restaurant→canteen supply chain is manually reconciled.** The restaurant sends stock to the canteen daily, but canteen only counts weekly — someone has to manually add up a week's worth of daily transfer notes to know what canteen's true starting stock is.
4. **Deliveries are coordinated over WhatsApp with no record-of-truth.** Prime Hotel offers estate/home deliveries, currently tracked only in a WhatsApp group chat — no structured log of what was ordered, by whom, for how much, making it invisible to profit reporting entirely.

The system exists to remove these four specific pieces of manual, error-prone work — not to reinvent how the business operates.

---

## 2. Goals and non-goals

### Goals
- Eliminate manual re-typing of carry-forward stock counts.
- Give the admin an accurate, on-demand profit figure that includes sales, cost of goods sold, expenses, and wastage.
- Automatically bridge the restaurant's daily supply cadence with the canteen's weekly reconciliation cadence.
- Replace the WhatsApp delivery-coordination process with a structured, reportable order log.
- Be simple enough that non-technical staff adopt it readily on a shared or personal phone, multiple times a day, without training overhead.

### Non-goals (explicitly out of scope for this build)
- **No recurring hosting cost** — this is a constraint on every decision, not a feature, but it shapes what's buildable (see `00_ARCHITECTURE.md` §2, §8).
- **No SaaS/multi-tenant design.** This is a single-business system for Prime Hotel only. Do not add tenant IDs, organization switching, or any abstraction implying multiple unrelated businesses will ever use one deployment.
- **No formal recipe/bill-of-materials** linking ingredient consumption to menu item output — the business's own knowledge here is informal, and the system doesn't pretend otherwise (see `01_DATA_MODEL.md` §3.2).
- **No debtor/credit ledger, no trend charts beyond basic period toggles, no delivery status/rider-tracking, no WhatsApp API integration, no customer accounts.** These are documented, deliberate exclusions — see `01_DATA_MODEL.md` §5 and §6, and `04_PHASE_PLAN.md`'s "What's explicitly NOT in this phase plan."
- **No native mobile app.** Mobile-first *web*, used through a browser.

---

## 3. Users and roles

Two roles exist: **admin** and **staff**. There is no third role — see `00_ARCHITECTURE.md` §5.1 for why "store manager" is a responsibility, not a permission tier.

| Person | Role | Location | Notes |
|---|---|---|---|
| **WaPrecious** | Admin | Both (sees everything) | Owns profit visibility, item/staff/pricing management |
| **Janiffer Maina** | Staff | Restaurant | Store manager — logs ingredient receiving/usage and the restaurant's kitchen-output split (floor vs. canteen), in addition to normal cashier duties |
| **Sarah Makena** | Staff | Restaurant | Cashier & waiter — daily till sales, wastage, delivery orders |
| **Mercy Wanjohi** | Staff | Restaurant | Cashier & waiter — same as Sarah |
| **Anne Gitonga** | Staff | Canteen | Weekly stock reconciliation, expenses, delivery orders (if canteen delivers) |

Every entry in the system is attributable to the staff member who made it. Staff can only see and act on their own location's data; the admin sees both. This boundary is enforced at the database level (Postgres RLS), not just hidden in the UI — see `00_ARCHITECTURE.md` §5 and `01_DATA_MODEL.md` §4.

---

## 4. Core user journeys

### 4.1 Restaurant staff — daily till sales
A cashier logs in (name + PIN), sees today's sellable items grouped by category, and taps steppers to record what sold throughout the day. Opening stock is already shown, carried forward automatically from yesterday's close — never retyped. A running total (item count, sales value) updates live. One "Save" persists the day's entries in a single batch. Wastage (spoiled/discarded stock) is logged per item with an optional note, visibly reducing closing stock and producing its own cost figure.

### 4.2 Restaurant store manager — kitchen output and ingredients
On top of normal cashier duties, Janiffer logs two additional things daily: raw ingredient movement (received from suppliers, used in cooking, spoiled) on a separate `/store` screen, and — on the main entry screen — how much of each menu item the kitchen produced that day, split between what stays on the restaurant floor and what's sent to the canteen. These are two independently observed numbers; the system does not calculate one from the other (see §2's non-goals).

### 4.3 Canteen staff — weekly reconciliation
Once a week, Anne opens her entry screen and sees each item's opening stock (carried forward from last week's close) and, for items the restaurant supplies, that week's `added_stock` already filled in — the system has summed the restaurant's daily transfers for her, so she never manually tallies a week of delivery notes. She records what was sold and any wastage for every item, including canteen's own independent stock (cyber café services, certain retail lines) that the restaurant never touches.

### 4.4 Either location — delivery/pickup orders
A cashier logs a delivery or pickup order as it happens: customer name, a delivery zone (fee auto-fills) or pickup, and the items/quantities involved. This is logged the same way a completed till sale would be — no status tracking, no rider assignment — and its items are counted in that day's sales alongside walk-in till sales, without either flow overwriting the other (see `01_DATA_MODEL.md` §3.4 for the technical mechanism this requires).

### 4.5 Either location — expenses
Staff log operating costs (electricity, gas, charcoal, other) as they're incurred, attributed automatically to their own location.

### 4.6 Admin — profit visibility
WaPrecious opens a dashboard and, without consolidating anything by hand, sees: total sales, cost of goods sold, operating expenses, wastage cost, net profit, and the cash value of stock currently on hand — for today, this week, or this month, combined or split by location. A detailed item-level and ingredient-level ledger is available underneath for the same "see everything Excel showed me" visibility, now automatic. Low-stock items are surfaced without her having to go looking for them.

### 4.7 Admin — catalog and staff management
WaPrecious manages the item catalog (menu items, prices, which location(s) they're sold at), the ingredient catalog, the delivery-zone/fee catalog, and staff accounts — all through the UI, no direct database access required for day-to-day operation.

---

## 5. Functional requirements summary

Full schema and calculation detail lives in `01_DATA_MODEL.md` — this is the plain-language summary of what the system must guarantee:

1. **Opening stock is never typed by a human.** Always carried forward from the prior period's closing stock.
2. **Prices are locked in at the moment of each entry.** A later price change never silently changes a past day's recorded profit.
3. **The restaurant→canteen supply link is automatic.** Canteen's weekly received-stock figure for restaurant-supplied items is computed, not manually reconciled.
4. **Wastage is a first-class, visible figure** — distinct from cost of goods sold and from operating expenses — for both finished menu items and raw ingredients.
5. **Delivery orders and walk-in till sales both count toward the same day's total sold, correctly and without one overwriting the other**, even if logged by different people at different times.
6. **No one can oversell** — the system rejects an entry that would sell/send/waste more stock than was actually available.
7. **Every write is attributable** to the staff member who made it, and scoped to their own location, enforced by the database itself.
8. **The admin sees a true net profit figure**: sales minus cost of goods sold minus expenses minus wastage — not just a stock margin.

---

## 6. Success criteria

The build is successful when:
- WaPrecious can answer "are we profitable this week, this month, per location" without opening Excel or asking staff to reconstruct anything by hand.
- No staff member re-types a number the system already knows (opening stock, restaurant→canteen supply totals, delivery fees).
- The WhatsApp delivery group is no longer the record-of-truth for what was delivered and for how much.
- The system runs at zero recurring hosting cost, indefinitely, at Prime Hotel's actual scale (2 locations, ~5 staff, low hundreds of entries/day).
- Staff genuinely prefer using it to the old Excel process — measured informally by continued daily/weekly use without admin intervention, not by a formal survey.

---

## 7. Constraints

- **No monthly hosting fees, ever.** Every technology choice must fit within a free tier at this business's scale.
- **Single business, not a SaaS product.** No multi-tenant abstractions, no "organization" concept — see §2.
- **No legacy data migration.** The system starts clean; no import tooling.
- **Mobile-first web, not a native app.**
- Full technical constraints (stack, hosting, environments) are in `00_ARCHITECTURE.md` §2–§3, §7–§8 — this document doesn't duplicate them.
