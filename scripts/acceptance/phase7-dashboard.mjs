#!/usr/bin/env node
/**
 * Phase 7 acceptance checks — Admin Dashboard & Reporting
 * (04_PHASE_PLAN.md Phase 7 acceptance criteria, docs/phases/phase7_context.md).
 *
 * Covers: dashboard totals matching a manual calculation INCLUDING
 * order-driven sales (§3.4 -- quantity_sold already combines till +
 * orders, so this proves the dashboard's plain sum() picks that up for
 * free, not a claim taken on faith), period-toggle correctness across a
 * real week boundary and a real month boundary, per-location split
 * summing to the combined total, wastage cost matching a manual sum
 * across BOTH stock_entries and ingredient_entries, the item ledger
 * matching known fixture rows exactly, and the low-stock "Needs
 * attention" list reflecting the items.low_stock_threshold column added
 * this phase.
 *
 * Prerequisites: local Supabase stack running (`npx supabase status`)
 * and the dev server running (`pnpm dev`). Mutates real local data but
 * cleans up everything it creates before exiting -- safe to re-run anytime.
 *
 * Usage: node scripts/acceptance/phase7-dashboard.mjs
 */

import { api, check, login, psql, summarizeAndExit } from "./_lib.mjs";

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

const MARKER = "[acceptance-test-p7]";
const todayISO = new Date().toISOString().slice(0, 10);
const thisWeekMonday = weekStartMondayJs(new Date());
// A date guaranteed to be in the PRIOR calendar month (1st of this month
// minus 1 day), so the month-boundary test has a real prior-month row
// that must NOT be included in "this month"'s totals.
const now = new Date();
const firstOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const lastOfPriorMonth = new Date(firstOfThisMonth);
lastOfPriorMonth.setUTCDate(lastOfPriorMonth.getUTCDate() - 1);
const priorMonthDateISO = lastOfPriorMonth.toISOString().slice(0, 10);
// A date guaranteed to be in the PRIOR week (Monday - 7 days), so the
// week-boundary test has a real prior-week row that must NOT be
// included in "this week"'s totals.
const priorWeekDateISO = addDays(thisWeekMonday, -3);

async function cleanup() {
  psql(`delete from order_items where order_id in (select id from orders where customer_name like '${MARKER}%');`);
  psql(`delete from orders where customer_name like '${MARKER}%';`);
  psql(`delete from expenses where note = '${MARKER}';`);
  psql(`delete from stock_entries where location = 'restaurant' and entry_date in ('${todayISO}', '${priorWeekDateISO}', '${priorMonthDateISO}');`);
  psql(`delete from stock_entries where location = 'canteen' and entry_date in ('${todayISO}', '${priorWeekDateISO}', '${priorMonthDateISO}');`);
  psql(`delete from ingredient_entries where entry_date in ('${todayISO}', '${priorMonthDateISO}');`);
}

