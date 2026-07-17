/**
 * Acceptance checks for the /entry cashier (non-store-manager) per-field
 * autosave redesign (post-launch, 2026-07-17 — see
 * docs/backlog/entry-cashier-redesign-handover.md and
 * docs/01_DATA_MODEL.md §3.4's fifth writer).
 *
 * Covers PUT /api/stock-entries's cashier branch (putCashierField(),
 * calling save_stock_entry_cashier_field() —
 * 20260717130000_stock_entry_cashier_autosave.sql): happy-path autosave,
 * store-manager-vs-cashier RBAC split on the same route, the row-locking
 * concurrent-first-writer race, and — the actual point of this
 * redesign's correctness work — the two DISTINCT rejection cases:
 *   1. genuine oversell (added_stock > 0 but still not enough) keeps the
 *      existing generic message.
 *   2. "nothing added yet today" (no row, or added_stock = 0) gets a
 *      specifically-diagnosed message instead of the same generic one,
 *      on BOTH the new PUT autosave and the pre-existing batch POST path
 *      (same root cause, same fix, two call sites — see
 *      app/api/stock-entries/route.ts's pre-check in the POST handler).
 * Uses a dedicated fixture item (created and torn down by this script)
 * so it never touches real seed items' entry history.
 */

import { randomUUID } from "node:crypto";
import { login, api, check, summarizeAndExit, psql } from "./_lib.mjs";

const TODAY = new Date().toISOString().slice(0, 10);
const FIXTURE_NAME = "[acceptance-test] Cashier Autosave Item";
const itemId = randomUUID();
const raceItemId = randomUUID();
const postItemId = randomUUID();

function cleanup() {
  psql(`delete from stock_entries where item_id in ('${itemId}', '${raceItemId}', '${postItemId}');`);
  psql(`delete from items where id in ('${itemId}', '${raceItemId}', '${postItemId}');`);
}

function insertItem(id, name) {
  psql(
    `insert into items (id, name, category, supply_type, buying_price, selling_price, low_stock_threshold) values ('${id}', '${name}', 'meals', 'restaurant_only', 50.00, 100.00, 5);`,
  );
}

