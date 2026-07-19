/**
 * Acceptance checks for the ingredient purchases redesign (post-launch,
 * 2026-07-19 — see docs/01_DATA_MODEL.md §3.2's "Purchases: who buys,
 * who receives, and how the cost is derived" and docs/00_ARCHITECTURE.md
 * §13).
 *
 * Covers POST/GET /api/ingredient-purchases and the underlying
 * record_ingredient_purchase() RPC's real correctness risk:
 * - weighted-average cost math (the whole point of the redesign)
 * - received folding additively into ingredient_entries, not overwriting
 * - RBAC: both admin and the store-manager-flagged user can log a
 *   purchase; an ordinary cashier cannot
 * - concurrent same-day purchases for the same ingredient don't race
 *   each other's weighted-average recalculation (the advisory lock this
 *   RPC reuses from lock_ingredient_entry_row())
 * - the oversell check still holds after a purchase increases received
 *
 * Uses a dedicated fixture ingredient (created and torn down by this
 * script) so it never touches real seed ingredients' purchase history.
 */

import { randomUUID } from "node:crypto";
import { login, api, check, summarizeAndExit, psql, psqlRow } from "./_lib.mjs";

const TODAY = new Date().toISOString().slice(0, 10);
const FIXTURE_NAME = "[acceptance-test] Purchases Ingredient";
const RACE_FIXTURE_NAME = "[acceptance-test] Purchases Ingredient (race)";
const ingredientId = randomUUID();
const raceIngredientId = randomUUID();

function cleanup() {
  psql(
    `delete from ingredient_purchases where ingredient_id in ('${ingredientId}', '${raceIngredientId}');`,
  );
  psql(`delete from ingredient_entries where ingredient_id in ('${ingredientId}', '${raceIngredientId}');`);
  psql(`delete from ingredients where id in ('${ingredientId}', '${raceIngredientId}');`);
}

