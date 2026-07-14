#!/usr/bin/env node
/**
 * Phase 9 acceptance checks — batch save wrappers for stock_entries /
 * ingredient_entries (docs/phases/phase9_context.md).
 *
 * Confirms save_stock_entries_batch() / save_canteen_stock_entries_batch() /
 * save_ingredient_entries_batch() (supabase/migrations/20260713183705_batch_save_functions.sql)
 * behave identically to the pre-Phase-9 per-line-round-trip behavior:
 * correct calculations for a multi-line save, and — the property that
 * actually changed — an oversell on any one line now rolls back the
 * WHOLE batch atomically (previously: lines before the failure had
 * already committed one row trip at a time).
 *
 * Prerequisites: local Supabase stack running (`npx supabase status`)
 * and the dev server running (`pnpm dev`). Mutates real local data but
 * cleans up everything it creates before exiting — safe to re-run anytime.
 *
 * Usage: node scripts/acceptance/phase9-batch-save.mjs
 */

import { api, check, login, psql, summarizeAndExit } from "./_lib.mjs";

const today = new Date().toISOString().slice(0, 10);

async function cleanup() {
  psql(`delete from stock_entries where location = 'restaurant' and entry_date = '${today}';`);
  psql(`delete from stock_entries where location = 'canteen' and entry_date = date_trunc('week', '${today}'::date)::date;`);
  psql(`delete from ingredient_entries where entry_date = '${today}';`);
}

