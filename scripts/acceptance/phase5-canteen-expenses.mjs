#!/usr/bin/env node
/**
 * Phase 5 acceptance checks — Canteen Weekly Entry & Expenses
 * (docs/phases/phase5_context.md's gating-checklist RLS section (a)-(j),
 * reconstructed here as a real repeatable script instead of only living
 * as prose in that context file).
 *
 * Covers: canteen_supplied_total() cross-location aggregation matching a
 * real sum of backdated restaurant sent_out rows, server ignoring a
 * bogus client-sent added_stock for canteen_supplied items, same-week
 * re-save, oversell, a week crossing a month boundary, cross-location
 * RLS (canteen can't read restaurant stock_entries directly even though
 * the aggregate function works), opening-stock week-to-week
 * carry-forward, cross-location expense scoping, and the INSERT-policy
 * date-scoping fix (a future-dated write is rejected).
 *
 * Prerequisites: local Supabase stack running (`npx supabase status`)
 * and the dev server running (`pnpm dev`). Mutates real local data but
 * cleans up everything it creates before exiting — safe to re-run anytime.
 *
 * Usage: node scripts/acceptance/phase5-canteen-expenses.mjs
 */

import { api, check, findItemByName, login, psql, psqlAsUser, summarizeAndExit } from "./_lib.mjs";

// lib/calculations.ts's weekStartMonday/weekEndSunday are TypeScript —
// Node can't import .ts directly without a loader, so this script
// reimplements the same tiny UTC-getter convention inline rather than
// adding a build step just for a test script. Mirrors lib/calculations.ts
// exactly; if that file's convention ever changes, update here too.
function weekStartMondayJs(date) {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  utc.setUTCDate(utc.getUTCDate() + diffToMonday);
  return utc.toISOString().slice(0, 10);
}
function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const todayISO = new Date().toISOString().slice(0, 10);
const thisWeekMonday = weekStartMondayJs(new Date());
const day1 = thisWeekMonday; // Monday
const day2 = addDays(thisWeekMonday, 1); // Tuesday
const day3 = addDays(thisWeekMonday, 2); // Wednesday

async function cleanup() {
  psql(`delete from expenses where note = '[acceptance-test]';`);
  psql(`delete from stock_entries where location = 'restaurant' and entry_date in ('${day1}', '${day2}', '${day3}');`);
  psql(`delete from stock_entries where location = 'canteen' and entry_date = '${thisWeekMonday}';`);
  psql(`delete from stock_entries where location = 'canteen' and entry_date = '${addDays(thisWeekMonday, -7)}';`);
  // any stray future-week canteen row from the INSERT-policy test
  psql(`delete from stock_entries where location = 'canteen' and entry_date > '${thisWeekMonday}' and entry_date <= (date '${thisWeekMonday}' + interval '60 days')::date;`);
}

