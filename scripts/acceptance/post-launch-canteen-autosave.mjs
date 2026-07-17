/**
 * Acceptance checks for /entry's canteen per-field autosave redesign
 * (post-launch, 2026-07-17 — see docs/01_DATA_MODEL.md §3.4's canteen
 * autosave writer, the sixth writer of stock_entries).
 *
 * Covers PUT /api/stock-entries's canteen branch (putCanteenField(),
 * calling save_stock_entry_canteen_field() —
 * 20260717140000_stock_entry_canteen_autosave.sql): happy-path autosave
 * for both fields (quantity_sold on every item, added_stock on
 * canteen_independent items only), week-Monday date normalization, RBAC
 * (canteen-only route branch), the row-locking concurrent-first-writer
 * race, and the TWO DISTINCT rejection cases resolved this session:
 *   1. canteen_supplied item, added_stock genuinely 0 (restaurant hasn't
 *      sent this week's supply yet) -> a specifically-diagnosed message,
 *      distinct from a generic oversell.
 *   2. canteen_independent item, real oversell (Anne owns both fields
 *      herself for these) -> keeps the existing generic message.
 * Uses dedicated fixture items (created and torn down by this script) so
 * it never touches real seed items' entry history.
 */

import { randomUUID } from "node:crypto";
import { login, api, check, summarizeAndExit, psql } from "./_lib.mjs";