async function main() {
  cleanup();

  insertItem(itemId, FIXTURE_NAME);
  const createdCheck = psql(`select count(*) from items where id = '${itemId}';`);
  check("Fixture item created", createdCheck === "1", createdCheck);

  const janiffer = await login("janiffer"); // restaurant, store manager
  const sarah = await login("sarah"); // restaurant, cashier

  console.log("\n=== TEST 1 (MANDATORY): First-writer false-oversell is blocked with a specific message, not the generic one ===");
  {
    // No row exists yet for this item/date at all — a cashier is the
    // first person of the day to touch it. total_stock = opening(0) + 0,
    // so any till sale looks like an oversell — but it's really "nobody
    // has logged added stock yet."
    const { status, body } = await api(sarah, "PUT", "/api/stock-entries", {
      entry_date: TODAY,
      item_id: itemId,
      till_quantity_sold: 5,
    });
    check("Rejected with 409", status === 409, { status, body });
    check(
      "Specific 'ask store manager' message, not the generic oversell message",
      body?.error === "Ask the store manager to log today's added stock first.",
      body,
    );

    const row = psql(`select count(*) from stock_entries where item_id = '${itemId}' and entry_date = '${TODAY}';`);
    check("No row was created by the rejected save", row === "0", row);
  }

  console.log("\n=== TEST 2: Store manager logs added stock, then cashier's autosave succeeds ===");
  {
    const addRes = await api(janiffer, "PUT", "/api/stock-entries", {
      entry_date: TODAY,
      item_id: itemId,
      added_stock: 20,
      sent_out: 0,
    });
    check("Store manager's added_stock autosave succeeds (200)", addRes.status === 200, addRes.body);

    const { status, body } = await api(sarah, "PUT", "/api/stock-entries", {
      entry_date: TODAY,
      item_id: itemId,
      till_quantity_sold: 5,
    });
    check("Cashier's autosave now succeeds (200)", status === 200, { status, body });
    check("till_quantity_sold = 5", body?.entry?.till_quantity_sold === 5, body?.entry);
    check("added_stock preserved at 20 (not clobbered)", body?.entry?.added_stock === 20, body?.entry);
    check(
      "closing_stock = opening(0) + added(20) - sold(5) = 15",
      body?.entry?.closing_stock === 15,
      body?.entry,
    );
  }

  console.log("\n=== TEST 3: A second cashier autosave (different quantity) doesn't clobber added_stock/sent_out ===");
  {
    const { status, body } = await api(sarah, "PUT", "/api/stock-entries", {
      entry_date: TODAY,
      item_id: itemId,
      till_quantity_sold: 8,
    });
    check("Second autosave succeeds (200)", status === 200, { status, body });
    check("till_quantity_sold updated to 8", body?.entry?.till_quantity_sold === 8, body?.entry);
    check("added_stock still 20 (still preserved)", body?.entry?.added_stock === 20, body?.entry);
  }

  console.log("\n=== TEST 4 (MANDATORY): Genuine oversell (added_stock > 0, still not enough) keeps the generic message ===");
  {
    const { status, body } = await api(sarah, "PUT", "/api/stock-entries", {
      entry_date: TODAY,
      item_id: itemId,
      till_quantity_sold: 999,
    });
    check("Rejected with 409", status === 409, { status, body });
    check(
      "Generic oversell message (a real oversell, not a first-writer false one)",
      body?.error === "That's more than the available stock available.",
      body,
    );

    const row = psql(
      `select till_quantity_sold, closing_stock from stock_entries where item_id = '${itemId}' and entry_date = '${TODAY}';`,
    );
    check("Row unchanged after rejected oversell (till_quantity_sold still 8)", row === "8.00|12.00", row);
  }

  console.log("\n=== TEST 5 (MANDATORY): Store manager is forbidden from the cashier's own field via this route ===");
  {
    // Janiffer is a store manager — she uses the OTHER branch of this
    // same PUT route (added_stock/sent_out). Sending till_quantity_sold
    // as her should still 400 (schema mismatch: her branch's schema
    // doesn't accept till_quantity_sold), not silently write it.
    const { status, body } = await api(janiffer, "PUT", "/api/stock-entries", {
      entry_date: TODAY,
      item_id: itemId,
      till_quantity_sold: 1,
    });
    check(
      "Store manager sending a cashier-shaped payload is rejected (400, wrong schema for her branch)",
      status === 400,
      { status, body },
    );
  }

  console.log("\n=== TEST 6: Non-restaurant / unauthenticated staff forbidden from the route entirely ===");
  {
    const anne = await login("anne"); // canteen
    const { status } = await api(anne, "PUT", "/api/stock-entries", {
      entry_date: TODAY,
      item_id: itemId,
      till_quantity_sold: 1,
    });
    check("Canteen staff PUT rejected with 403", status === 403, { status });
  }

  console.log("\n=== TEST 7 (MANDATORY): Concurrent first-writer cashier autosaves don't race ===");
  {
    insertItem(raceItemId, `${FIXTURE_NAME} (race)`);
    // Give it real added_stock up front via direct SQL so the race is
    // about the row-locking guarantee, not the first-writer block above.
    psql(
      `insert into stock_entries (item_id, location, entry_date, opening_stock, added_stock, sent_out, till_quantity_sold, quantity_sold, wastage, wastage_note, selling_price_snapshot, buying_price_snapshot, closing_stock, sales_value, cost_value, closing_stock_value, wastage_value, created_by) values ('${raceItemId}', 'restaurant', '${TODAY}', 0, 30, 0, 0, 0, 0, null, 100.00, 50.00, 30, 0, 0, 1500, 0, (select id from users where name = 'Janiffer Maina'));`,
    );

    const [r1, r2] = await Promise.all([
      api(sarah, "PUT", "/api/stock-entries", { entry_date: TODAY, item_id: raceItemId, till_quantity_sold: 10 }),
      api(sarah, "PUT", "/api/stock-entries", { entry_date: TODAY, item_id: raceItemId, till_quantity_sold: 12 }),
    ]);

    check(
      "Both concurrent saves succeed (no false rejection from the row lock)",
      r1.status === 200 && r2.status === 200,
      { r1: r1.status, r2: r2.status, b1: r1.body, b2: r2.body },
    );

    const row = psql(
      `select till_quantity_sold, closing_stock from stock_entries where item_id = '${raceItemId}' and entry_date = '${TODAY}';`,
    );
    check(
      "Row after race is fully consistent (one of the two writes, not corrupted)",
      row === "10.00|20.00" || row === "12.00|18.00",
      row,
    );
  }

  console.log("\n=== TEST 8 (MANDATORY): The same first-writer false-oversell fix applies to the batch POST path ===");
  {
    insertItem(postItemId, `${FIXTURE_NAME} (batch)`);

    const { status, body } = await api(sarah, "POST", "/api/stock-entries", {
      entry_date: TODAY,
      lines: [{ item_id: postItemId, till_quantity_sold: 3 }],
    });
    check("Batch POST rejected with 409", status === 409, { status, body });
    check(
      "Batch POST gives the same specific 'ask store manager' message",
      body?.error === "Ask the store manager to log today's added stock first.",
      body,
    );

    const row = psql(`select count(*) from stock_entries where item_id = '${postItemId}' and entry_date = '${TODAY}';`);
    check("No row was created by the rejected batch save", row === "0", row);
  }

  cleanup();
  summarizeAndExit("Post-launch: /entry cashier autosave");
}

main().catch((err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});