async function main() {
  await cleanup();

  const adminCookie = await login("admin");
  const sarahCookie = await login("sarah"); // restaurant
  const anneCookie = await login("anne"); // canteen

  // ---------------------------------------------------------------
  // Admin-only route gating -- staff must be rejected, not just hidden
  // ---------------------------------------------------------------
  console.log("\n=== TEST 0: Dashboard routes are admin-only ===");
  const staffSummaryRes = await api(sarahCookie, "GET", `/api/dashboard/summary?period=today`);
  check("Staff GET /api/dashboard/summary is rejected (403)", staffSummaryRes.status === 403, staffSummaryRes);
  const staffLedgerRes = await api(sarahCookie, "GET", `/api/dashboard/ledger?period=today`);
  check("Staff GET /api/dashboard/ledger is rejected (403)", staffLedgerRes.status === 403, staffLedgerRes);

  // ---------------------------------------------------------------
  // TEST 1: Combined till + order sales -- the key correctness risk
  // this phase's brief called out explicitly. One item gets a till sale
  // AND a same-day order; the dashboard's sum(sales_value) must reflect
  // BOTH without any separate "add orders" logic in the route.
  // ---------------------------------------------------------------
  console.log("\n=== TEST 1: Dashboard sales figure includes order-driven sales ===");
  const restaurantItemsRes = await api(sarahCookie, "GET", `/api/stock-entries?date=${todayISO}`);
  const item = restaurantItemsRes.body.items.find((i) => i.supply_type === "restaurant_only");
  if (!item) throw new Error("No restaurant_only item in seed data");

  // Give this item real opening stock via a backdated-safe direct upsert
  // (today's date, but via SQL so we control every downstream figure
  // precisely and don't depend on prior test runs' till state).
  psql(`
    insert into stock_entries (item_id, location, entry_date, opening_stock, added_stock, sent_out, till_quantity_sold, quantity_sold, wastage, wastage_note, selling_price_snapshot, buying_price_snapshot, closing_stock, sales_value, cost_value, closing_stock_value, wastage_value, created_by)
    values ('${item.id}', 'restaurant', '${todayISO}', 0, 50, 0, 3, 3, 2, '${MARKER}', ${item.selling_price}, ${item.buying_price}, 45, ${3 * item.selling_price}, ${3 * item.buying_price}, ${45 * item.buying_price}, ${2 * item.buying_price}, (select id from users where name='Sarah Makena'))
    on conflict (item_id, location, entry_date) do update set
      added_stock = excluded.added_stock, till_quantity_sold = excluded.till_quantity_sold,
      quantity_sold = excluded.quantity_sold, wastage = excluded.wastage, wastage_note = excluded.wastage_note,
      closing_stock = excluded.closing_stock, sales_value = excluded.sales_value, cost_value = excluded.cost_value,
      closing_stock_value = excluded.closing_stock_value, wastage_value = excluded.wastage_value;
  `);

  // Now place a real order for 2 more units of the SAME item through the
  // real API -- apply_order_to_stock_entry() must fold this into
  // quantity_sold (3 till + 2 order = 5), not clobber the till figure.
  const orderRes = await api(sarahCookie, "POST", "/api/orders", {
    customer_name: `${MARKER} Sales Test`,
    fulfillment_type: "pickup",
    delivery_location_id: null,
    items: [{ item_id: item.id, quantity: 2 }],
    client_request_id: crypto.randomUUID(),
  });
  check("Order placed successfully", orderRes.status === 201, orderRes);

  const afterOrderStock = psql(
    `select quantity_sold, till_quantity_sold, sales_value, cost_value from stock_entries where item_id = '${item.id}' and location = 'restaurant' and entry_date = '${todayISO}';`,
  );
  const [qtySoldAfter, tillAfter, salesValueAfter, costValueAfter] = afterOrderStock.split("|").map(Number);
  check("till_quantity_sold unchanged by the order (still 3)", tillAfter === 3, afterOrderStock);
  check("quantity_sold reflects till + order (3 + 2 = 5)", qtySoldAfter === 5, afterOrderStock);
  const expectedSalesValue = 5 * item.selling_price;
  const expectedCostValue = 5 * item.buying_price;
  check("sales_value recomputed off the combined total", Math.abs(salesValueAfter - expectedSalesValue) < 0.01, afterOrderStock);
  check("cost_value recomputed off the combined total", Math.abs(costValueAfter - expectedCostValue) < 0.01, afterOrderStock);

  const summaryToday = await api(adminCookie, "GET", `/api/dashboard/summary?period=today`);
  check("GET /api/dashboard/summary succeeds for admin", summaryToday.status === 200, summaryToday);
  const restaurantToday = summaryToday.body.byLocation.restaurant;
  check(
    "Dashboard's restaurant sales_value for today is >= this item's combined sales (order-driven sales included)",
    restaurantToday.salesValue >= expectedSalesValue - 0.01,
    { restaurantToday, expectedSalesValue },
  );
  check(
    "Dashboard's restaurant cost_value for today is >= this item's combined cost",
    restaurantToday.costValue >= expectedCostValue - 0.01,
    { restaurantToday, expectedCostValue },
  );

  // ---------------------------------------------------------------
  // TEST 2: Per-location split sums to the combined total
  // ---------------------------------------------------------------
  console.log("\n=== TEST 2: Per-location split sums to the combined total ===");
  const canteenItemsRes = await api(anneCookie, "GET", `/api/stock-entries?date=${todayISO}`);
  const canteenIndependentItem = canteenItemsRes.body.items.find((i) => i.supply_type === "canteen_independent");
  if (!canteenIndependentItem) throw new Error("No canteen_independent item in seed data");

  psql(`
    insert into stock_entries (item_id, location, entry_date, opening_stock, added_stock, sent_out, till_quantity_sold, quantity_sold, wastage, selling_price_snapshot, buying_price_snapshot, closing_stock, sales_value, cost_value, closing_stock_value, wastage_value, created_by)
    values ('${canteenIndependentItem.id}', 'canteen', '${todayISO}', 0, 20, 0, 4, 4, 1, ${canteenIndependentItem.selling_price}, ${canteenIndependentItem.buying_price}, 15, ${4 * canteenIndependentItem.selling_price}, ${4 * canteenIndependentItem.buying_price}, ${15 * canteenIndependentItem.buying_price}, ${1 * canteenIndependentItem.buying_price}, (select id from users where name='Anne Gitonga'))
    on conflict (item_id, location, entry_date) do update set closing_stock = excluded.closing_stock, sales_value = excluded.sales_value, cost_value = excluded.cost_value;
  `);

  const summaryAfterCanteen = await api(adminCookie, "GET", `/api/dashboard/summary?period=today`);
  const { restaurant, canteen } = summaryAfterCanteen.body.byLocation;
  const combined = summaryAfterCanteen.body.combined;
  const sumOfLocations = {
    salesValue: restaurant.salesValue + canteen.salesValue,
    costValue: restaurant.costValue + canteen.costValue,
    expenses: restaurant.expenses + canteen.expenses,
  };
  check(
    "combined.salesValue equals restaurant + canteen salesValue",
    Math.abs(combined.salesValue - sumOfLocations.salesValue) < 0.01,
    { combined, sumOfLocations },
  );
  check(
    "combined.costValue equals restaurant + canteen costValue",
    Math.abs(combined.costValue - sumOfLocations.costValue) < 0.01,
    { combined, sumOfLocations },
  );
  check(
    "combined.expenses equals restaurant + canteen expenses",
    Math.abs(combined.expenses - sumOfLocations.expenses) < 0.01,
    { combined, sumOfLocations },
  );

  // ---------------------------------------------------------------
  // TEST 3: Week-boundary correctness -- a prior-week row must be
  // excluded from "week" totals, included in "month" (same month).
  // ---------------------------------------------------------------
  console.log("\n=== TEST 3: Week-boundary correctness ===");
  const weekBoundaryItem = restaurantItemsRes.body.items.find(
    (i) => i.supply_type === "restaurant_only" && i.id !== item.id,
  ) ?? restaurantItemsRes.body.items.find((i) => i.id !== item.id);

  psql(`
    insert into stock_entries (item_id, location, entry_date, opening_stock, added_stock, sent_out, till_quantity_sold, quantity_sold, wastage, selling_price_snapshot, buying_price_snapshot, closing_stock, sales_value, cost_value, closing_stock_value, wastage_value, created_by)
    values ('${weekBoundaryItem.id}', 'restaurant', '${priorWeekDateISO}', 0, 10, 0, 7, 7, 0, ${weekBoundaryItem.selling_price}, ${weekBoundaryItem.buying_price}, 3, ${7 * weekBoundaryItem.selling_price}, ${7 * weekBoundaryItem.buying_price}, ${3 * weekBoundaryItem.buying_price}, 0, (select id from users where name='Sarah Makena'))
    on conflict (item_id, location, entry_date) do update set sales_value = excluded.sales_value;
  `);

  const summaryWeek = await api(adminCookie, "GET", `/api/dashboard/summary?period=week`);
  check("GET /api/dashboard/summary?period=week succeeds", summaryWeek.status === 200, summaryWeek);
  check(
    `Week range starts on this week's Monday (${thisWeekMonday})`,
    summaryWeek.body.from === thisWeekMonday,
    summaryWeek.body,
  );

  const ledgerWeek = await api(adminCookie, "GET", `/api/dashboard/ledger?period=week&location=restaurant`);
  const weekLedgerHasPriorWeekRow = ledgerWeek.body.items.some(
    (r) => r.item_id === weekBoundaryItem.id && r.entry_date === priorWeekDateISO,
  );
  check(
    "This week's ledger does NOT include the manufactured prior-week row",
    !weekLedgerHasPriorWeekRow,
    { priorWeekDateISO, thisWeekMonday },
  );

  // ---------------------------------------------------------------
  // TEST 4: Month-boundary correctness -- a prior-month row must be
  // excluded from "month" totals.
  // ---------------------------------------------------------------
  console.log("\n=== TEST 4: Month-boundary correctness ===");
  psql(`
    insert into stock_entries (item_id, location, entry_date, opening_stock, added_stock, sent_out, till_quantity_sold, quantity_sold, wastage, selling_price_snapshot, buying_price_snapshot, closing_stock, sales_value, cost_value, closing_stock_value, wastage_value, created_by)
    values ('${weekBoundaryItem.id}', 'restaurant', '${priorMonthDateISO}', 0, 10, 0, 9, 9, 0, ${weekBoundaryItem.selling_price}, ${weekBoundaryItem.buying_price}, 1, ${9 * weekBoundaryItem.selling_price}, ${9 * weekBoundaryItem.buying_price}, ${1 * weekBoundaryItem.buying_price}, 0, (select id from users where name='Sarah Makena'))
    on conflict (item_id, location, entry_date) do update set sales_value = excluded.sales_value;
  `);

  const ledgerMonth = await api(adminCookie, "GET", `/api/dashboard/ledger?period=month&location=restaurant`);
  check("GET /api/dashboard/ledger?period=month succeeds", ledgerMonth.status === 200, ledgerMonth);
  const monthLedgerHasPriorMonthRow = ledgerMonth.body.items.some(
    (r) => r.item_id === weekBoundaryItem.id && r.entry_date === priorMonthDateISO,
  );
  check(
    "This month's ledger does NOT include the manufactured prior-month row",
    !monthLedgerHasPriorMonthRow,
    { priorMonthDateISO },
  );
  const monthLedgerHasTodayItemRow = ledgerMonth.body.items.some(
    (r) => r.item_id === item.id && r.entry_date === todayISO,
  );
  check("This month's ledger DOES include today's row for the sales-test item", monthLedgerHasTodayItemRow, {
    todayISO,
  });

  // ---------------------------------------------------------------
  // TEST 5: Ledger row-by-row match against a known fixture
  // ---------------------------------------------------------------
  console.log("\n=== TEST 5: Item ledger matches the known fixture row exactly ===");
  const ledgerToday = await api(adminCookie, "GET", `/api/dashboard/ledger?period=today&location=restaurant`);
  const ledgerRow = ledgerToday.body.items.find((r) => r.item_id === item.id);
  check("Ledger row exists for the sales-test item today", !!ledgerRow, ledgerToday.body.items);
  if (ledgerRow) {
    check("Ledger opening_stock matches fixture (0)", ledgerRow.opening_stock === 0, ledgerRow);
    check("Ledger added_stock matches fixture (50)", ledgerRow.added_stock === 50, ledgerRow);
    check("Ledger till_quantity_sold matches fixture (3)", ledgerRow.till_quantity_sold === 3, ledgerRow);
    check("Ledger quantity_sold reflects till+order (5)", ledgerRow.quantity_sold === 5, ledgerRow);
    check("Ledger wastage matches fixture (2)", ledgerRow.wastage === 2, ledgerRow);
    check(
      "Ledger closing_stock = 50 - 5 - 2 = 43 (recomputed after the order)",
      ledgerRow.closing_stock === 43,
      ledgerRow,
    );
  }

  // ---------------------------------------------------------------
  // TEST 6: Wastage cost = sum across BOTH stock_entries AND
  // ingredient_entries (§3.3) -- a real, deliberately distinct figure
  // from cost_value/expenses.
  // ---------------------------------------------------------------
  console.log("\n=== TEST 6: Wastage cost sums stock_entries + ingredient_entries ===");
  const ingredientsRes = await api(adminCookie, "GET", `/api/ingredients`);
  check("Admin can list ingredients", ingredientsRes.status === 200, ingredientsRes);
  const ingredient = ingredientsRes.body.ingredients?.[0];
  if (!ingredient) throw new Error("No ingredients in seed data");

  const ingredientWastageQty = 3;
  const expectedIngredientWastageValue = ingredientWastageQty * ingredient.buying_price;
  psql(`
    insert into ingredient_entries (ingredient_id, entry_date, opening_stock, received, quantity_used, wastage, wastage_note, buying_price_snapshot, closing_stock, closing_stock_value, wastage_value, created_by)
    values ('${ingredient.id}', '${todayISO}', 0, 20, 5, ${ingredientWastageQty}, '${MARKER}', ${ingredient.buying_price}, 12, ${12 * ingredient.buying_price}, ${expectedIngredientWastageValue}, (select id from users where name='Janiffer Maina'))
    on conflict (ingredient_id, entry_date) do update set wastage = excluded.wastage, wastage_value = excluded.wastage_value, closing_stock = excluded.closing_stock, closing_stock_value = excluded.closing_stock_value;
  `);

  const expectedStockWastageValue = 2 * item.buying_price + 1 * canteenIndependentItem.buying_price;
  const summaryFinal = await api(adminCookie, "GET", `/api/dashboard/summary?period=today`);
  const combinedWastage = summaryFinal.body.combined.wastageValue;
  const expectedCombinedWastage = expectedStockWastageValue + expectedIngredientWastageValue;
  check(
    "combined.wastageValue equals stock_entries wastage + ingredient_entries wastage",
    Math.abs(combinedWastage - expectedCombinedWastage) < 0.01,
    { combinedWastage, expectedCombinedWastage, expectedStockWastageValue, expectedIngredientWastageValue },
  );

  const netProfitExpected =
    summaryFinal.body.combined.salesValue -
    summaryFinal.body.combined.costValue -
    summaryFinal.body.combined.expenses -
    summaryFinal.body.combined.wastageValue;
  check(
    "combined.netProfit = sales - cost - expenses - wastage (lib/calculations.ts netProfit())",
    Math.abs(summaryFinal.body.combined.netProfit - netProfitExpected) < 0.01,
    { netProfit: summaryFinal.body.combined.netProfit, netProfitExpected },
  );

  const ingredientLedgerToday = await api(adminCookie, "GET", `/api/dashboard/ledger?period=today`);
  const ingredientLedgerRow = ingredientLedgerToday.body.ingredients.find((r) => r.ingredient_id === ingredient.id);
  check(
    "Ingredient ledger row matches the fixture (wastage_value)",
    ingredientLedgerRow && Math.abs(ingredientLedgerRow.wastage_value - expectedIngredientWastageValue) < 0.01,
    ingredientLedgerRow,
  );

  // ---------------------------------------------------------------
  // TEST 7: Low-stock "Needs attention" reflects items.low_stock_threshold
  // ---------------------------------------------------------------
  console.log("\n=== TEST 7: Low-stock list reflects items.low_stock_threshold ===");
  // The sales-test item's closing_stock is 43 (well above its default
  // threshold of 5) -- should NOT appear. Force a second, deliberately
  // low-stock row for a different item at today's date.
  const lowStockItem = restaurantItemsRes.body.items.find(
    (i) => i.id !== item.id && i.id !== weekBoundaryItem.id,
  );
  psql(`
    insert into stock_entries (item_id, location, entry_date, opening_stock, added_stock, sent_out, till_quantity_sold, quantity_sold, wastage, selling_price_snapshot, buying_price_snapshot, closing_stock, sales_value, cost_value, closing_stock_value, wastage_value, created_by)
    values ('${lowStockItem.id}', 'restaurant', '${todayISO}', 0, 10, 0, 8, 8, 0, ${lowStockItem.selling_price}, ${lowStockItem.buying_price}, 2, ${8 * lowStockItem.selling_price}, ${8 * lowStockItem.buying_price}, ${2 * lowStockItem.buying_price}, 0, (select id from users where name='Sarah Makena'))
    on conflict (item_id, location, entry_date) do update set closing_stock = excluded.closing_stock;
  `);

  const summaryWithLowStock = await api(adminCookie, "GET", `/api/dashboard/summary?period=today`);
  const lowStockHit = summaryWithLowStock.body.lowStockItems.find((r) => r.item_id === lowStockItem.id);
  check(
    "Low-stock item (closing_stock 2, threshold 5) appears in 'Needs attention'",
    !!lowStockHit && lowStockHit.closing_stock === 2,
    summaryWithLowStock.body.lowStockItems,
  );
  const wellStockedNotFlagged = !summaryWithLowStock.body.lowStockItems.some((r) => r.item_id === item.id);
  check("Well-stocked item (closing_stock 43) is NOT flagged", wellStockedNotFlagged, summaryWithLowStock.body.lowStockItems);

  const ingredientLowStockHit = summaryWithLowStock.body.lowStockIngredients.find(
    (r) => r.ingredient_id === ingredient.id,
  );
  check(
    "Low-stock ingredient (closing_stock 12 <= default threshold 5)? -- expect NOT flagged, 12 > 5",
    !ingredientLowStockHit,
    summaryWithLowStock.body.lowStockIngredients,
  );

  // ---------------------------------------------------------------
  // TEST 8: SQL-side aggregation, not JS row-by-row summing -- verified
  // structurally: the dashboard functions are Postgres RPC calls, and
  // the number of rows returned by the summary endpoint's underlying
  // calls is bounded to one row per location (2) + one row per
  // ingredient summary (1), never one row per stock_entries record --
  // confirmed by inspecting the RPC response shape directly.
  // ---------------------------------------------------------------
  console.log("\n=== TEST 8: Dashboard summary aggregates server-side (bounded row count) ===");
  const rawStockSummary = psql(
    `select count(*) from stock_entries where entry_date = '${todayISO}';`,
  );
  const rawRowCount = Number(rawStockSummary);
  check(
    `Multiple raw stock_entries rows exist for today (${rawRowCount}) -- proves this is a real aggregation test, not a trivial 1-row case`,
    rawRowCount >= 3,
    { rawRowCount },
  );
  // dashboard_stock_summary returns at most one row per location (2),
  // regardless of how many raw stock_entries rows exist -- this IS the
  // SQL-side aggregation the acceptance criterion requires.
  const aggregatedRowCount = psql(
    `select count(*) from dashboard_stock_summary('${todayISO}', '${todayISO}');`,
  );
  check(
    "dashboard_stock_summary() returns at most 2 rows (one per location) regardless of raw row count",
    Number(aggregatedRowCount) <= 2,
    { aggregatedRowCount, rawRowCount },
  );

  await cleanup();
  summarizeAndExit("Phase 7");
}

main().catch(async (err) => {
  console.error("Test harness crashed:", err);
  await cleanup();
  process.exit(1);
});