async function main() {
  await cleanup();

  const anneCookie = await login("anne"); // canteen
  const sarahCookie = await login("sarah"); // restaurant

  // ---------------------------------------------------------------
  // TEST 1: canteen_supplied_total() matches a real sum of backdated
  // restaurant sent_out rows across the week (15+10+12=37, same fixture
  // shape phase5_context.md documented).
  // ---------------------------------------------------------------
  console.log("\n=== TEST 1: canteen_supplied_total() cross-location aggregation ===");
  const canteenEntries0 = await api(anneCookie, "GET", `/api/stock-entries?date=${todayISO}`);
  check("Anne's GET succeeds", canteenEntries0.status === 200, canteenEntries0);
  const suppliedItem = canteenEntries0.body.items.find((i) => i.supply_type === "canteen_supplied");
  if (!suppliedItem) throw new Error("No canteen_supplied item in seed data");

  // Manufacture 3 backdated restaurant sent_out rows via direct SQL (the
  // app's own date-scoped INSERT policy would reject a client POST for
  // a past date) — the documented pattern from this same phase.
  const restaurantPrices = await api(sarahCookie, "GET", `/api/stock-entries?date=${todayISO}`);
  const suppliedAtRestaurant = findItemByName(restaurantPrices.body.items, suppliedItem.name);
  for (const [date, sentOut] of [[day1, 15], [day2, 10], [day3, 12]]) {
    psql(`
      insert into stock_entries (item_id, location, entry_date, opening_stock, added_stock, sent_out, till_quantity_sold, quantity_sold, wastage, selling_price_snapshot, buying_price_snapshot, closing_stock, sales_value, cost_value, closing_stock_value, wastage_value, created_by)
      values ('${suppliedAtRestaurant.id}', 'restaurant', '${date}', 0, ${sentOut}, ${sentOut}, 0, 0, 0, ${suppliedAtRestaurant.selling_price}, ${suppliedAtRestaurant.buying_price}, 0, 0, 0, 0, 0, (select id from users where name='Sarah Makena'))
      on conflict (item_id, location, entry_date) do update set sent_out = excluded.sent_out, added_stock = excluded.added_stock;
    `);
  }

  const canteenEntries1 = await api(anneCookie, "GET", `/api/stock-entries?date=${todayISO}`);
  const suppliedTotal = canteenEntries1.body.supplied_totals?.[suppliedItem.id];
  check(
    `canteen_supplied_total for the week = 15+10+12 = 37 (got ${suppliedTotal})`,
    suppliedTotal === 37,
    canteenEntries1.body.supplied_totals,
  );

  // ---------------------------------------------------------------
  // TEST 2: server ignores a bogus client-sent added_stock for a
  // canteen_supplied item — uses the real aggregate (37) instead.
  // ---------------------------------------------------------------
  console.log("\n=== TEST 2: server never trusts client-sent added_stock for canteen_supplied ===");
  // Only saves suppliedItem's own line -- NOT a full-catalog batch save
  // like the real screen does -- so this test doesn't incidentally
  // create a same-week row for every OTHER item too (which would then
  // corrupt TEST 7's opening-stock carry-forward check for a different
  // item, since opening_stock is only ever derived on an item's first
  // INSERT for a period, never recomputed on a later UPDATE).
  const saveRes = await api(anneCookie, "POST", "/api/stock-entries", {
    entry_date: todayISO,
    lines: [{ item_id: suppliedItem.id, till_quantity_sold: 0, added_stock: 999, wastage: 0, wastage_note: null }],
  });
  check("Canteen save succeeds", saveRes.status === 200, saveRes);
  const savedSupplied = (saveRes.body.entries ?? []).find((e) => e.item_id === suppliedItem.id);
  check(
    "Saved added_stock is the real aggregate (37), NOT the client's bogus 999",
    savedSupplied?.added_stock === 37,
    savedSupplied,
  );
  check("closing_stock = 0 (opening) + 37 (added) - 0 (sold) - 0 (wastage) = 37", savedSupplied?.closing_stock === 37, savedSupplied);

  // ---------------------------------------------------------------
  // TEST 3: oversell rejected
  // ---------------------------------------------------------------
  console.log("\n=== TEST 3: Canteen oversell rejected ===");
  const oversellRes = await api(anneCookie, "POST", "/api/stock-entries", {
    entry_date: todayISO,
    lines: [{ item_id: suppliedItem.id, till_quantity_sold: 100, added_stock: 0, wastage: 0, wastage_note: null }],
  });
  check("Oversell (100 of 37 available) rejected with 409", oversellRes.status === 409, oversellRes);

  // ---------------------------------------------------------------
  // TEST 4: Same-week re-save (correcting a stepper tap)
  // ---------------------------------------------------------------
  console.log("\n=== TEST 4: Same-week re-save ===");
  const resaveRes = await api(anneCookie, "POST", "/api/stock-entries", {
    entry_date: todayISO,
    lines: [{ item_id: suppliedItem.id, till_quantity_sold: 5, added_stock: 0, wastage: 0, wastage_note: null }],
  });
  check("Re-saving the same week's entry succeeds (200, not 403)", resaveRes.status === 200, resaveRes);

  // ---------------------------------------------------------------
  // TEST 5: A week crossing a month boundary resolves correctly
  // ---------------------------------------------------------------
  console.log("\n=== TEST 5: Week-boundary month-crossing resolution ===");
  const crossMonthReq = await api(anneCookie, "GET", "/api/stock-entries?date=2026-07-30");
  check(
    "2026-07-30 (Thursday) resolves to Monday 2026-07-27",
    crossMonthReq.body.entry_date === "2026-07-27",
    crossMonthReq.body.entry_date,
  );
  check(
    "That week's end (week_end) is Sunday 2026-08-02",
    crossMonthReq.body.week_end === "2026-08-02",
    crossMonthReq.body.week_end,
  );

  // ---------------------------------------------------------------
  // TEST 6: Cross-location RLS — canteen cannot read restaurant
  // stock_entries directly, even though the aggregate function works
  // ---------------------------------------------------------------
  console.log("\n=== TEST 6: Cross-location RLS (aggregate works, direct read doesn't) ===");
  const anneDirectRestaurantRows = psqlAsUser(
    "Anne Gitonga",
    `select count(*) from stock_entries where location = 'restaurant';`,
  );
  check(
    "RLS-impersonated as Anne: direct query for restaurant stock_entries returns 0 rows",
    anneDirectRestaurantRows === "0",
    anneDirectRestaurantRows,
  );

  // ---------------------------------------------------------------
  // TEST 7: Opening-stock week-to-week carry-forward
  //
  // Can't test this by writing to a future week through the app --
  // that's exactly what the INSERT-policy date-scoping (TEST 9) is
  // supposed to block. Instead, manufacture a PRIOR week's closing_stock
  // via direct SQL (same fixture pattern as TEST 1's backdated sent_out
  // rows), then let the app save THIS week normally through its real
  // write path and confirm opening_stock picks up last week's number.
  // Uses a canteen_independent item (own manual added_stock, no
  // aggregate involved) to keep this test isolated from TEST 1/2's
  // canteen_supplied fixture.
  // ---------------------------------------------------------------
  console.log("\n=== TEST 7: Opening-stock week-to-week carry-forward ===");
  const independentItem = canteenEntries0.body.items.find((i) => i.supply_type === "canteen_independent");
  const priorWeekMonday = addDays(thisWeekMonday, -7);
  psql(`
    insert into stock_entries (item_id, location, entry_date, opening_stock, added_stock, sent_out, till_quantity_sold, quantity_sold, wastage, selling_price_snapshot, buying_price_snapshot, closing_stock, sales_value, cost_value, closing_stock_value, wastage_value, created_by)
    values ('${independentItem.id}', 'canteen', '${priorWeekMonday}', 0, 30, 0, 4, 4, 0, ${independentItem.selling_price}, ${independentItem.buying_price}, 26, ${4 * independentItem.selling_price}, ${4 * independentItem.buying_price}, ${26 * independentItem.buying_price}, 0, (select id from users where name='Anne Gitonga'))
    on conflict (item_id, location, entry_date) do update set closing_stock = excluded.closing_stock;
  `);
  const thisWeekIndependentSave = await api(anneCookie, "POST", "/api/stock-entries", {
    entry_date: todayISO,
    lines: [{ item_id: independentItem.id, till_quantity_sold: 0, added_stock: 0, wastage: 0, wastage_note: null }],
  });
  const savedIndependent = (thisWeekIndependentSave.body.entries ?? []).find((e) => e.item_id === independentItem.id);
  check(
    "This week's opening_stock equals last week's saved closing_stock (26)",
    savedIndependent?.opening_stock === 26,
    savedIndependent,
  );

  // ---------------------------------------------------------------
  // TEST 8: Cross-location expense scoping
  // ---------------------------------------------------------------
  console.log("\n=== TEST 8: Cross-location expense scoping ===");
  const sarahExpenseRes = await api(sarahCookie, "POST", "/api/expenses", {
    category: "electricity",
    amount: 500,
    note: "[acceptance-test]",
  });
  check("Sarah (restaurant) can log an expense", sarahExpenseRes.status === 200, sarahExpenseRes);
  check("Sarah's expense is attributed to restaurant", sarahExpenseRes.body?.expense?.location === "restaurant", sarahExpenseRes.body);

  const anneExpenseRes = await api(anneCookie, "POST", "/api/expenses", {
    category: "charcoal",
    amount: 300,
    note: "[acceptance-test]",
    location: "restaurant", // crafted cross-location injection attempt
  });
  check(
    "Anne's crafted 'location: restaurant' body is silently ignored — saved as canteen",
    anneExpenseRes.body?.expense?.location === "canteen",
    anneExpenseRes.body,
  );

  const sarahExpenseList = await api(sarahCookie, "GET", `/api/expenses?date=${todayISO}`);
  const sarahSeesAnnesExpense = (sarahExpenseList.body.expenses ?? []).some((e) => e.note === "[acceptance-test]" && e.category === "charcoal");
  check("Sarah's expense list does not include Anne's canteen expense", !sarahSeesAnnesExpense, sarahExpenseList.body.expenses);

  // ---------------------------------------------------------------
  // TEST 9: INSERT-policy date-scoping — a future-dated write is rejected
  // ---------------------------------------------------------------
  console.log("\n=== TEST 9: Future-dated canteen write rejected ===");
  const futureMonday = addDays(thisWeekMonday, 28); // 4 weeks out
  const futureRes = await api(anneCookie, "POST", "/api/stock-entries", {
    entry_date: futureMonday,
    lines: [{ item_id: suppliedItem.id, till_quantity_sold: 0, added_stock: 0, wastage: 0, wastage_note: null }],
  });
  check("A manufactured future-week POST is rejected (403), not 200", futureRes.status === 403, futureRes);

  await cleanup();
  summarizeAndExit("Phase 5");
}

main().catch((err) => {
  console.error("Test harness crashed:", err);
  process.exit(1);
});
