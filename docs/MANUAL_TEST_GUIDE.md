# Prosper Hotel Management System — Manual Test Guide

> Working scratch document for manually testing the live app on localhost. Not part of the phase-doc discipline in `CLAUDE.md` — delete or ignore once you're done with this testing pass, or keep it around and re-run it after future changes.

**Before you start, a documentation drift heads-up:** `docs/SCREENS.md` and `docs/phases/phase9_context.md` (dated 2026-07-13) are stale. `docs/01_DATA_MODEL.md` and `docs/00_ARCHITECTURE.md` describe several real post-launch changes dated 2026-07-17 through 2026-07-20 that aren't reflected there:

- Wastage entry moved **off** `/entry` and `/store` entirely — it's now admin-only via the Ledger's edit modal (`/dashboard/ledger`). Ingredient wastage currently has **no working entry screen at all** (a confirmed open gap — the dashboard will show KES 0 for ingredient wastage no matter what).
- `/entry` and `/store` now **autosave per field** as you type/tap, not one batch "Save" button.
- New screens exist that aren't in `SCREENS.md`: `/dashboard/purchases` (ingredient + canteen stock purchases, weighted-average costing), `/dashboard/audit-log`, `/dashboard/orders`.
- Staff meals (§3.5) is a whole new feature: a "Staff meals" tab on `/expenses` where staff log menu items they consumed without paying.
- The Ledger's admin edit now **cascades forward** through every later entry when you edit a historical row (not just the most recent one).
- `/summary` still does not exist as a staff route (404) — this was flagged as stubbed-if-time-allows back in Phase 4 and never got built.

This guide is written against the **actual current repo state**, not the stale docs. I'll flag it to you again below wherever it's load-bearing for a specific test.

---

## 0. Setup

### 0.1 Start the app

```bash
pnpm install   # if you haven't already
pnpm dev
```

Next.js (Turbopack) will start on `http://localhost:3000`. `.env.local` already exists and points at a **hosted free-tier dev Supabase project** (`prosper-hotel-dev`) — you do not need Docker or `supabase start`.

### 0.2 Confirm seed data is in place

```bash
pnpm seed:staff
```

This is idempotent-ish for a fresh project but will error on already-existing accounts if you've run it before — that's fine, it means the roster already exists. If you get "Failed to create auth user" for all five, they're already seeded; proceed.

You separately need the **item/ingredient catalog** seeded (menu items, ingredients, delivery zones) — check `/items` and `/ingredients` in the app once logged in as WaPrecious. If those tables are empty, look for a catalog seed script:

```bash
ls scripts/seed-data/ 2>/dev/null
```

If nothing's there and the catalog is empty, tell me and I'll help you seed it before you go further — several of the scripts below assume a populated catalog.

### 0.3 Login credentials (local dev only — never reused in production)

| Name | PIN | Role | Location | Notes |
|---|---|---|---|---|
| WaPrecious | `1234` | admin | — (sees both) | |
| Janiffer Maina | `1111` | staff | restaurant | store-manager flagged |
| Sarah Makena | `2222` | staff | restaurant | cashier |
| Mercy Wanjohi | `3333` | staff | restaurant | cashier |
| Anne Gitonga | `4444` | staff | canteen | |

Login screen (`/login`) shows a name picker (disambiguates by staff code if names collide — none currently do in this roster) then a PIN field.

### 0.4 Suggested order

Work through this roughly in "a real week" order: restaurant daily flow first (§1–3), then canteen weekly (§4), then orders/expenses (§5–6) which touch both locations, then everything admin-side (§7–10), then the cross-cutting scenarios (§11) last, since several of those scenarios reuse state you'll have created earlier.

---

## 1. Restaurant cashier — till sales (Sarah or Mercy)

**Login:** Sarah Makena / `2222`

1. Land on `/entry`. **Expect:** items grouped by category, each showing an "Opening: N" read-only line (not an input). On a fresh catalog with no prior entries, opening stock reads 0 for everything.
2. Tap the stepper (+/-) on 3 different items to record till sales, e.g. +5, +3, +2.
   **Expect:** each tap autosaves — watch for a brief saved/saving indicator per item, no separate "Save" button click needed. If you refresh the page after tapping, the values persist.