async function main() {
  await cleanup();

  const sarahCookie = await login("sarah"); // restaurant
  const anneCookie = await login("anne"); // canteen
  const janifferCookie = await login("janiffer"); // restaurant, store manager

  // ---------------------------------------------------------------
  // TEST 1: Restaurant multi-line batch save — one round trip, correct
  // per-line calculations, matching what save_stock_entry() alone
  // would have produced.
  // ---------------------------------------------------------------
  console.log("\n=== TEST 1: Restaurant batch save — multi-line, one request ===");
  const sarahStock = await api(sarahCookie, "GET", `/api/stock-entries?date=${today}`);
  check("Sarah's GET /api/stock-entries succeeds", sarahStock.status === 200, sarahStock);
  const restaurantItems = sarahStock.body.items.slice(0, 3);

  const stockSaveRes = await api(sarahCookie, "POST", "/api/stock-entries", {
    entry_date: today,
    lines: restaurantItems.map((item, i) => ({
      item_id: item.id,
      till_quantity_sold: i + 1,
      added_stock: 10,
      sent_out: 0,
      wastage: 0,
      wastage_note: null,
    })),
  });
  check("Batch save of 3 lines succeeds in one request", stockSaveRes.status === 200, stockSaveRes);
  check("Response contains exactly 3 saved entries", stockSaveRes.body?.entries?.length === 3, stockSaveRes.body);
  restaurantItems.forEach((item, i) => {
    const row = stockSaveRes.body.entries.find((e) => e.item_id === item.id);
    const expectedSold = i + 1;
    check(
      `${item.name}: quantity_sold=${expectedSold}, closing_stock=${10 - expectedSold}`,
      row?.quantity_sold === expectedSold && row?.closing_stock === 10 - expectedSold,
      row,
    );
    check(
      `${item.name}: sales_value = quantity_sold * selling_price_snapshot`,
      row?.sales_value === expectedSold * item.selling_price,
      row,
    );
  });

  // ---------------------------------------------------------------
  // TEST 2 (MANDATORY — the property Phase 9 actually changed): a
  // batch with an oversold line rolls back ATOMICALLY. Lines before
  // the failing one must NOT be partially committed, unlike the old
  // per-line-round-trip behavior where earlier lines had already
  // landed before the client reached the failing one.
  // ---------------------------------------------------------------
  console.log("\n=== TEST 2 (MANDATORY): Oversell in a batch rolls back the WHOLE batch ===");
  await cleanup();
  const oversellItems = sarahStock.body.items.slice(3, 5);
  const [goodItem, oversoldItem] = oversellItems;

  const oversellRes = await api(sarahCookie, "POST", "/api/stock-entries", {
    entry_date: today,
    lines: [
      { item_id: goodItem.id, till_quantity_sold: 1, added_stock: 10, sent_out: 0, wastage: 0, wastage_note: null },
      { item_id: oversoldItem.id, till_quantity_sold: 999999, added_stock: 0, sent_out: 0, wastage: 0, wastage_note: null },
    ],
  });
  check("Batch with an oversold line is rejected with 409", oversellRes.status === 409, oversellRes);

  const afterOversell = await api(sarahCookie, "GET", `/api/stock-entries?date=${today}`);
  const goodItemRow = afterOversell.body.entries.find((e) => e.item_id === goodItem.id);
  check(
    `${goodItem.name} (the line BEFORE the failing one) was NOT saved — whole batch rolled back atomically`,
    goodItemRow === undefined,
    goodItemRow,
  );

  // ---------------------------------------------------------------
  // TEST 3: Canteen batch save — entry_date normalized to Monday,
  // canteen_independent item's added_stock respected.
  // ---------------------------------------------------------------
  console.log("\n=== TEST 3: Canteen batch save — week normalization + independent item ===");
  await cleanup();
  const anneStock = await api(anneCookie, "GET", `/api/stock-entries?date=${today}`);
  check("Anne's GET /api/stock-entries succeeds", anneStock.status === 200, anneStock);
  const independentItems = anneStock.body.items.filter((i) => i.supply_type === "canteen_independent").slice(0, 2);

  const canteenSaveRes = await api(anneCookie, "POST", "/api/stock-entries", {
    entry_date: today,
    lines: independentItems.map((item) => ({
      item_id: item.id,
      till_quantity_sold: 2,
      added_stock: 15,
      wastage: 1,
      wastage_note: null,
    })),
  });
  check("Canteen batch save succeeds", canteenSaveRes.status === 200, canteenSaveRes);
  const expectedMonday = psql(`select date_trunc('week', '${today}'::date)::date::text;`);
  check(
    "All saved rows use the week's Monday as entry_date, not today's literal date",
    (canteenSaveRes.body?.entries ?? []).every((e) => e.entry_date === expectedMonday),
    canteenSaveRes.body,
  );
  independentItems.forEach((item) => {
    const row = canteenSaveRes.body.entries.find((e) => e.item_id === item.id);
    check(
      `${item.name}: closing_stock = opening(0) + added(15) - sold(2) - wastage(1) = 12`,
      row?.closing_stock === 12,
      row,
    );
  });

  // ---------------------------------------------------------------
  // TEST 4: Ingredient-entries batch save (store manager only).
  // ---------------------------------------------------------------
  console.log("\n=== TEST 4: Ingredient-entries batch save (Janiffer, store manager) ===");
  const ingredientsRes = await api(janifferCookie, "GET", `/api/ingredient-entries?date=${today}`);
  check("Janiffer's GET /api/ingredient-entries succeeds", ingredientsRes.status === 200, ingredientsRes);
  const ingredients = ingredientsRes.body.ingredients.slice(0, 2);

  const ingredientSaveRes = await api(janifferCookie, "POST", "/api/ingredient-entries", {
    entry_date: today,
    lines: ingredients.map((ing) => ({
      ingredient_id: ing.id,
      received: 20,
      quantity_used: 5,
      wastage: 1,
      wastage_note: null,
    })),
  });
  check("Ingredient batch save succeeds", ingredientSaveRes.status === 200, ingredientSaveRes);
  check("Response contains exactly 2 saved entries", ingredientSaveRes.body?.entries?.length === 2, ingredientSaveRes.body);
  ingredients.forEach((ing) => {
    const row = ingredientSaveRes.body.entries.find((e) => e.ingredient_id === ing.id);
    check(
      `${ing.name}: closing_stock = opening(0) + received(20) - used(5) - wastage(1) = 14`,
      row?.closing_stock === 14,
      row,
    );
  });

  // ---------------------------------------------------------------
  // TEST 5: Non-store-manager restaurant staff still forbidden from
  // ingredient-entries (RLS/route-guard unaffected by the batch change).
  // ---------------------------------------------------------------
  console.log("\n=== TEST 5: Non-store-manager still forbidden from ingredient-entries ===");
  const mercyCookie = await login("mercy");
  const forbiddenRes = await api(mercyCookie, "POST", "/api/ingredient-entries", {
    entry_date: today,
    lines: [{ ingredient_id: ingredients[0].id, received: 1, quantity_used: 0, wastage: 0, wastage_note: null }],
  });
  check("Non-store-manager batch POST rejected with 403", forbiddenRes.status === 403, forbiddenRes);

  await cleanup();
  summarizeAndExit("Phase 9");
}

main().catch((err) => {
  console.error("Test harness crashed:", err);
  process.exit(1);
});
