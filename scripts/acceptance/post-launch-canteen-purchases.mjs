/**
 * Acceptance checks for canteen stock purchases (post-launch, 2026-07-20
 * — see docs/01_DATA_MODEL.md §3.2's "Canteen's own stock purchases"
 * subsection and docs/00_ARCHITECTURE.md §13's extension note).
 *
 * Covers POST/GET /api/canteen-purchases and the underlying
 * record_canteen_stock_purchase() RPC's real correctness risk:
 * - weighted-average cost math (same formula as ingredient purchases)
 * - added_stock folding additively into stock_entries, not overwriting
 * - scoped to canteen_independent items ONLY — a canteen_supplied item
 *   must be rejected (the database trigger, not just a route check)
 * - RBAC: admin-only — unlike ingredient purchases, canteen has no
 *   store-manager-equivalent role, so even Anne (canteen staff) herself
 *   must be forbidden, not just restaurant cashiers
 * - concurrent purchases for the same item/day don't race the
 *   weighted-average recalculation (shares lock_stock_entry_row() with
 *   Anne's own /entry autosave)
 * - the oversell check still holds after a purchase increases added_stock
 * - purchase_date is stored as-is (the real submitted date), NOT
 *   normalized to a week's Monday — updated 2026-07-20 for the canteen
 *   daily-cadence conversion (docs/01_DATA_MODEL.md §3.1); before that
 *   conversion this script asserted the opposite (normalization to
 *   WEEK_START), which was the correct behavior at the time but is now
 *   stale. See docs/phases/postlaunch_canteen_daily_context.md and the
 *   dedicated scripts/acceptance/post-launch-canteen-daily-cadence.mjs
 *   for the conversion's own full acceptance coverage.
 *
 * Uses dedicated fixture items (created and torn down by this script) so
 * it never touches real seed items' purchase history.
 */

import { randomUUID } from "node:crypto";
import { login, api, check, summarizeAndExit, psql, psqlRow, psqlAsUser } from "./_lib.mjs";

const TODAY = new Date().toISOString().slice(0, 10);
const FIXTURE_NAME = "[acceptance-test] Canteen Purchases Item";
const RACE_FIXTURE_NAME = "[acceptance-test] Canteen Purchases Item (race)";
const SUPPLIED_FIXTURE_NAME = "[acceptance-test] Canteen Purchases Item (supplied)";
const itemId = randomUUID();
const raceItemId = randomUUID();
const suppliedItemId = randomUUID();

function cleanup() {
  psql(
    `delete from canteen_stock_purchases where item_id in ('${itemId}', '${raceItemId}', '${suppliedItemId}');`,
  );
  psql(`delete from stock_entries where item_id in ('${itemId}', '${raceItemId}', '${suppliedItemId}');`);
  psql(`delete from items where id in ('${itemId}', '${raceItemId}', '${suppliedItemId}');`);
}