async function main() {
  cleanup();

  psql(
    `insert into ingredients (id, name, unit, buying_price, low_stock_threshold) values ('${ingredientId}', '${FIXTURE_NAME}', 'kg', 100.00, 5);`,
  );
  const createdCheck = psqlRow(`select count(*) from ingredients where id = '${ingredientId}';`);
  check("Fixture ingredient created", createdCheck === "1", createdCheck);

  const admin = await login("admin");
  const janiffer = await login("janiffer"); // restaurant, store manager
  const sarah = await login("sarah"); // restaurant, cashier — not store manager

  console.log("\n=== TEST 1: Admin can log a purchase (first-ever, no stock on hand yet) ===");
  {
    const { status, body } = await api(admin, "POST", "/api/ingredient-purchases", {
      ingredient_id: ingredientId,
      purchase_date: TODAY,
      quantity: 20,
      unit_cost: 100,
      supplier_note: "Mwangi Suppliers",
    });
    check("Admin POST succeeds (200)", status === 200, { status, body });
    check("Purchase quantity = 20", body?.purchase?.quantity === 20, body?.purchase);
    check("Purchase unit_cost = 100", body?.purchase?.unit_cost === 100, body?.purchase);
    check("Purchase total_cost = 2000", body?.purchase?.total_cost === 2000, body?.purchase);

    // No stock on hand before this purchase, so the weighted average is
    // just this purchase's own price.
    const avgCost = psqlRow(`select buying_price from ingredients where id = '${ingredientId}';`);
    check("ingredients.buying_price becomes 100.00 (first purchase, no prior stock)", avgCost === "100.00", avgCost);

    const entry = psqlRow(
      `select received, closing_stock from ingredient_entries where ingredient_id = '${ingredientId}' and entry_date = '${TODAY}';`,
    );
    check("ingredient_entries.received = 20.00 (folded from the purchase)", entry === "20.00|20.00", entry);
  }

  console.log("\n=== TEST 2 (MANDATORY): Weighted-average cost blends, doesn't replace ===");
  {
    // 20kg on hand at 100/kg (worth 2000). Buy 10kg more at 130/kg (worth
    // 1300). New average = (2000 + 1300) / 30 = 110.00 — see
    // docs/00_ARCHITECTURE.md §13's worked example.
    const { status, body } = await api(janiffer, "POST", "/api/ingredient-purchases", {
      ingredient_id: ingredientId,
      purchase_date: TODAY,
      quantity: 10,
      unit_cost: 130,
    });
    check("Store manager POST succeeds (200)", status === 200, { status, body });

    const avgCost = psqlRow(`select buying_price from ingredients where id = '${ingredientId}';`);
    check(
      "ingredients.buying_price = 110.00 (weighted average, not 130 or a plain replace)",
      avgCost === "110.00",
      avgCost,
    );

    const entry = psqlRow(
      `select received, closing_stock, buying_price_snapshot from ingredient_entries where ingredient_id = '${ingredientId}' and entry_date = '${TODAY}';`,
    );
    check(
      "received folds additively to 30.00 (20 + 10, not overwritten to 10)",
      entry === "30.00|30.00|110.00",
      entry,
    );
  }

  console.log("\n=== TEST 3: Purchase history is queryable and shows both loggers ===");
  {
    const { status, body } = await api(admin, "GET", "/api/ingredient-purchases?period=today");
    check("Admin GET succeeds (200)", status === 200, { status, body });
    const rows = (body?.purchases ?? []).filter((p) => p.ingredient_id === ingredientId);
    check("Both purchases show up in today's history", rows.length === 2, rows);

    const stockRow = (body?.stockOnHand ?? []).find((r) => r.ingredient_id === ingredientId);
    check("Stock-on-hand quantity = 30", stockRow?.quantity === 30, stockRow);
    check("Stock-on-hand average_cost = 110", stockRow?.average_cost === 110, stockRow);
    check("Stock-on-hand value = 3300 (30 * 110)", stockRow?.value === 3300, stockRow);
  }

  console.log("\n=== TEST 4: Non-store-manager, non-admin staff forbidden from logging a purchase ===");
  {
    const postRes = await api(sarah, "POST", "/api/ingredient-purchases", {
      ingredient_id: ingredientId,
      purchase_date: TODAY,
      quantity: 5,
      unit_cost: 100,
    });
    check("Cashier POST rejected with 403", postRes.status === 403, postRes);

    const getRes = await api(sarah, "GET", "/api/ingredient-purchases?period=today");
    check("Cashier GET rejected with 403", getRes.status === 403, getRes);
  }

  console.log("\n=== TEST 5: A purchase still respects the oversell check on quantity_used ===");
  {
    // 30 on hand. Using 999 must still be rejected even though a
    // purchase just increased received — the check is against total
    // available, not a special-cased bypass.
    const { status, body } = await api(janiffer, "PUT", "/api/ingredient-entries", {
      entry_date: TODAY,
      ingredient_id: ingredientId,
      received: 30,
      quantity_used: 999,
    });
    check("Oversell still rejected with 409 after a purchase", status === 409, { status, body });
  }

  console.log("\n=== TEST 6 (MANDATORY): Concurrent same-day purchases don't race the weighted average ===");
  {
    psql(
      `insert into ingredients (id, name, unit, buying_price, low_stock_threshold) values ('${raceIngredientId}', '${RACE_FIXTURE_NAME}', 'kg', 50.00, 5);`,
    );

    // Both start from 0 on hand. Purchase A: 10kg @ 100. Purchase B: 10kg
    // @ 200. Whichever order they actually apply in, the final average
    // must reflect BOTH purchases (150.00 = (1000+2000)/20), never just
    // one of them (which would mean the lock let a race drop a write).
    const [r1, r2] = await Promise.all([
      api(admin, "POST", "/api/ingredient-purchases", {
        ingredient_id: raceIngredientId,
        purchase_date: TODAY,
        quantity: 10,
        unit_cost: 100,
      }),
      api(janiffer, "POST", "/api/ingredient-purchases", {
        ingredient_id: raceIngredientId,
        purchase_date: TODAY,
        quantity: 10,
        unit_cost: 200,
      }),
    ]);

    check(
      "Both concurrent purchases succeed (no false rejection)",
      r1.status === 200 && r2.status === 200,
      { r1: r1.status, r2: r2.status, b1: r1.body, b2: r2.body },
    );

    const entry = psqlRow(
      `select received, closing_stock from ingredient_entries where ingredient_id = '${raceIngredientId}' and entry_date = '${TODAY}';`,
    );
    check("Both quantities landed: received = 20.00 (10 + 10, neither dropped)", entry === "20.00|20.00", entry);

    const avgCost = psqlRow(`select buying_price from ingredients where id = '${raceIngredientId}';`);
    check(
      "Weighted average reflects BOTH purchases: 150.00 = (10*100 + 10*200) / 20",
      avgCost === "150.00",
      avgCost,
    );

    const purchaseCount = psqlRow(
      `select count(*) from ingredient_purchases where ingredient_id = '${raceIngredientId}';`,
    );
    check("Both purchases persisted as separate rows (2, not 1 clobbered)", purchaseCount === "2", purchaseCount);
  }

  console.log("\n=== TEST 7: Purchase rows are immutable (no update/delete RLS policy) ===");
  {
    // No PATCH/DELETE route exists at all for ingredient_purchases —
    // confirm this is a deliberate application-level absence backed by
    // the database itself refusing an update (RLS has no update policy
    // for this table at all), not just a missing route.
    const anyPurchase = psqlRow(
      `select id from ingredient_purchases where ingredient_id = '${ingredientId}' limit 1;`,
    );
    // set_config() must run BEFORE set role — it looks up Janiffer's id
    // via a subquery that needs the original (unrestricted) role to
    // resolve; switching role first would make that subquery see nothing
    // and silently impersonate nobody (see _lib.mjs's psqlAsUser, same
    // ordering, for the established pattern this mirrors).
    psql(
      `select set_config('request.jwt.claims', json_build_object('sub', (select id::text from users where name='Janiffer Maina'), 'role','authenticated')::text, true); set role authenticated; update ingredient_purchases set unit_cost = 1 where id = '${anyPurchase}'; reset role;`,
    );
    const unitCostAfter = psqlRow(`select unit_cost from ingredient_purchases where id = '${anyPurchase}';`);
    check(
      "Direct UPDATE as store manager is blocked by RLS (unit_cost unchanged, still 100.00)",
      unitCostAfter === "100.00",
      unitCostAfter,
    );
  }

  cleanup();
  summarizeAndExit("Post-launch: ingredient purchases");
}

main().catch((err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});