3. Confirm the running total (item count and/or sales value) updates live as you tap, without a page reload.
4. Tap into an item you haven't touched today with a value that's clearly more than 0 opening stock and 0 added stock (nobody has stocked anything yet). **Expect:** a specific message — something like *"Ask the store manager to log today's added stock first"* — not the generic oversell message. This is the deliberate "not yet stocked" distinction (`P0002`) — see §11.3 below for the full scenario.
5. Log out, log back in as Sarah again. **Expect:** today's stepper values are still there (re-fetched from the saved row), not reset to 0.

## 2. Restaurant store manager — kitchen output + ingredients (Janiffer)

**Login:** Janiffer Maina / `1111`

### 2.1 `/entry` — store-manager fields

1. Land on `/entry`. **Expect:** in addition to (or instead of, depending on how the UI splits it) the till-sale steppers, you see "Added stock" and "Sent to canteen" numeric fields per item, emphasized since Janiffer is store-manager-flagged.
2. For 2–3 items, type an "Added stock" value (kitchen output kept on the floor) and a "Sent to canteen" value for at least one item that's `canteen_supplied` (check `/items` as admin later to know which are tagged that way, or just try any item and see if canteen sees it show up in §4).
   **Expect:** each field autosaves independently on blur/debounce — you shouldn't need a batch Save button.
3. Confirm there's a read-only "sold at till today" line reflecting whatever Sarah/Mercy have logged — this confirms Janiffer's view and the cashiers' view are reading the same underlying row, not separate state.

### 2.2 `/store` — ingredient receiving/usage