async function main() {
  cleanup();

  psql(
    `insert into items (id, name, category, supply_type, buying_price, selling_price, low_stock_threshold) values ('${itemId}', '${FIXTURE_NAME}', 'retail', 'canteen_independent', 100.00, 150.00, 5);`,
  );
  const createdCheck = psqlRow(`select count(*) from items where id = '${itemId}';`);
  check("Fixture canteen_independent item created", createdCheck === "1", createdCheck);

  const admin = await login("admin");
  const anne = await login("anne"); // canteen
  const sarah = await login("sarah"); // restaurant, cashier — not canteen, not admin

  console.log("\n=== TEST 1: Admin can log a purchase (first-ever, no stock on hand yet) ===");
  {
    const { status, body } = await api(admin, "POST", "/api/canteen-purchases", {
      item_id: itemId,
      purchase_date: TODAY,
      quantity: 20,
      unit_cost: 100,
      supplier_note: "Nakumatt Cash & Carry",
    });
    check("Admin POST succeeds (200)", status === 200, { status, body });
    check("Purchase quantity = 20", body?.purchase?.quantity === 20, body?.purchase);
    check("Purchase unit_cost = 100", body?.purchase?.unit_cost === 100, body?.purchase);
    check("Purchase total_cost = 2000", body?.purchase?.total_cost === 2000, body?.purchase);
    check(
      "Purchase purchase_date stored as-is (the real submitted date, not normalized to a Monday)",
      body?.purchase?.purchase_date === TODAY,
      body?.purchase,
    );

    // No stock on hand before this purchase, so the weighted average is
    // just this purchase's own price.
    const avgCost = psqlRow(`select buying_price from items where id = '${itemId}';`);
    check("items.buying_price becomes 100.00 (first purchase, no prior stock)", avgCost === "100.00", avgCost);

    const entry = psqlRow(
      `select added_stock, closing_stock from stock_entries where item_id = '${itemId}' and location = 'canteen' and entry_date = '${TODAY}';`,
    );
    check("stock_entries.added_stock = 20.00 (folded from the purchase)", entry === "20.00|20.00", entry);
  }

  console.log("\n=== TEST 2 (MANDATORY): Weighted-average cost blends, doesn't replace ===");
  {
    // 20 on hand at 100 (worth 2000). Buy 10 more at 130 (worth 1300).
    // New average = (2000 + 1300) / 30 = 110.00 — same formula as
    // ingredient purchases, see docs/00_ARCHITECTURE.md §11's worked example.
    const { status, body } = await api(admin, "POST", "/api/canteen-purchases", {
      item_id: itemId,
      purchase_date: TODAY,
      quantity: 10,
      unit_cost: 130,
    });
    check("Second admin POST succeeds (200)", status === 200, { status, body });

    const avgCost = psqlRow(`select buying_price from items where id = '${itemId}';`);
    check(
      "items.buying_price = 110.00 (weighted average, not 130 or a plain replace)",
      avgCost === "110.00",
      avgCost,
    );

    const entry = psqlRow(
      `select added_stock, closing_stock, buying_price_snapshot from stock_entries where item_id = '${itemId}' and location = 'canteen' and entry_date = '${TODAY}';`,
    );
    check(
      "added_stock folds additively to 30.00 (20 + 10, not overwritten to 10)",
      entry === "30.00|30.00|110.00",
      entry,
    );
  }

  console.log("\n=== TEST 3: Purchase history and stock-on-hand are queryable ===");
  {
    const { status, body } = await api(admin, "GET", "/api/canteen-purchases?period=today");
    check("Admin GET succeeds (200)", status === 200, { status, body });
    const rows = (body?.purchases ?? []).filter((p) => p.item_id === itemId);
    check("Both purchases show up in today's history", rows.length === 2, rows);

    const stockRow = (body?.stockOnHand ?? []).find((r) => r.item_id === itemId);
    check("Stock-on-hand quantity = 30", stockRow?.quantity === 30, stockRow);
    check("Stock-on-hand average_cost = 110", stockRow?.average_cost === 110, stockRow);
    check("Stock-on-hand value = 3300 (30 * 110)", stockRow?.value === 3300, stockRow);
  }

  console.log("\n=== TEST 4 (MANDATORY): canteen_supplied items are rejected, not just filtered ===");
  {
    psql(
      `insert into items (id, name, category, supply_type, buying_price, selling_price, low_stock_threshold) values ('${suppliedItemId}', '${SUPPLIED_FIXTURE_NAME}', 'meals', 'canteen_supplied', 50.00, 80.00, 5);`,
    );

    const { status, body } = await api(admin, "POST", "/api/canteen-purchases", {
      item_id: suppliedItemId,
      purchase_date: TODAY,
      quantity: 5,
      unit_cost: 50,
    });
    check(
      "POST for a canteen_supplied item is rejected (400), not silently accepted",
      status === 400,
      { status, body },
    );

    const purchaseCount = psqlRow(
      `select count(*) from canteen_stock_purchases where item_id = '${suppliedItemId}';`,
    );
    check("No canteen_stock_purchases row was created for the supplied item", purchaseCount === "0", purchaseCount);

    // Confirm the DB trigger/function-level guard itself is what's
    // stopping it, not just the route — direct RPC call as admin,
    // bypassing the route entirely. record_canteen_stock_purchase()
    // raises a check_violation before ever touching the table, so psql
    // exits non-zero and execFileSync throws — caught here rather than
    // asserted on a return value, since there's no successful row to
    // inspect the way a rejected INSERT alone would give us.
    let directCallThrew = false;
    let directCallMessage = "";
    try {
      psqlAsUser(
        "WaPrecious",
        `select record_canteen_stock_purchase('${suppliedItemId}'::uuid, '${TODAY}'::date, 5, 50, (select id from users where name='WaPrecious'));`,
      );
    } catch (err) {
      directCallThrew = true;
      directCallMessage = String(err?.stderr ?? err?.message ?? err);
    }
    check(
      "Direct RPC call also rejects a canteen_supplied item (function-level guard, not just route validation)",
      directCallThrew && /canteen_independent/i.test(directCallMessage),
      directCallMessage,
    );
  }

  console.log("\n=== TEST 5 (MANDATORY): Canteen staff (Anne) and non-admin/non-canteen staff are both forbidden ===");
  {
    const anneRes = await api(anne, "POST", "/api/canteen-purchases", {
      item_id: itemId,
      purchase_date: TODAY,
      quantity: 5,
      unit_cost: 100,
    });
    check(
      "Canteen staff (Anne) POST rejected with 403 — no store-manager-equivalent role here",
      anneRes.status === 403,
      anneRes,
    );

    const anneGet = await api(anne, "GET", "/api/canteen-purchases?period=today");
    check("Canteen staff (Anne) GET rejected with 403", anneGet.status === 403, anneGet);

    const sarahRes = await api(sarah, "POST", "/api/canteen-purchases", {
      item_id: itemId,
      purchase_date: TODAY,
      quantity: 5,
      unit_cost: 100,
    });
    check("Restaurant cashier POST rejected with 403", sarahRes.status === 403, sarahRes);
  }

  console.log("\n=== TEST 6: A purchase still respects the oversell check on quantity_sold ===");
  {
    // 30 on hand. Selling 999 must still be rejected even though a
    // purchase just increased added_stock — the check is against total
    // available, not a special-cased bypass.
    const { status, body } = await api(anne, "PUT", "/api/stock-entries", {
      entry_date: TODAY,
      item_id: itemId,
      till_quantity_sold: 999,
    });
    check("Oversell still rejected with 409 after a purchase", status === 409, { status, body });
  }

  console.log("\n=== TEST 7 (MANDATORY): Concurrent same-day purchases don't race the weighted average ===");
  {
    psql(
      `insert into items (id, name, category, supply_type, buying_price, selling_price, low_stock_threshold) values ('${raceItemId}', '${RACE_FIXTURE_NAME}', 'retail', 'canteen_independent', 50.00, 80.00, 5);`,
    );

    // Both start from 0 on hand. Purchase A: 10 @ 100. Purchase B: 10 @
    // 200. Whichever order they actually apply in, the final average
    // must reflect BOTH purchases (150.00 = (1000+2000)/20), never just
    // one of them (which would mean the lock let a race drop a write).
    const [r1, r2] = await Promise.all([
      api(admin, "POST", "/api/canteen-purchases", {
        item_id: raceItemId,
        purchase_date: TODAY,
        quantity: 10,
        unit_cost: 100,
      }),
      api(admin, "POST", "/api/canteen-purchases", {
        item_id: raceItemId,
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
      `select added_stock, closing_stock from stock_entries where item_id = '${raceItemId}' and location = 'canteen' and entry_date = '${TODAY}';`,
    );
    check("Both quantities landed: added_stock = 20.00 (10 + 10, neither dropped)", entry === "20.00|20.00", entry);

    const avgCost = psqlRow(`select buying_price from items where id = '${raceItemId}';`);
    check(
      "Weighted average reflects BOTH purchases: 150.00 = (10*100 + 10*200) / 20",
      avgCost === "150.00",
      avgCost,
    );

    const purchaseCount = psqlRow(
      `select count(*) from canteen_stock_purchases where item_id = '${raceItemId}';`,
    );
    check("Both purchases persisted as separate rows (2, not 1 clobbered)", purchaseCount === "2", purchaseCount);
  }

  console.log("\n=== TEST 8: Purchase rows can't be directly UPDATEd (no update RLS policy) ===");
  {
    // Delete is now possible, but only through the admin-only DELETE
    // policy + delete_canteen_stock_purchase() added post-launch — see
    // post-launch-purchase-delete.mjs, not re-tested here.
    const anyPurchase = psqlRow(
      `select id from canteen_stock_purchases where item_id = '${itemId}' limit 1;`,
    );
    psql(
      `select set_config('request.jwt.claims', json_build_object('sub', (select id::text from users where name='WaPrecious'), 'role','authenticated')::text, true); set role authenticated; update canteen_stock_purchases set unit_cost = 1 where id = '${anyPurchase}'; reset role;`,
    );
    const unitCostAfter = psqlRow(`select unit_cost from canteen_stock_purchases where id = '${anyPurchase}';`);
    check(
      "Direct UPDATE (even as admin) is blocked — no update policy exists for this table at all",
      unitCostAfter === "100.00",
      unitCostAfter,
    );
  }

  cleanup();
  summarizeAndExit("Post-launch: canteen stock purchases");
}

main().catch((err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});
