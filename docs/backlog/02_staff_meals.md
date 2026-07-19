# Staff meal / unpaid-food consumption accounting

**Status:** Design confirmed with the human 2026-07-19. Not yet implemented.
**Depends on:** Nothing.
**Phase-scale?** No — normal post-launch feature work.

## The problem

Restaurant staff sometimes eat food from stock without it being a paying sale. Today that stock simply disappears from `stock_entries` with no attribution — it either gets silently absorbed into wastage, or (worse) makes closing-stock figures not reconcile against what was actually sold, since there's no category for "consumed internally, not sold, not wasted."

## Confirmed design (2026-07-19)

Unlike `wastage` (which is entered by whoever is already filling in that day's stock sheet), staff meals are **self-service**: each staff member logs their own meal claim, attributed to them. That attribution requirement, plus multiple staff potentially claiming against the same item/day, rules out a single `stock_entries` column (one row per item/location/date has no room for "who"). Decision: **separate table**, not a column.

1. **New table `staff_meal_entries`**: `item_id`, `location`, `meal_date`, `quantity`, `buying_price_snapshot` (snapshotted, same rationale as everywhere else), `value` (`quantity * buying_price_snapshot`), `note` (optional free text), `staff_id` (who ate it — attribution, confirmed required), `created_by`, `created_at`. Costed at `buying_price_snapshot` like `wastage_value`, never at selling price — no sale occurred.
2. **Entry is item + quantity, not a free-text cash amount** — staff pick the actual menu item and a quantity, like a lightweight order. The system derives `value` from the item's buying price automatically; staff never type or estimate a shilling amount. This also means it correctly reduces that item's `closing_stock`, keeping stock reconciliation against a physical count intact (the same reason wastage tracking became V1 scope).
3. **Reduces `stock_entries.closing_stock`** for that item/location/date, as a new third contributor alongside `wastage`: `closing_stock = total_stock - sent_out - quantity_sold - wastage - staff_meals`. Must **not** be folded into `wastage_value` — it's a distinct bucket with its own dashboard line, so the wastage figure's meaning doesn't silently change.
4. **Location-scoped the same way as everything else** — a staff member can only log against their own location's items/stock (own-location RLS, consistent with `stock_entries`/`expenses`/`orders`), not "restaurant only regardless of staff location."
5. **Staff-facing entry point: a new tab on the existing `/expenses` screen** (not a new standalone route/nav item) — staff already go there to log costs; add "Staff meals" as a second tab alongside the existing expense form, reusing `ExpensesClient.tsx`'s form + running list pattern rather than inventing new navigation.
6. **Admin-facing: itemized table** (who, what item, quantity, value, date) surfaced on `/dashboard/ledger` alongside the existing wastage breakdown, matching that screen's existing reporting-lens pattern (Phase 9).
7. **`net_profit` formula gains a fifth term**: `sales_value - cost_value - expenses - wastage_value - staff_meal_value`.
8. **Oversell validation** (`sent_out + quantity_sold + wastage > total_stock`) must also account for staff meals: `sent_out + quantity_sold + wastage + staff_meals > total_stock` — a meal claim that would push the combined total over what's in stock must be rejected, same as an oversold till sale or order.

## Explicitly not in scope

- Any payroll/deduction logic tied to consumption value.
- Formal meal-plan/allowance rules (e.g. "each staff gets X per day free").

## Acceptance criteria

- [ ] `staff_meal_entries` table + RLS (own-location read/write for staff, both-location read for admin) created via migration.
- [ ] Staff meal claims reduce the correct item's closing stock correctly, verified against a manual calculation — including the oversell rejection case.
- [ ] Staff meal value is visibly distinct from `wastage_value` on the dashboard/ledger — not merged into it, itemized with staff attribution.
- [ ] `docs/01_DATA_MODEL.md` updated in the same piece of work (new table, revised `closing_stock`/`net_profit` formulas, oversell check).
- [ ] `scripts/acceptance/*.mjs` extended: closing-stock correctness, oversell rejection, RLS own-location scoping, cross-location admin read.

---

## Agent-session prompt

> You are a full-stack engineer working on the Prosper Hotel Management System, a Next.js 14 + Supabase app for a Kenyan restaurant/canteen business (see `CLAUDE.md` at the repo root for full context — read it first). Implement staff meal / unpaid-food consumption accounting as described in `docs/backlog/02_staff_meals.md` — the design is already confirmed (see "Confirmed design" section, dated 2026-07-19): a new `staff_meal_entries` table (item + quantity + staff attribution, not a free-text cash amount), reducing `stock_entries.closing_stock` as a third contributor alongside `wastage` but with its own distinct `staff_meal_value` dashboard line (never folded into `wastage_value`), entered by staff themselves on a new tab on the existing `/expenses` screen, own-location scoped like every other write path, and surfaced to admin as an itemized table on `/dashboard/ledger`. Read `docs/phases/phase9_context.md` first for current repo state, then `docs/01_DATA_MODEL.md` §3 and §3.3 for the existing `wastage`/calculation patterns this mirrors, and `docs/01_DATA_MODEL.md` §3.4 for the oversell-check/concurrency discipline this must extend (staff meals become a third contributor to the "can't exceed total_stock" check alongside till sales and orders). Follow `CLAUDE.md`'s non-negotiable constraints, update `docs/01_DATA_MODEL.md` in the same piece of work, and write/extend a `scripts/acceptance/*.mjs` script per CLAUDE.md's acceptance-script discipline (this has real oversell/closing-stock/RLS correctness risk). Summarize your understanding back before writing code.
