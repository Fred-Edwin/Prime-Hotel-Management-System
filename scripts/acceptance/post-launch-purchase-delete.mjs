/**
 * Acceptance checks for reversible purchase delete (post-launch,
 * 2026-07-21 — client request from WaPrecious: she couldn't remove a
 * mis-logged purchase on /dashboard/purchases). See
 * supabase/migrations/20260721060000_purchase_delete.sql and
 * docs/01_DATA_MODEL.md's "Purchases: who buys, who receives, and how
 * the cost is derived" section for the full design.
 *
 * ingredient_purchases/canteen_stock_purchases were deliberately
 * append-only (no update/delete RLS policy) — this migration adds a
 * narrow, admin-only DELETE policy plus two functions
 * (delete_ingredient_purchase/delete_canteen_stock_purchase) that unwind
 * BOTH side effects a purchase caused at insert time, not just remove
 * the row:
 *   1. the item/ingredient's weighted-average buying_price is rebuilt
 *      from the remaining purchases (not inverted algebraically, since
 *      that's unsafe if a later purchase already blended in)
 *   2. that period's added_stock/received has the deleted quantity
 *      subtracted back out, then the existing historical-edit-cascade
 *      recompute functions re-derive opening_stock/closing_stock/values
 *      forward — so a downstream oversell the removal reveals rolls
 *      back the whole delete atomically, exactly like an admin ledger
 *      edit does.
 *
 * This script covers what's genuinely new to this feature — it does not
 * re-verify record_ingredient_purchase()/record_canteen_stock_purchase()'s
 * own forward math (already covered by post-launch-ingredient-purchases.mjs
 * / post-launch-canteen-purchases.mjs).
 *
 * Uses dedicated fixture ingredient/item (created and torn down by this
 * script) so it never touches real seed data's purchase history.
 *
 * Prerequisites: a Supabase stack (local Docker, or a hosted dev project
 * via ACCEPTANCE_DB_MODE=linked) and the dev server running (`pnpm dev`).
 *
 * Usage: node scripts/acceptance/post-launch-purchase-delete.mjs
 */

import { randomUUID } from "node:crypto";
import { login, api, check, summarizeAndExit, psql, psqlRow } from "./_lib.mjs";

const TODAY = new Date().toISOString().slice(0, 10);
const YESTERDAY = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

const FIXTURE_INGREDIENT_NAME = "[acceptance-test] Purchase-Delete Ingredient";
const FIXTURE_ITEM_NAME = "[acceptance-test] Purchase-Delete Canteen Item";
const ingredientId = randomUUID();
const itemId = randomUUID();

function cleanup() {
  psql(`delete from ingredient_purchases where ingredient_id = '${ingredientId}';`);
  psql(`delete from ingredient_entries where ingredient_id = '${ingredientId}';`);
  psql(`delete from ingredients where id = '${ingredientId}';`);

  psql(`delete from canteen_stock_purchases where item_id = '${itemId}';`);
  psql(`delete from stock_entries where item_id = '${itemId}';`);
  psql(`delete from items where id = '${itemId}';`);
}