1. Navigate to `/store` (only visible in the bottom nav for Janiffer — confirm it's **absent** for Sarah/Mercy/Anne when you check later).
2. For 2–3 ingredients, log a "quantity used" value. **Expect:** per-field autosave, same pattern as `/entry`.
3. Log a purchase via the "Log purchase" action for one ingredient — enter a quantity and a real unit cost that differs from its current catalog price.
   **Expect:** the purchase succeeds; the ingredient's displayed stock-on-hand increases by the purchased quantity. Don't expect to see the new weighted-average price reflected on this screen necessarily — verify the actual average recalculation later via `/dashboard/purchases` or `/ingredients` (§9).
4. **Do not expect a wastage field on this screen** — per the doc-drift note above, ingredient wastage entry was removed from `/store`. If you see one, that's a real regression worth flagging back to me.

## 3. Restaurant — no wastage entry point on staff screens (confirm the gap)

Still logged in as any restaurant staff member:

1. On `/entry`, confirm there is **no** wastage input field anywhere on the page (neither cashier nor store-manager view).
2. This is expected — wastage entry moved to admin (`/dashboard/ledger`, tested in §8). Don't file this as a bug; it's documented, deliberate, current behavior.

---

## 4. Canteen weekly reconciliation (Anne Gitonga)

**Login:** Anne Gitonga / `4444`

1. Land on `/entry`. **Expect:** a **weekly** framing (a date-range label, not a single date), distinct visually from the restaurant's daily view.
2. Find an item that Janiffer sent stock to in §2.1 (a `canteen_supplied` item). **Expect:** its "Added stock" shows a **read-only, pre-filled** value — this should be the sum of whatever Janiffer entered as "Sent to canteen" for that item across the week so far. This is the auto-populated `added_stock` the whole system exists to deliver — confirm it is genuinely not editable (no cursor/focus on tap).
   - If this reads 0 or blank when you know Janiffer sent stock: check whether Janiffer's entry landed on the correct calendar week (server-side normalization to Monday) and whether today's actual date lines up with when you ran §2. This is the single most failure-prone spot in the whole system per the architecture doc — worth double-checking before concluding it's broken.
3. Find (or create via `/items` as admin first, if none exist) a `canteen_independent` item (cyber/retail — no restaurant counterpart). **Expect:** its "Added stock" **is** a normal editable input here, unlike the `canteen_supplied` item above. Type a value into it.
4. Log a "quantity sold" for 2–3 items, including the `canteen_supplied` one and the `canteen_independent` one.
   **Expect:** per-field autosave, same as restaurant.
5. Try selling more of the `canteen_supplied` item than its `added_stock` + `opening_stock` covers, on an item where `added_stock` is currently 0 (restaurant hasn't sent any this week yet) but selling against `opening_stock` alone would also fail. **Expect:** a specific message about the restaurant not having sent this week's supply yet — not the generic oversell message. (This is the `P0003`/"not yet supplied" case — full scenario in §11.4.)

---

## 5. Delivery/pickup orders (either location)

**Login:** Sarah Makena / `2222` (restaurant) — repeat later as Anne if canteen delivers too.

1. Navigate to `/orders`.
2. Create a **pickup** order: customer name, 1–2 items with quantities, fulfillment type = pickup. **Expect:** no delivery zone picker shown/required, total = sum of item lines only.
3. Save. **Expect:** success confirmation, and the order total matches what you'd hand-calculate from the items' selling prices.
4. Create a **delivery** order: customer name, pick a delivery zone from a dropdown/list (don't expect to type a fee — it should auto-fill from the zone). **Expect:** the fee appears automatically and is included in the total.
5. Double-tap "Save order" quickly on a new order (or click Save, then immediately click it again before any response), simulating a flaky-network double-submit. **Expect:** only **one** order is created, not two — see §11.2 for how to verify this precisely via the admin order list or a direct query.
6. Try to submit an order with an item that doesn't belong to the current location (e.g., if logged in at restaurant, an item that's `canteen_independent`-only). You likely can't even select it in the picker — if the UI does let you attempt it, **expect** a clear rejection, not a silent success or a raw 500.

---

## 6. Expenses + staff meals

**Login:** any staff member, e.g. Sarah Makena / `2222`

### 6.1 Expenses

1. Navigate to `/expenses`.
2. Log an expense: pick a category (electricity/gas/charcoal/other), enter an amount, optional note. **Expect:** it saves and appears in some kind of "today's/this period's expenses" list on the same screen.

### 6.2 Staff meals (new feature — not in `SCREENS.md`)

1. Still on `/expenses`, find the "Staff meals" tab.
2. Search/tap-select a menu item (should show a category filter and a search box, not a dropdown — catalog is too large for a `<select>`).
3. **Expect:** an "Available: N" indicator per item, reflecting current effective stock. If you pick an item nobody has touched today (no `stock_entries` row yet), expect **no** available-stock cap shown (per the doc note, this is `null`, not `0` — it shouldn't block you from claiming a reasonable quantity).
4. Log a claim: pick an item, a quantity within (or at) the available cap, optional note. Submit as yourself.
5. **Expect:** the claim succeeds and reduces that item's effective closing stock — confirm by checking `/dashboard/ledger`'s staff-meals table later (§8.2) shows your name against this claim.
6. Try to claim more than the available stock for an item that does show a cap. **Expect:** a clear rejection (oversell-style message), not a silent partial success.

---

## 7. Admin — dashboard

**Login:** WaPrecious / `1234`

1. Navigate to `/dashboard`. **Expect:** the dark hero band up top with headline metrics — total sales, cost of goods sold, operating expenses, wastage cost, staff meal value, net profit, closing stock value.
2. Toggle between Today / This Week / This Month. **Expect:** numbers actually change between periods (not frozen/identical), and reflect the entries you made in §1–6 for whichever period contains today.
3. Toggle combined vs. per-location split (restaurant vs. canteen), if that control exists on this screen. **Expect:** the restaurant and canteen figures sum to the combined figure.
4. Check the "Needs attention"/low-stock section. **Expect:** any item you've driven below its `low_stock_threshold` (default 5, unless the catalog overrides it) through your test sales appears here.
5. Confirm the wastage figure is genuinely separate from cost of goods sold — they should be visually distinct line items, not merged.
6. **Expect ingredient wastage to read KES 0** regardless of what you did in §2 — this is the confirmed open gap (no admin ingredient-wastage entry screen exists yet), not something to report as a new bug. Menu-item wastage (once you set some via §8.1) should NOT be zero, though — if it also reads 0 after you've set a nonzero value, that's worth flagging.

## 8. Admin — ledger

**Login:** WaPrecious / `1234`

### 8.1 Setting wastage (the only place it can be entered now)

1. Navigate to `/dashboard/ledger`.
2. Find today's row for an item Sarah/Mercy sold in §1. Open its edit affordance.
3. Set a nonzero `wastage` and an optional `wastage_note`. Save.
4. **Expect:** the row's `closing_stock` visibly decreases by the wastage amount, and a `wastage_value` (wastage × buying price) appears — go back to `/dashboard` and confirm the "wastage cost" headline metric increased by roughly this amount.
5. Re-save the same row with `wastage = 0` unchanged from what a plain till re-save would send (i.e., go back to `/entry` as Sarah and tap another stepper for the same item). **Expect:** the wastage value you set in step 3 is **preserved**, not silently zeroed out by the till save. This is the specific "preserve, don't overwrite" guarantee described in the data model — a real regression risk if it breaks.

### 8.2 Historical edit + cascade

1. In the ledger, find an item/location with at least 2–3 days (or weeks, for canteen) of entries — go back and use `/entry` across a couple of different simulated days if needed, or just use whatever multi-day history already exists.
2. Edit an **older** row (not the most recent) — change its `quantity_sold` or wastage to something clearly different.
3. **Expect:** before finalizing, the UI warns you it will recalculate N later entries through a specific date (a "Continue" step, not a silent one-click save) — confirm this warning appears and states a plausible count/date.
4. Confirm the edit. **Expect:** every later row's `opening_stock`/`closing_stock`/`sales_value`/etc. for that same item+location updates correctly in the ledger table — spot-check one later row's numbers by hand.
5. If the item is `canteen_supplied` and you edited a restaurant row's `sent_out`: check the corresponding canteen week's `added_stock` in Anne's `/entry` view (or the canteen ledger rows) — **expect** it to have recalculated too (the cross-location cascade).
6. Try editing a historical row in a way that would make a **later** row oversell (e.g., reduce a much-earlier day's added_stock so a later day's already-recorded sales now exceed available stock). **Expect:** the whole edit is rejected atomically with a clear error — none of the chain should partially update.
7. Check the staff-meals table on this same ledger screen. **Expect:** it lists your §6.2 claim with the correct staff name, item, quantity, and value.

## 9. Admin — purchases (`/dashboard/purchases`)

**Login:** WaPrecious / `1234`

1. Navigate to `/dashboard/purchases`. **Expect:** a source-tab toggle between "Ingredients" and "Canteen Stock."
2. On the Ingredients tab, confirm the ingredient Janiffer or you purchased in §2.1/here shows updated quantity-on-hand and a recalculated weighted-average cost — hand-check the math: `(qty_on_hand × old_avg + purchase_qty × purchase_unit_cost) / (qty_on_hand + purchase_qty)`.
3. Log a second purchase for the same ingredient at a different unit cost, directly from this admin screen.
4. **Expect:** the average blends again correctly (not simply replaced by the newest price), and both purchases remain visible as separate immutable log rows (append-only — no edit/delete affordance should exist here).
5. Switch to the Canteen Stock tab, log a purchase for a `canteen_independent` item. **Expect:** succeeds, updates that item's average cost.
6. Try to log a canteen-stock purchase against a `canteen_supplied` item (if the UI lets you attempt it at all). **Expect:** a clear rejection — this must be blocked, since `canteen_supplied` items' stock can only come from the restaurant's `sent_out` aggregation, never a direct purchase.

## 10. Admin — catalog + staff management

**Login:** WaPrecious / `1234`

### 10.1 Items, ingredients, delivery locations

1. `/items` — create a new item (pick a category, a `supply_type`, buying/selling price). **Expect:** it appears immediately in the list and shows up on the relevant location's `/entry` screen for staff.
2. Edit an existing item's `selling_price`. **Expect:** the catalog price changes going forward, but a **past** stock_entries row for that item keeps its original `selling_price_snapshot` — verify via the ledger (§8) that an old row's sales value didn't change after the price edit (full scenario in §11.5).
3. `/ingredients` — same CRUD check, plus confirm you can manually override `buying_price` directly (should still work despite the weighted-average auto-calc from §9).
4. `/delivery-locations` — create a zone with a fee, confirm it appears in the zone picker on `/orders` (§5). Edit its fee, place a **new** order at that zone, confirm the new order snapshots the **new** fee while an **old** order (from before the edit) keeps showing its original fee.

### 10.2 Staff

1. `/staff` — confirm all 5 roster members are listed with correct role/location/store-manager badges and an Active status.
2. Edit a non-Janiffer restaurant staffer to flip `is_store_manager` on. **Expect:** it saves; you don't need to actually re-verify their `/entry` view changes unless you want to (that's covered by §2's logic already).
3. Try deactivating WaPrecious's own account while logged in as WaPrecious. **Expect:** blocked with a clear error (self-deactivation guard).
4. Deactivate a disposable/test account (don't deactivate a real roster member you still need for later tests — deactivate one, test, then reactivate before moving on). **Expect:** that account can no longer log in — try logging in as them in a private/incognito window and confirm you get the same generic "Name or PIN is incorrect" as a wrong PIN (not a distinguishing "account disabled" message).
5. Reset a test account's PIN to a new 6-digit value. **Expect:** old PIN stops working, new PIN works. Try resetting to a 4-digit PIN. **Expect:** rejected client-side with a clear validation message (not a raw 500).
6. Reactivate the account you deactivated in step 4.

### 10.3 Audit log

1. `/dashboard/audit-log` — confirm the staff edit, deactivate/reactivate, and PIN reset from §10.2 all appear as entries, each showing who did it (should be WaPrecious/you) and roughly when.
2. Confirm the PIN-reset entry does **not** show the actual PIN anywhere in its details.

---

## 11. Cross-cutting scenarios — easy to miss, architecturally important

These exercise the specific correctness guarantees the data model doc calls out as load-bearing. Do these last since several reuse state from earlier sections.

### 11.1 Re-saving the same day/week doesn't duplicate

1. As Sarah, tap the stepper on an item on `/entry`, wait for autosave, then tap it again for a different value shortly after.
2. Check `/dashboard/ledger` for that item/date. **Expect:** exactly **one** row for that item+location+date, with the latest value — not two rows, not a stale first value.
3. Repeat conceptually for Anne's canteen week — save a value, then save a different value for the same item later in the same week. **Expect:** one row per item per week, correctly updated, not duplicated.

### 11.2 Oversell attempt is rejected with a clear message

1. As any staff member, on `/entry`, try to sell more of an item than its current `opening_stock + added_stock` supports (pick an item you know the total for from earlier testing, or check the "Opening" line first).
2. **Expect:** the save is rejected, ideally inline near the field, with wording to the effect of "more than the available stock" — not a raw 500, not a silently clamped value, not a success that later shows negative closing stock in the ledger.
3. Confirm in the ledger that no row was corrupted — the item's `closing_stock` for that period should still be a sane non-negative number reflecting only the sales that were actually accepted.

### 11.3 A delivery order and a till sale both touch the same item on the same day

This is the single most important correctness property in the whole app per the architecture doc (§3.4) — two independent writers, one stock figure, neither should clobber the other.

1. Note an item's current opening stock + added stock for restaurant, today (check `/entry` as Sarah).
2. As Sarah, log a till sale of, say, 3 units of that item via the stepper. Wait for it to autosave.
3. Immediately after (same day, same item), log a delivery order for 2 units of the same item via `/orders` — as Sarah or Mercy, doesn't matter which.
4. Go to `/dashboard/ledger` and check that item's row for today. **Expect:** `quantity_sold` = 5 (3 till + 2 order), not 3, not 2, not overwritten by whichever write landed last.
5. Now do it in the opposite order: log an order **first** for an item nobody has touched yet today (no `stock_entries` row exists), then log a till sale for the same item afterward. **Expect:** this still works correctly even though the order was the very first write of the day for that item (this is the specific case `apply_order_to_stock_entry()` exists to handle — an order can legitimately create the day's row before any till entry does).
6. For a true concurrency check (optional, harder to do by hand): if you're comfortable with two browser windows/devices, try to time a till save and an order submission for the same brand-new item at nearly the same moment. **Expect:** no crash, no false "oversell" rejection if the combined total is genuinely within stock, and the final `quantity_sold` still correctly sums both. This exact race was previously buggy (a false-rejection bug, since fixed with row-level locking) — if you ever see a legitimate combined sale get rejected as an oversell when it clearly shouldn't be, that's worth flagging immediately.

### 11.4 "Not yet stocked" / "not yet supplied" aren't confused with a genuine oversell

1. Restaurant: pick an item where **today's** `added_stock` is 0 (nobody's stocked it today) but it has some real leftover `opening_stock` from a prior day. Sell an amount **within** that opening stock. **Expect:** succeeds normally — no false rejection just because `added_stock` is 0 today.
2. Now try to sell **more** than that opening stock on the same zero-added-stock item. **Expect:** the distinct "ask the store manager to log today's added stock first" message (not the generic oversell message) — see §1.4.
3. Canteen: pick a `canteen_supplied` item the restaurant hasn't sent anything for this week yet, but which has leftover `opening_stock` from last week. Sell within that opening stock. **Expect:** succeeds. Sell beyond it. **Expect:** the distinct "restaurant hasn't sent this week's supply yet" message.
4. Confirm a genuine, unambiguous oversell (added_stock > 0 but still not enough) on any item still gets the plain generic oversell message, not either of the two specific ones above — the three messages should never be cross-wired.

### 11.5 A price change doesn't alter a past entry's recorded profit

1. Check `/dashboard/ledger` for an item with an existing sale from earlier in your testing (any day). Note its `sales_value`/`cost_value` for that row.
2. As WaPrecious, go to `/items` and change that item's `selling_price` and/or `buying_price` to something clearly different.
3. Return to `/dashboard/ledger` and re-check that **same historical row**. **Expect:** `selling_price_snapshot`/`buying_price_snapshot` and the derived `sales_value`/`cost_value` for that row are **unchanged** — the price edit must not have silently rewritten history.
4. Log a **new** sale for that item today (or this week) as staff. **Expect:** the **new** row uses the **new** price in its snapshot — confirming the change took effect going forward, just not retroactively.

### 11.6 Opening stock correctly carries forward, never re-typed

1. Pick an item and note its `closing_stock` for today (restaurant) after your testing — check the ledger.
2. You can't literally advance the system clock, but you can approximate this: as WaPrecious in the ledger, create/edit a row for that same item dated **tomorrow** (if the ledger edit UI allows picking an arbitrary date for a new row) and confirm its `opening_stock` auto-populates as **today's `closing_stock`**, without you typing it in.
3. If the ledger doesn't let you pick a future date freely, instead just confirm — for any item/location with 2+ consecutive real entries already in the ledger from your testing — that day 2's `opening_stock` exactly equals day 1's `closing_stock`. This is the same guarantee, verified retrospectively instead of prospectively.
4. Confirm visually on `/entry` (any staff account) that the "Opening: N" line is genuinely not tappable/editable — try tapping directly on it and confirm no input field appears.

### 11.7 RLS: staff truly cannot see the other location's data

1. Log in as Sarah (restaurant). On `/dashboard` — she shouldn't have access to `/dashboard` at all as staff; confirm navigating directly to `http://localhost:3000/dashboard` while logged in as Sarah either redirects her away or shows a 403/not-found, not the admin dashboard.
2. Log in as Anne (canteen). Confirm `/store` and `/ingredients`-equivalent views are not reachable/visible to her (ingredients are restaurant-only).
3. This is a UI-gating spot-check, not a substitute for real RLS verification — if you want the DB-level guarantee actually re-confirmed (not just "the UI hid the button"), that needs a `curl`/direct-SQL check, which I can run for you separately per `CLAUDE.md`'s verification rule; just ask.

---

## Wrap-up

Once you're through this, the main things worth reporting back to me:
- Any step whose actual result didn't match "Expect" above.
- Anything that looked like the doc-drift items at the top turned out to be **wrong** (e.g., if you do find a wastage field on `/store`, or `/summary` does load) — that would mean my read of current repo state was off and needs correcting.
- Any screen/flow that felt confusing or slow even if technically "correct," since that's real product signal Excel-replacement software needs, not just a pass/fail.
