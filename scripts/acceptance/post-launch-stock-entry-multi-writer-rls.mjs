/**
 * Regression check for a real correctness bug found while manually
 * testing the store-manager /entry screens (2026-07-17, fixed same
 * day): whichever restaurant staffer's write created today's
 * `stock_entries` row for a given item became its sole `created_by`
 * owner, and the old `stock_update_admin_or_current_period_owner`
 * policy's `created_by = auth.uid()` USING clause then blocked every
 * *other* restaurant staffer at the same location from updating that
 * same row for the rest of the day — including the store-manager
 * autosave (`save_stock_entry_store_manager_fields`, PUT
 * /api/stock-entries) and the cashier till-sale batch save
 * (`save_stock_entries_batch`/`save_stock_entry`, POST
 * /api/stock-entries) trying to write the same item/date.
 *
 * That broke the "two writers, one stock figure" invariant in
 * docs/01_DATA_MODEL.md §3.4/§5.5 — the store manager (Janiffer) and
 * any cashier (Sarah/Mercy) are all restaurant staff working the same
 * location's sheet on the same day, and the schema/route design
 * assumes any of them can be the first to touch an item's row.
 *
 * Fixed by `20260717120000_stock_update_location_scoped.sql`, which
 * replaced `stock_update_admin_or_current_period_owner` with a
 * location-scoped policy (`location = my_location()`) instead of a
 * creator-scoped one — matching the INSERT policy's existing logic.
 * This script stays as the permanent regression check.
 *
 * Uses a dedicated fixture item (created and torn down by this script)
 * so it never touches real seed items' entry history.
 */

import { randomUUID } from "node:crypto";
import { login, api, check, summarizeAndExit, psql } from "./_lib.mjs";

const TODAY = new Date().toISOString().slice(0, 10);
const FIXTURE_NAME_A = "[acceptance-test] Multi-Writer Item A";
const FIXTURE_NAME_B = "[acceptance-test] Multi-Writer Item B";
const itemIdA = randomUUID();
const itemIdB = randomUUID();

function cleanup() {
  psql(`delete from stock_entries where item_id in ('${itemIdA}', '${itemIdB}');`);
  psql(`delete from items where id in ('${itemIdA}', '${itemIdB}');`);
}

async function main() {
  cleanup();

  psql(
    `insert into items (id, name, category, supply_type, buying_price, selling_price) values ('${itemIdA}', '${FIXTURE_NAME_A}', 'snacks', 'restaurant_only', 8.00, 15.00);`,
  );
  psql(
    `insert into items (id, name, category, supply_type, buying_price, selling_price) values ('${itemIdB}', '${FIXTURE_NAME_B}', 'snacks', 'restaurant_only', 8.00, 15.00);`,
  );

  const janiffer = await login("janiffer");
  const sarah = await login("sarah");
  const mercy = await login("mercy");

  console.log("\n=== TEST 1: store manager writes first, then cashier tries the same item/day ===");
  {
    const first = await api(janiffer, "PUT", "/api/stock-entries", {
      entry_date: TODAY,
      item_id: itemIdA,
      added_stock: 10,
      sent_out: 0,
    });
    check("Store manager's first autosave succeeds (200)", first.status === 200, first);
    check("added_stock = 10 after store manager's write", first.body?.entry?.added_stock === 10, first.body);

    const second = await api(sarah, "POST", "/api/stock-entries", {
      entry_date: TODAY,
      lines: [{ item_id: itemIdA, till_quantity_sold: 3 }],
    });
    check(
      "Cashier's till sale on the store manager's row succeeds (200 — 10 available, selling 3)",
      second.status === 200,
      second,
    );
  }

  console.log("\n=== TEST 2: cashier writes first (with stock to sell against), then a different cashier tries the same item/day ===");
  {
    const YESTERDAY = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    psql(
      `insert into stock_entries (item_id, location, entry_date, opening_stock, added_stock, sent_out, till_quantity_sold, quantity_sold, wastage, selling_price_snapshot, buying_price_snapshot, closing_stock, sales_value, cost_value, closing_stock_value, wastage_value, created_by) values ('${itemIdB}', 'restaurant', '${YESTERDAY}', 20, 0, 0, 0, 0, 0, 15.00, 8.00, 20, 0, 0, 160, 0, (select id from users where name='Janiffer Maina'));`,
    );

    const first = await api(sarah, "POST", "/api/stock-entries", {
      entry_date: TODAY,
      lines: [{ item_id: itemIdB, till_quantity_sold: 3 }],
    });
    check("Sarah's till sale succeeds (200)", first.status === 200, first);

    const second = await api(mercy, "POST", "/api/stock-entries", {
      entry_date: TODAY,
      lines: [{ item_id: itemIdB, till_quantity_sold: 2 }],
    });
    check(
      "Mercy's till sale on the row Sarah just saved succeeds (200 — 17 still available)",
      second.status === 200,
      second,
    );
  }

  cleanup();
}

main()
  .catch((err) => {
    console.error(err);
    cleanup();
    process.exit(1);
  })
  .then(() => summarizeAndExit("post-launch-stock-entry-multi-writer-rls"));