async function main() {
  cleanup();

  psql(
    `insert into ingredients (id, name, unit, buying_price, low_stock_threshold) values ('${ingredientId}', '${FIXTURE_INGREDIENT_NAME}', 'kg', 0, 5);`,
  );
  psql(
    `insert into items (id, name, category, supply_type, selling_price, buying_price, active) values ('${itemId}', '${FIXTURE_ITEM_NAME}', 'others', 'canteen_independent', 200, 0, true);`,
  );

  const admin = await login("admin");
  const janiffer = await login("janiffer"); // restaurant, store manager
  const sarah = await login("sarah"); // restaurant, cashier — not store manager, not admin

  console.log("\n=== SETUP: log two ingredient purchases (different prices) ===");
  let purchaseAId, purchaseBId;
  {
    const r1 = await api(admin, "POST", "/api/ingredient-purchases", {
      ingredient_id: ingredientId,
      purchase_date: TODAY,
      quantity: 10,
      unit_cost: 100,
    });
    check("Purchase A logged (200)", r1.status === 200, r1);
    purchaseAId = r1.body?.purchase?.id;

    const r2 = await api(admin, "POST", "/api/ingredient-purchases", {
      ingredient_id: ingredientId,
      purchase_date: TODAY,
      quantity: 10,
      unit_cost: 200,
    });
    check("Purchase B logged (200)", r2.status === 200, r2);
    purchaseBId = r2.body?.purchase?.id;

    // 10@100 + 10@200 = 150.00 average, 20.00 received.
    const avg = psqlRow(`select buying_price from ingredients where id = '${ingredientId}';`);
    check("Average cost after both purchases = 150.00", avg === "150.00", avg);
  }

  console.log("\n=== TEST 1: Non-admin (store manager) cannot delete a purchase ===");
  {
    const res = await api(janiffer, "DELETE", `/api/ingredient-purchases/${purchaseAId}`);
    check("Store manager DELETE rejected with 403", res.status === 403, res);
    const stillThere = psqlRow(`select count(*) from ingredient_purchases where id = '${purchaseAId}';`);
    check("Purchase A still exists after rejected attempt", stillThere === "1", stillThere);
  }

  console.log("\n=== TEST 2: Non-admin (cashier) cannot delete a purchase ===");
  {
    const res = await api(sarah, "DELETE", `/api/ingredient-purchases/${purchaseAId}`);
    check("Cashier DELETE rejected with 403", res.status === 403, res);
  }

  console.log("\n=== TEST 3: RLS itself blocks a direct delete, not just the route ===");
  {
    // Per CLAUDE.md's "RLS is the real security boundary" rule — prove
    // the database refuses this even if a route-layer check were ever
    // bypassed, by impersonating a non-admin session directly.
    psql(
      `select set_config('request.jwt.claims', json_build_object('sub', (select id::text from users where name='Janiffer Maina'), 'role','authenticated')::text, true); set role authenticated; delete from ingredient_purchases where id = '${purchaseAId}'; reset role;`,
    );
    const stillThere = psqlRow(`select count(*) from ingredient_purchases where id = '${purchaseAId}';`);
    check("Direct DELETE as store manager blocked by RLS (row still exists)", stillThere === "1", stillThere);
  }

  console.log("\n=== TEST 4 (MANDATORY): Admin delete reverses BOTH side effects ===");
  {
    const res = await api(admin, "DELETE", `/api/ingredient-purchases/${purchaseAId}`);
    check("Admin DELETE succeeds (200)", res.status === 200, res);

    const gone = psqlRow(`select count(*) from ingredient_purchases where id = '${purchaseAId}';`);
    check("Purchase A row is actually gone", gone === "0", gone);

    // Only purchase B (10@200) remains -> average must now be exactly
    // 200.00, not a stale blended value and not simply reverted to
    // whatever it was before purchase A (which was 100.00, before B
    // existed) -- proves the rebuild replays what's LEFT, not a naive
    // undo.
    const avg = psqlRow(`select buying_price from ingredients where id = '${ingredientId}';`);
    check("Average cost rebuilt to 200.00 (only remaining purchase B)", avg === "200.00", avg);

    // received must drop from 20 to 10 (purchase A's 10kg removed), not
    // reset to 0.
    const entry = psqlRow(
      `select received, closing_stock from ingredient_entries where ingredient_id = '${ingredientId}' and entry_date = '${TODAY}';`,
    );
    check("received reduced to 10.00 (20 - 10, purchase B's quantity preserved)", entry === "10.00|10.00", entry);
  }

  console.log("\n=== TEST 5: Deleting the last remaining purchase drops received/average correctly ===");
  {
    const res = await api(admin, "DELETE", `/api/ingredient-purchases/${purchaseBId}`);
    check("Admin DELETE of last purchase succeeds (200)", res.status === 200, res);

    const entry = psqlRow(
      `select received, closing_stock from ingredient_entries where ingredient_id = '${ingredientId}' and entry_date = '${TODAY}';`,
    );
    check("received reduced to 0.00 (last purchase removed)", entry === "0.00|0.00", entry);

    const purchaseCount = psqlRow(`select count(*) from ingredient_purchases where ingredient_id = '${ingredientId}';`);
    check("No purchases remain", purchaseCount === "0", purchaseCount);
  }

  console.log("\n=== TEST 6 (MANDATORY): Deleting a purchase that would cause a downstream oversell is rejected atomically ===");
  {
    // Log a fresh purchase (10kg), then have the store manager use 8kg of
    // it today, leaving 2kg closing stock. Deleting the purchase would
    // require reducing received to 0, which can no longer cover the 8kg
    // already used -- must be rejected, and the purchase itself must NOT
    // be deleted (atomic rollback).
    const purchaseRes = await api(admin, "POST", "/api/ingredient-purchases", {
      ingredient_id: ingredientId,
      purchase_date: TODAY,
      quantity: 10,
      unit_cost: 50,
    });
    check("Setup purchase logged (200)", purchaseRes.status === 200, purchaseRes);
    const purchaseId = purchaseRes.body?.purchase?.id;

    const useRes = await api(janiffer, "PUT", "/api/ingredient-entries", {
      entry_date: TODAY,
      ingredient_id: ingredientId,
      received: 10,
      quantity_used: 8,
    });
    check("Setup usage (8kg used) succeeds (200)", useRes.status === 200, useRes);

    const deleteRes = await api(admin, "DELETE", `/api/ingredient-purchases/${purchaseId}`);
    check("Delete that would cause a downstream oversell is rejected (409)", deleteRes.status === 409, deleteRes);

    const stillThere = psqlRow(`select count(*) from ingredient_purchases where id = '${purchaseId}';`);
    check("Purchase NOT deleted — atomic rollback held", stillThere === "1", stillThere);

    const entry = psqlRow(
      `select received, quantity_used, closing_stock from ingredient_entries where ingredient_id = '${ingredientId}' and entry_date = '${TODAY}';`,
    );
    check("received/quantity_used/closing_stock unchanged after rejected delete", entry === "10.00|8.00|2.00", entry);
  }

  console.log("\n=== TEST 7: Deleting a non-existent purchase returns 404, not a silent success ===");
  {
    const res = await api(admin, "DELETE", `/api/ingredient-purchases/${randomUUID()}`);
    check("Deleting an unknown purchase id returns 404", res.status === 404, res);
  }

  console.log("\n=== TEST 8: Canteen purchase delete mirrors the ingredient path (admin-only, weighted-avg rebuild, added_stock reversal) ===");
  {
    const admin2 = admin;

    const r1 = await api(admin2, "POST", "/api/canteen-purchases", {
      item_id: itemId,
      purchase_date: TODAY,
      quantity: 5,
      unit_cost: 40,
    });
    check("Canteen purchase A logged (200)", r1.status === 200, r1);

    const r2 = await api(admin2, "POST", "/api/canteen-purchases", {
      item_id: itemId,
      purchase_date: TODAY,
      quantity: 5,
      unit_cost: 60,
    });
    check("Canteen purchase B logged (200)", r2.status === 200, r2);
    const purchaseAId2 = r1.body?.purchase?.id;

    const avgBefore = psqlRow(`select buying_price from items where id = '${itemId}';`);
    check("Canteen average before delete = 50.00 (5@40 + 5@60)/10", avgBefore === "50.00", avgBefore);

    const forbidden = await api(janiffer, "DELETE", `/api/canteen-purchases/${purchaseAId2}`);
    check("Non-admin cannot delete a canteen purchase (403)", forbidden.status === 403, forbidden);

    const delRes = await api(admin2, "DELETE", `/api/canteen-purchases/${purchaseAId2}`);
    check("Admin deletes canteen purchase A (200)", delRes.status === 200, delRes);

    const avgAfter = psqlRow(`select buying_price from items where id = '${itemId}';`);
    check("Canteen average rebuilt to 60.00 (only purchase B remains)", avgAfter === "60.00", avgAfter);

    // Canteen stock_entries.entry_date is week-normalized (Monday) —
    // find whatever row actually landed rather than assuming TODAY.
    const addedStock = psqlRow(
      `select added_stock from stock_entries where item_id = '${itemId}' and location = 'canteen' order by entry_date desc limit 1;`,
    );
    check("added_stock reduced to 5.00 (10 - 5, purchase B's quantity preserved)", addedStock === "5.00", addedStock);
  }

  cleanup();
  summarizeAndExit("Post-launch: purchase delete");
}

main().catch((err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});