function mondayOf(date) {
  const d = new Date(date.getTime());
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

const TODAY = new Date();
const WEEK_START = mondayOf(TODAY);
// A non-Monday date in the same week, to prove the route normalizes it.
const MID_WEEK = (() => {
  const d = new Date(`${WEEK_START}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 3);
  return d.toISOString().slice(0, 10);
})();

const FIXTURE_NAME = "[acceptance-test] Canteen Autosave Item";
const suppliedItemId = randomUUID();
const independentItemId = randomUUID();
const raceItemId = randomUUID();

function cleanup() {
  psql(
    `delete from stock_entries where item_id in ('${suppliedItemId}', '${independentItemId}', '${raceItemId}');`,
  );
  psql(`delete from items where id in ('${suppliedItemId}', '${independentItemId}', '${raceItemId}');`);
}

function insertItem(id, name, supplyType) {
  psql(
    `insert into items (id, name, category, supply_type, buying_price, selling_price, low_stock_threshold) values ('${id}', '${name}', 'meals', '${supplyType}', 50.00, 100.00, 5);`,
  );
}

async function main() {
  cleanup();

  insertItem(suppliedItemId, `${FIXTURE_NAME} (supplied)`, "canteen_supplied");
  insertItem(independentItemId, `${FIXTURE_NAME} (independent)`, "canteen_independent");
  const createdCheck = psql(
    `select count(*) from items where id in ('${suppliedItemId}', '${independentItemId}');`,
  );
  check("Fixture items created", createdCheck === "2", createdCheck);

  const anne = await login("anne"); // canteen
  const sarah = await login("sarah"); // restaurant, cashier

  console.log("\n=== TEST 1 (MANDATORY): canteen_supplied item, nothing sent this week -> specific 'not yet supplied' message ===");
  {
    // No restaurant sent_out rows exist for this fixture item at all, so
    // canteen_supplied_total() = 0. total_stock = opening(0) + 0, so any
    // till sale looks like an oversell — but it's really "the restaurant
    // hasn't sent this week's supply yet," not Anne's fault.
    const { status, body } = await api(anne, "PUT", "/api/stock-entries", {
      entry_date: WEEK_START,
      item_id: suppliedItemId,
      till_quantity_sold: 5,
    });
    check("Rejected with 409", status === 409, { status, body });
    check(
      "Specific 'restaurant hasn't sent supply' message, not the generic oversell message",
      body?.error === "The restaurant hasn't sent this week's supply yet for this item.",
      body,
    );

    const row = psql(
      `select count(*) from stock_entries where item_id = '${suppliedItemId}' and entry_date = '${WEEK_START}';`,
    );
    check("No row was created by the rejected save", row === "0", row);
  }

  console.log("\n=== TEST 2: Restaurant sends supply this week, then Anne's quantity_sold autosave succeeds ===");
  {
    // Simulate the restaurant having sent 20 units on one day this week
    // via a direct fixture row (a real restaurant stock_entries row with
    // sent_out=20), which canteen_supplied_total() sums.
    psql(
      `insert into stock_entries (item_id, location, entry_date, opening_stock, added_stock, sent_out, till_quantity_sold, quantity_sold, wastage, wastage_note, selling_price_snapshot, buying_price_snapshot, closing_stock, sales_value, cost_value, closing_stock_value, wastage_value, created_by) values ('${suppliedItemId}', 'restaurant', '${WEEK_START}', 0, 20, 20, 0, 0, 0, null, 100.00, 50.00, 0, 0, 0, 0, 0, (select id from users where name = 'Janiffer Maina'));`,
    );

    const { status, body } = await api(anne, "PUT", "/api/stock-entries", {
      entry_date: WEEK_START,
      item_id: suppliedItemId,
      till_quantity_sold: 5,
    });
    check("Canteen's quantity_sold autosave now succeeds (200)", status === 200, { status, body });
    check("till_quantity_sold = 5", body?.entry?.till_quantity_sold === 5, body?.entry);
    check("added_stock derived from canteen_supplied_total() = 20", body?.entry?.added_stock === 20, body?.entry);
    check(
      "closing_stock = opening(0) + added(20) - sold(5) = 15",
      body?.entry?.closing_stock === 15,
      body?.entry,
    );
  }

  console.log("\n=== TEST 3: A second quantity_sold autosave on the supplied item doesn't clobber the derived added_stock ===");
  {
    const { status, body } = await api(anne, "PUT", "/api/stock-entries", {
      entry_date: WEEK_START,
      item_id: suppliedItemId,
      till_quantity_sold: 8,
    });
    check("Second autosave succeeds (200)", status === 200, { status, body });
    check("till_quantity_sold updated to 8", body?.entry?.till_quantity_sold === 8, body?.entry);
    check("added_stock still 20 (still derived, not clobbered)", body?.entry?.added_stock === 20, body?.entry);
  }

  console.log("\n=== TEST 4: canteen_independent item — Anne's added_stock autosave, then quantity_sold autosave, neither clobbers the other ===");
  {
    const addRes = await api(anne, "PUT", "/api/stock-entries", {
      entry_date: WEEK_START,
      item_id: independentItemId,
      added_stock: 15,
    });
    check("added_stock autosave succeeds (200)", addRes.status === 200, addRes.body);
    check("added_stock = 15", addRes.body?.entry?.added_stock === 15, addRes.body?.entry);

    const soldRes = await api(anne, "PUT", "/api/stock-entries", {
      entry_date: WEEK_START,
      item_id: independentItemId,
      till_quantity_sold: 4,
    });
    check("quantity_sold autosave succeeds (200)", soldRes.status === 200, soldRes.body);
    check("till_quantity_sold = 4", soldRes.body?.entry?.till_quantity_sold === 4, soldRes.body?.entry);
    check(
      "added_stock preserved at 15 (not clobbered by the quantity_sold-only call)",
      soldRes.body?.entry?.added_stock === 15,
      soldRes.body?.entry,
    );
  }

  console.log("\n=== TEST 5 (MANDATORY): canteen_independent item, genuine oversell keeps the generic message ===");
  {
    const { status, body } = await api(anne, "PUT", "/api/stock-entries", {
      entry_date: WEEK_START,
      item_id: independentItemId,
      till_quantity_sold: 999,
    });
    check("Rejected with 409", status === 409, { status, body });
    check(
      "Generic oversell message (Anne owns both fields herself here — a real oversell)",
      body?.error === "That's more than the available stock available.",
      body,
    );

    const row = psql(
      `select till_quantity_sold, added_stock from stock_entries where item_id = '${independentItemId}' and entry_date = '${WEEK_START}';`,
    );
    check("Row unchanged after rejected oversell", row === "4.00|15.00", row);
  }

  console.log("\n=== TEST 6: entry_date is normalized to the week's Monday, not trusted verbatim from the client ===");
  {
    const { status, body } = await api(anne, "PUT", "/api/stock-entries", {
      entry_date: MID_WEEK,
      item_id: independentItemId,
      till_quantity_sold: 6,
    });
    check("Mid-week date accepted, normalized (200)", status === 200, { status, body });
    check("Row's entry_date is the week's Monday, not the mid-week date sent", body?.entry?.entry_date === WEEK_START, body?.entry);

    const rowCount = psql(
      `select count(*) from stock_entries where item_id = '${independentItemId}';`,
    );
    check("Still exactly one row for this item (no stray mid-week row created)", rowCount === "1", rowCount);
  }

  console.log("\n=== TEST 7 (MANDATORY): Restaurant staff never reach the canteen branch — PUT dispatch is keyed on the caller's own location ===");
  {
    // Sarah is restaurant, non-store-manager, so PUT /api/stock-entries
    // routes her to putCashierField() regardless of which item_id she
    // sends — she can never reach putCanteenField() at all, since
    // dispatch happens on `user.location`, not on the item's supply_type.
    // (A canteen-only item has no restaurant-location stock_entries row
    // and no restaurant-side added_stock, so her write is rejected by the
    // oversell check on the restaurant branch she's actually dispatched
    // to — not a 403, since this route has no item-location eligibility
    // check today; that's a pre-existing gap in the restaurant PUT
    // branches, out of scope for this canteen-only redesign.)
    const { status, body } = await api(sarah, "PUT", "/api/stock-entries", {
      entry_date: WEEK_START,
      item_id: independentItemId,
      till_quantity_sold: 1,
    });
    check(
      "Restaurant staff's write goes through the restaurant cashier branch, not the canteen one (rejected here as an oversell against a nonexistent restaurant-location row)",
      status === 409,
      { status, body },
    );
  }

  console.log("\n=== TEST 8: Schema requires exactly one of till_quantity_sold/added_stock ===");
  {
    const { status, body } = await api(anne, "PUT", "/api/stock-entries", {
      entry_date: WEEK_START,
      item_id: independentItemId,
    });
    check("Neither field provided -> 400", status === 400, { status, body });
  }

  console.log("\n=== TEST 9 (MANDATORY): Concurrent first-writer canteen autosaves don't race ===");
  {
    insertItem(raceItemId, `${FIXTURE_NAME} (race)`, "canteen_independent");
    // Give it real added_stock up front via direct SQL so the race is
    // about the row-locking guarantee, not the first-writer block above.
    psql(
      `insert into stock_entries (item_id, location, entry_date, opening_stock, added_stock, sent_out, till_quantity_sold, quantity_sold, wastage, wastage_note, selling_price_snapshot, buying_price_snapshot, closing_stock, sales_value, cost_value, closing_stock_value, wastage_value, created_by) values ('${raceItemId}', 'canteen', '${WEEK_START}', 0, 30, 0, 0, 0, 0, null, 100.00, 50.00, 30, 0, 0, 1500, 0, (select id from users where name = 'Anne Gitonga'));`,
    );

    const [r1, r2] = await Promise.all([
      api(anne, "PUT", "/api/stock-entries", { entry_date: WEEK_START, item_id: raceItemId, till_quantity_sold: 10 }),
      api(anne, "PUT", "/api/stock-entries", { entry_date: WEEK_START, item_id: raceItemId, till_quantity_sold: 12 }),
    ]);

    check(
      "Both concurrent saves succeed (no false rejection from the row lock)",
      r1.status === 200 && r2.status === 200,
      { r1: r1.status, r2: r2.status, b1: r1.body, b2: r2.body },
    );

    const row = psql(
      `select till_quantity_sold, closing_stock from stock_entries where item_id = '${raceItemId}' and entry_date = '${WEEK_START}';`,
    );
    check(
      "Row after race is fully consistent (one of the two writes, not corrupted)",
      row === "10.00|20.00" || row === "12.00|18.00",
      row,
    );
  }

  cleanup();
  summarizeAndExit("Post-launch: /entry canteen autosave");
}

main().catch((err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});
