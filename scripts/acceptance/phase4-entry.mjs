#!/usr/bin/env node
/**
 * Phase 4 acceptance checks — Restaurant Daily Entry
 * (docs/phases/phase4_context.md's gating-checklist RLS section (a)-(j),
 * reconstructed here as a real repeatable script instead of only living
 * as prose in that context file).
 *
 * Covers: oversell rejection + message, opening-stock day-to-day
 * carry-forward, cross-location RLS (canteen can't see restaurant
 * stock_entries/ingredient_entries), store-manager-only /store access,
 * admin off staff routes (route-level), ingredient entry + its own
 * oversell check.
 *
 * Prerequisites: local Supabase stack running (`npx supabase status`)
 * and the dev server running (`pnpm dev`). Mutates real local data but
 * cleans up everything it creates before exiting (see cleanup() at the
 * bottom) — safe to re-run anytime.
 *
 * Usage: node scripts/acceptance/phase4-entry.mjs
 */

import { BASE, api, check, findItemByName, login, psql, psqlAsUser, summarizeAndExit } from "./_lib.mjs";

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

async function cleanup() {
  // Direct SQL cleanup (not through the app) since some of this is
  // backdated fixture data the app's own date-scoped write paths would
  // reject to create in the first place — see phase5_context.md's
  // documented pattern for why direct SQL is the right tool here.
  psql(`delete from ingredient_entries where entry_date in ('${today}', '${yesterday}');`);
  psql(`delete from stock_entries where location = 'restaurant' and entry_date in ('${today}', '${yesterday}');`);
}

