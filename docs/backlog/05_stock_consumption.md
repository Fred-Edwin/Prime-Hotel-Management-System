# Net profit stops double-counting wastage/staff meals; unified "Non-Sales Stock Consumption" ledger

**Status:** Implemented 2026-07-22, same session (including the signed-adjustment follow-up below).
**Depends on:** §3.8's periodic-inventory COGS switch (2026-07-21) — this is a direct continuation of that change, not independent of it.
**Phase-scale?** No — normal post-launch feature work, scoped as one unit (not split into a phase, per direct instruction).

**Naming correction (same session):** the section/UI label is **"Non-Sales Stock Consumption"**, not the working title "Stock Consumption" used through most of this doc and in early code comments — client feedback that the plain name didn't make clear this is stock that moved without a sale. Only the *display* label changed; the internal identifier (`stockConsumption` field name throughout the API/SQL/TypeScript, `dashboard_stock_consumption_ledger()` function name) was deliberately left as-is — renaming that would have meant another migration and touching every call site for no functional benefit.

## The problem (client-reported, WaPrecious, 2026-07-22)

Since §3.8, dashboard COGS is computed as `Opening Stock Value + Added Stock Value − Closing Stock Value` (WaPrecious's own Excel-era periodic-inventory formula). Wastage and staff meals both reduce `closing_stock` (§3.3, §3.5) — so their cost is **already** embedded in COGS via a lower closing-stock value. But `netProfit()` also subtracts `wastageValue` and `staffMealValue` as separate terms:

```
netProfit = salesValue − costValue − expenses − wastageValue − staffMealValue   (current, wrong)
```

This double-counts: ingredients/items consumed to wastage or staff meals lower closing stock (raising COGS) *and* get subtracted again explicitly. Net profit is understated by the combined wastage + staff-meal value every period.

She also flagged the same double-count one level down: she's zeroing `items.buying_price` for ingredient-cooked menu items so `stock_entries.cost_value` (`quantity_sold * buying_price_snapshot`) stops contributing anything for those items, since the ingredient cost that produced them is already counted via `ingredient_entries`'s side of COGS. This is a data-level (not code-level) resolution of the known overlap §3.8 already documented as an accepted tradeoff — no schema change needed for that half; noted here for the record since it's the same root complaint.

## Confirmed design (2026-07-22)

1. **`netProfit()` drops the `wastageValue`/`staffMealValue` terms entirely**:
   ```
   netProfit = salesValue − costValue − expenses
   ```
   Wastage and staff meals become **reporting-only** figures — visible for stock-control purposes, never subtracted from profit again (COGS already carries their cost).

2. **Two new consumption categories, confirmed to be added**, alongside the existing wastage and staff meals: **complimentary meals** and **stock adjustments**. Both mirror `staff_meal_entries`'s exact shape (own table, item + quantity + optional note + staff attribution, `value = quantity * buying_price_snapshot`, own-location RLS, folded into `closing_stock`/the oversell check as a new contributor in all six `stock_entries` writer functions) — not a free-text amount, not a signed adjustment delta. New tables: `complimentary_meal_entries`, `stock_adjustment_entries`.
   - **Complimentary meals**: menu items given away free (e.g. to a guest/visitor) — same shape and reasoning as staff meals, just a different real-world reason.
   - **Stock adjustments**: a catch-all claim for reconciling a physical-count mismatch that isn't spoilage (wastage) or a specific known reason — still item + quantity + note, costed the same way, not a separate positive/negative delta mechanism. If a future request needs signed corrections (adding stock back, not just removing it), that's an explicit new design conversation, not assumed here.

3. **`closing_stock`'s formula gains two more subtracted terms**, alongside `wastage` and `staff_meals`:
   ```
   closing_stock = total_stock − sent_out − quantity_sold − wastage − staff_meals − complimentary_meals − stock_adjustments
   ```
   Same treatment in the oversell check. All six existing `stock_entries` writer functions (`save_stock_entry`, `save_canteen_stock_entry`, `apply_order_to_stock_entry`, `save_stock_entry_store_manager_fields`, `save_stock_entry_cashier_field`, `save_stock_entry_canteen_field`) need the same mechanical addition `staff_meals_total()` already received in §3.5 — two more `_total()` lookups, folded into the same arithmetic. Two new write functions, `create_complimentary_meal_entry()`/`create_stock_adjustment_entry()`, mirror `create_staff_meal_entry()` exactly (insert claim row, force a same-transaction `stock_entries` recompute, oversell re-check including the new claim's own quantity).

4. **Unified ledger presentation, not a unified table.** Wastage (sourced from `stock_entries`/`ingredient_entries` columns, no per-claim identity), staff meals, complimentary meals, and stock adjustments (all three: per-claim tables with staff attribution) don't share one row shape — forcing them into one physical table would mean nullable-heavy columns or losing wastage's per-item-per-day shape. Instead: **one new SQL function**, `dashboard_stock_consumption_ledger(p_from, p_to, p_location)`, returns a tagged union — one row shape with a `category: 'wastage' | 'staff_meal' | 'complimentary_meal' | 'stock_adjustment'` discriminant plus common displayable fields (date, item/ingredient name, location, quantity, value, note, staff name where applicable — null for wastage, which has no per-claim staff attribution). This replaces the ledger screen's standalone "Staff meals" section with one "Stock Consumption" section, filterable by category chips (confirmed UI direction — one section, filter chips, not an always-visible unfiltered list or four parallel sections).

5. **Dashboard summary**: a "Stock Consumption" total (sum of all four categories' values) alongside a per-category breakdown, replacing the current separate "Total wastage value"/"Staff meals value" metric cards. Net profit no longer subtracts any of this — it's purely informational.

6. **Staff-facing entry**: two new tabs on the existing `/expenses` screen (alongside Expenses, Staff meals), "Complimentary meals" and "Stock adjustments" — reusing `StaffMealsClient.tsx`'s exact pattern (search/category-filter item picker, quantity stepper capped at available stock via a mirrored `*_available_stock()` function, optional note, submit + running list), not new standalone routes.

## Explicitly not in scope

- Any payroll/deduction logic tied to consumption value (same exclusion as staff meals).
- A formal reason-code taxonomy for stock adjustments beyond free-text `note` (same "no reason enum" precedent as `wastage_note`).
- Any change to how ingredient wastage is entered (still an open gap per §3.3's Phase 10 correction — unrelated to this work).

## Signed stock adjustments (follow-up, same session, 2026-07-22)

**What changed:** the original design above explicitly scoped stock adjustments as consumption-only (positive quantity, same direction as wastage/staff meals/complimentary meals) — see the now-superseded bullet that used to be here. Client feedback, raised right after the first pass shipped: physical recounts at Prosper Hotel sometimes find **more** stock than the system shows, not just less. Stock Adjustments needed to become signed.

**Sign convention:** `stock_adjustment_entries.quantity` is now signed — **positive = shortfall** (removes stock, same direction every other consumption category already uses), **negative = surplus** (adds stock back). This was chosen as the least invasive option:
- `closing_stock`'s formula (`total_stock − sent_out − quantity_sold − wastage − staff_meals − complimentary_meals − stock_adjustments`) needed **no shape change** — subtracting a negative number already adds it back arithmetically.
- The oversell check (`sent_out + quantity_sold + wastage + staff_meals + complimentary_meals + stock_adjustments > total_stock`) needed **no change either** — a negative (surplus) adjustment only ever shrinks the left-hand side, so it can never cause a false rejection, while a positive (shortfall) adjustment is still capped exactly as before. None of the six `stock_entries` writer functions' oversell arithmetic needed touching — only `stock_adjustment_entries`'s column constraint (`check (quantity <> 0)` instead of `> 0`) and `create_stock_adjustment_entry()`'s `value` derivation changed. See `20260722110000_signed_stock_adjustments.sql`.
- `value = quantity * buying_price_snapshot` still works signed: a shortfall gets a positive (cost) value, a surplus gets a negative value — displayed distinctly (a `+` prefix and "(surplus)"/"(shortfall)" qualifier), never silently folded into a "usage" total that would misread a surplus as a loss.

**UI (client requirement: "simple and concise"):** `StockConsumptionClient.tsx` (the shared component behind all three self-service `/expenses` tabs) gained an optional `signed` prop, used only by the Stock Adjustments tab. When set, a two-option toggle ("Remove" / "Add") appears above the quantity stepper — the stepper has no upper cap in "Add" mode (you can't oversell by finding more stock), and the submitted quantity is negated for a surplus. The other two tabs (Staff meals, Complimentary meals) are entirely unaffected — `signed` defaults to `false`, and they never pass it. (Relabeled from the original "Missing stock" / "Found extra" wording, 2026-07-22, same session — client asked for simpler labels.)

**Also requested in the same follow-up:**
- **Rename** "Stock Consumption" → "Non-Sales Stock Consumption" everywhere it's displayed (see the naming-correction note above the fold).
- **New "Total closing stock" hero metric** on the admin dashboard — restaurant + canteen + ingredients combined into one figure, shown alongside (not replacing) the three existing split tiles. No backend change needed: `app/api/dashboard/summary/route.ts`'s `combined.closingStockValue` was already computed this way (§3.7) — this was purely a new `DashboardClient.tsx` metric card.

## Acceptance criteria (signed follow-up)

- [x] `stock_adjustment_entries.quantity` accepts signed (nonzero) values; `create_stock_adjustment_entry()` derives `value` from the signed quantity.
- [x] A surplus (negative quantity) adjustment never triggers a false oversell rejection; a shortfall (positive) still respects the combined-total cap — covered in `lib/calculations.test.ts`.
- [x] `/expenses`'s Stock Adjustments tab has a "Remove" / "Add" toggle; the stepper is uncapped in surplus ("Add") mode.
- [x] Ledger and dashboard display a surplus distinctly (sign + qualifier), not as a bare number that reads as loss.
- [x] Verified via `curl` against `prosper-hotel-dev`: a surplus adjustment increases available stock with no oversell rejection; a shortfall still respects the cap.

## Acceptance criteria

- [x] `complimentary_meal_entries` + `stock_adjustment_entries` tables + RLS (own-location read/write for staff, both-location read for admin), mirroring `staff_meal_entries` exactly.
- [x] All six `stock_entries` writer functions updated to include `complimentary_meals`/`stock_adjustments` in `closing_stock` and the oversell check, alongside the existing `wastage`/`staff_meals` terms.
- [x] `create_complimentary_meal_entry()`/`create_stock_adjustment_entry()` write functions, mirroring `create_staff_meal_entry()`'s same-transaction recompute + oversell re-check.
- [x] `lib/calculations.ts`'s `netProfit()` updated to `salesValue − costValue − expenses` only; all callers (dashboard summary route) updated to match.
- [x] `dashboard_stock_consumption_ledger()` SQL function + `/dashboard/ledger` UI rebuilt around it (category filter chips, replacing the standalone Staff meals section).
- [x] Dashboard summary shows a combined "Non-Sales Stock Consumption" figure + per-category breakdown, no longer subtracted from net profit.
- [x] Two new `/expenses` tabs for staff entry, mirroring `StaffMealsClient.tsx`.
- [x] `docs/01_DATA_MODEL.md` updated in the same piece of work: revised `closing_stock`/`net_profit` formulas, new tables, new ledger function, corrected §3.3/§3.5/§3.8 net-profit language, new §3.10.
- [x] Verified via `curl`: a complimentary-meal and a stock-adjustment claim each reduce closing stock correctly, an oversell attempt against the combined total is rejected, and the dashboard/ledger figures reflect the new net-profit formula and unified consumption ledger.