async function main() {
  await cleanup(); // start from a clean slate in case a prior run failed partway

  const sarahCookie = await login("sarah"); // restaurant, non-store-manager
  const janifferCookie = await login("janiffer"); // restaurant, store manager
  const anneCookie = await login("anne"); // canteen
  const adminCookie = await login("admin");

  // ---------------------------------------------------------------
  // TEST 1: Restaurant entry only shows restaurant-sellable items
  // ---------------------------------------------------------------
  console.log("\n=== TEST 1: Restaurant GET /api/stock-entries scoping ===");
  const sarahEntries = await api(sarahCookie, "GET", `/api/stock-entries?date=${today}`);
  check("Sarah's GET succeeds", sarahEntries.status === 200, sarahEntries);
  const wrongSupplyType = sarahEntries.body.items.find((i) => i.supply_type === "canteen_independent");
  check("No canteen_independent items in restaurant's item list", !wrongSupplyType, wrongSupplyType);

  const samosa = findItemByName(sarahEntries.body.items, "Samosa");

  // ---------------------------------------------------------------
  // TEST 2: Opening stock carries forward from yesterday's closing stock
  // (tested FIRST, before any today's-row exists, since opening_stock is
  // only derived on a fresh INSERT — a later same-day re-save doesn't
  // re-derive it, by design, so this must run on a clean today's row.)
  // ---------------------------------------------------------------
  console.log("\n=== TEST 2: Opening-stock day-to-day carry-forward ===");
  // Manufacture a backdated "yesterday" row directly via SQL (the app's
  // own date-scoped INSERT policy would reject a client POST for a past
  // date) — same fixture pattern documented in phase5_context.md.
  psql(`
    insert into stock_entries (item_id, location, entry_date, opening_stock, added_stock, sent_out, till_quantity_sold, quantity_sold, wastage, selling_price_snapshot, buying_price_snapshot, closing_stock, sales_value, cost_value, closing_stock_value, wastage_value, created_by)
    values ('${samosa.id}', 'restaurant', '${yesterday}', 0, 20, 0, 5, 5, 0, ${samosa.selling_price}, ${samosa.buying_price}, 15, ${5 * samosa.selling_price}, ${5 * samosa.buying_price}, ${15 * samosa.buying_price}, 0, (select id from users where name='Sarah Makena'))
    on conflict (item_id, location, entry_date) do update set closing_stock = excluded.closing_stock;
  `);
  const freshTodayRes = await api(sarahCookie, "POST", "/api/stock-entries", {
    entry_date: today,
    lines: [{ item_id: samosa.id, till_quantity_sold: 5, added_stock: 20, sent_out: 0, wastage: 1, wastage_note: "left out overnight" }],
  });
  check("Today's fresh save succeeds", freshTodayRes.status === 200, freshTodayRes);
  const freshToday = (freshTodayRes.body.entries ?? []).find((e) => e.item_id === samosa.id);
  check(
    "Today's opening_stock equals yesterday's saved closing_stock (15)",
    freshToday?.opening_stock === 15,
    freshToday,
  );
  // total_stock = 15 (opening) + 20 (added) = 35; closing = 35 - 5 - 1 = 29
  check("closing_stock = opening(15) + added(20) - sold(5) - wastage(1) = 29", freshToday?.closing_stock === 29, freshToday);
  check(
    `sales_value = quantity_sold(5) * selling_price(${samosa.selling_price}) = ${5 * samosa.selling_price}`,
    freshToday?.sales_value === 5 * samosa.selling_price,
    freshToday,
  );
  check(
    `wastage_value valued at BUYING price (1 * ${samosa.buying_price}), not selling price`,
    freshToday?.wastage_value === 1 * samosa.buying_price,
    freshToday,
  );

  // ---------------------------------------------------------------
  // TEST 3: Oversell rejected with a plain-language message
  // ---------------------------------------------------------------
  console.log("\n=== TEST 3: Oversell rejected ===");
  const oversellRes = await api(sarahCookie, "POST", "/api/stock-entries", {
    entry_date: today,
    lines: [{ item_id: samosa.id, till_quantity_sold: 100, added_stock: 20, sent_out: 0, wastage: 1, wastage_note: null }],
  });
  check("Oversell rejected with 409", oversellRes.status === 409, oversellRes);
  check(
    "Oversell message is plain language, not a raw Postgres error",
    typeof oversellRes.body?.error === "string" && !oversellRes.body.error.includes("errcode"),
    oversellRes.body,
  );

  // ---------------------------------------------------------------
  // TEST 4: Cross-location RLS — canteen cannot see restaurant data
  // ---------------------------------------------------------------
  console.log("\n=== TEST 4: Cross-location RLS ===");
  const anneStock = await api(anneCookie, "GET", `/api/stock-entries?date=${today}`);
  const anneSeesRestaurantRow = (anneStock.body.entries ?? []).some((e) => e.item_id === samosa.id);
  check("Canteen's GET does not include restaurant's stock_entries rows", !anneSeesRestaurantRow, anneStock.body.entries);

  const anneIngredients = await api(anneCookie, "GET", `/api/ingredient-entries?date=${today}`);
  check("Canteen has NO access to ingredient-entries at all (403)", anneIngredients.status === 403, anneIngredients);

  // Direct RLS-impersonation check (not just route-level) — proves the
  // table policy itself blocks this, not just that the route happens to filter it.
  const anneDirectRestaurantRows = psqlAsUser(
    "Anne Gitonga",
    `select count(*) from stock_entries where location = 'restaurant';`,
  );
  check(
    "RLS-impersonated as Anne: direct query for restaurant stock_entries returns 0 rows",
    anneDirectRestaurantRows.trim().endsWith("0"),
    anneDirectRestaurantRows,
  );

  // ---------------------------------------------------------------
  // TEST 5: Store-manager-only /api/ingredient-entries access
  // ---------------------------------------------------------------
  console.log("\n=== TEST 5: Store-manager-only ingredient entries ===");
  const sarahIngredients = await api(sarahCookie, "GET", `/api/ingredient-entries?date=${today}`);
  check("Non-store-manager Sarah is rejected from ingredient-entries (403)", sarahIngredients.status === 403, sarahIngredients);

  const janifferIngredients = await api(janifferCookie, "GET", `/api/ingredient-entries?date=${today}`);
  check("Store manager Janiffer's GET succeeds", janifferIngredients.status === 200, janifferIngredients);

  const wheatFlour = findItemByName(janifferIngredients.body.ingredients ?? janifferIngredients.body.items, "Wheat Flour");

  const ingredientSaveRes = await api(janifferCookie, "POST", "/api/ingredient-entries", {
    entry_date: today,
    lines: [{ ingredient_id: wheatFlour.id, received: 50, quantity_used: 30, wastage: 5, wastage_note: null }],
  });
  check("Ingredient save succeeds", ingredientSaveRes.status === 200, ingredientSaveRes);
  const savedFlour = (ingredientSaveRes.body.entries ?? []).find((e) => e.ingredient_id === wheatFlour.id);
  // closing = 0 (opening) + 50 - 30 - 5 = 15
  check("Ingredient closing_stock = 0 + 50 - 30 - 5 = 15", savedFlour?.closing_stock === 15, savedFlour);

  const ingredientOversellRes = await api(janifferCookie, "POST", "/api/ingredient-entries", {
    entry_date: today,
    lines: [{ ingredient_id: wheatFlour.id, received: 0, quantity_used: 200, wastage: 0, wastage_note: null }],
  });
  check("Ingredient oversell rejected with 409", ingredientOversellRes.status === 409, ingredientOversellRes);

  // ---------------------------------------------------------------
  // TEST 7: Admin routed off staff routes at the middleware level
  // ---------------------------------------------------------------
  console.log("\n=== TEST 6: Admin off staff routes (middleware) ===");
  const adminEntryRes = await fetch(`${BASE}/entry`, {
    headers: { Cookie: adminCookie },
    redirect: "manual",
  });
  check(
    "Admin hitting /entry gets redirected (30x), not served the staff screen",
    adminEntryRes.status >= 300 && adminEntryRes.status < 400,
    adminEntryRes.status,
  );

  // ---------------------------------------------------------------
  // TEST 7: Same-day re-save (the Phase 4 "post-review" RLS fix)
  // ---------------------------------------------------------------
  console.log("\n=== TEST 7: Same-day re-save (correcting a stepper tap) ===");
  const resaveSameDay = await api(sarahCookie, "POST", "/api/stock-entries", {
    entry_date: today,
    lines: [{ item_id: samosa.id, till_quantity_sold: 6, added_stock: 20, sent_out: 0, wastage: 1, wastage_note: null }],
  });
  check("Re-saving the same day's entry succeeds (200, not 403)", resaveSameDay.status === 200, resaveSameDay);

  const ingredientResave = await api(janifferCookie, "POST", "/api/ingredient-entries", {
    entry_date: today,
    lines: [{ ingredient_id: wheatFlour.id, received: 50, quantity_used: 32, wastage: 5, wastage_note: null }],
  });
  check("Re-saving the same day's ingredient entry succeeds (200, not 403)", ingredientResave.status === 200, ingredientResave);

  await cleanup();
  summarizeAndExit("Phase 4");
}

main().catch((err) => {
  console.error("Test harness crashed:", err);
  process.exit(1);
});
