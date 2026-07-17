#!/usr/bin/env node
/**
 * Acceptance checks for admin direct ledger-row editing (post-launch,
 * 2026-07-16 — see docs/backlog/04_admin_ledger_edit.md and
 * docs/01_DATA_MODEL.md §3.4's "Admin direct ledger-row edit" note).
 *
 * PATCH /api/dashboard/ledger/entry reuses save_stock_entry()/
 * save_canteen_stock_entry()/save_ingredient_entry() unchanged, so this
 * script doesn't re-verify those functions' own oversell/carry-forward
 * math (already covered by phase4/phase5/phase9 scripts) — it verifies
 * the three things genuinely new to this route:
 *
 * 1. Most-recent-row-only: editing a row with a later dependent row
 *    rejects with 409; editing the actual most-recent row (or a
 *    brand-new "today" row) succeeds and correctly re-derives
 *    closing_stock/closing_stock_value.
 * 2. Price snapshots are provably untouched — captured before, compared
 *    byte-for-byte after, even though the request never sends them.
 * 3. created_by stays the row's original author on an edit, and every
 *    edit writes a stock_entry.admin_edit / ingredient_entry.admin_edit
 *    audit_log entry with before/after quantities and actor = admin
 *    (not the original staffer).
 *
 * Uses a real seeded item (Beef Stew, restaurant_only — avoids
 * canteen_supplied's server-derived added_stock complicating the
 * fixture) and ingredient (Wheat Flour), backdated via direct SQL since
 * the ordinary staff write paths are correctly date-scoped and would
 * reject a backdated save (see scripts/acceptance/README.md's
 * fixture-manufacturing note). Cleans up everything it creates.
 *
 * Prerequisites: local Supabase stack running (`npx supabase status`)
 * and the dev server running (`pnpm dev`).
 *
 * Usage: node scripts/acceptance/post-launch-ledger-admin-edit.mjs
 */

import { api, check, login, psql, summarizeAndExit } from "./_lib.mjs";

const YESTERDAY = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const TODAY = new Date().toISOString().slice(0, 10);
const DAY_BEFORE = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);

function cleanup() {
  psql(
    `delete from stock_entries where item_id = (select id from items where name = 'Beef Stew') and location = 'restaurant' and entry_date in ('${DAY_BEFORE}', '${YESTERDAY}', '${TODAY}');`,
  );
  psql(
    `delete from ingredient_entries where ingredient_id = (select id from ingredients where name = 'Wheat Flour') and entry_date in ('${DAY_BEFORE}', '${YESTERDAY}', '${TODAY}');`,
  );
  psql(`delete from audit_log where action in ('stock_entry.admin_edit', 'ingredient_entry.admin_edit');`);
}

async function main() {
  cleanup();

  const admin = await login("admin");
  const sarah = await login("sarah"); // restaurant staff — original author of the fixture rows
  const janiffer = await login("janiffer"); // store manager — original author of the ingredient fixture

  const itemId = psql(`select id from items where name = 'Beef Stew';`);
  const sarahId = psql(`select id from users where name = 'Sarah Makena';`);
  const ingredientId = psql(`select id from ingredients where name = 'Wheat Flour';`);
  const janifferId = psql(`select id from users where name = 'Janiffer Maina';`);
  const buyingPrice = psql(`select buying_price from items where name = 'Beef Stew';`);
  const sellingPrice = psql(`select selling_price from items where name = 'Beef Stew';`);
  const ingredientBuyingPrice = psql(`select buying_price from ingredients where name = 'Wheat Flour';`);

  // Fixture: yesterday's row (created_by = Sarah, real staff snapshot
  // prices) and today's row already exists too, so editing YESTERDAY's
  // row should be rejected as not-most-recent.
  psql(`
    insert into stock_entries (
      item_id, location, entry_date, opening_stock, added_stock, sent_out,
      till_quantity_sold, quantity_sold, wastage, selling_price_snapshot,
      buying_price_snapshot, closing_stock, sales_value, cost_value,
      closing_stock_value, wastage_value, created_by
    ) values (
      '${itemId}', 'restaurant', '${YESTERDAY}', 0, 20, 0,
      5, 5, 0, ${sellingPrice}, ${buyingPrice}, 15, ${5 * sellingPrice}, ${5 * buyingPrice},
      ${15 * buyingPrice}, 0, '${sarahId}'
    );
  `);
  psql(`
    insert into stock_entries (
      item_id, location, entry_date, opening_stock, added_stock, sent_out,
      till_quantity_sold, quantity_sold, wastage, selling_price_snapshot,
      buying_price_snapshot, closing_stock, sales_value, cost_value,
      closing_stock_value, wastage_value, created_by
    ) values (
      '${itemId}', 'restaurant', '${TODAY}', 15, 0, 0,
      3, 3, 0, ${sellingPrice}, ${buyingPrice}, 12, ${3 * sellingPrice}, ${3 * buyingPrice},
      ${12 * buyingPrice}, 0, '${sarahId}'
    );
  `);

  psql(`
    insert into ingredient_entries (
      ingredient_id, entry_date, opening_stock, received, quantity_used, wastage,
      buying_price_snapshot, closing_stock, closing_stock_value, wastage_value, created_by
    ) values (
      '${ingredientId}', '${YESTERDAY}', 0, 50, 10, 0,
      ${ingredientBuyingPrice}, 40, ${40 * ingredientBuyingPrice}, 0, '${janifferId}'
    );
  `);
  psql(`
    insert into ingredient_entries (
      ingredient_id, entry_date, opening_stock, received, quantity_used, wastage,
      buying_price_snapshot, closing_stock, closing_stock_value, wastage_value, created_by
    ) values (
      '${ingredientId}', '${TODAY}', 40, 0, 8, 0,
      ${ingredientBuyingPrice}, 32, ${32 * ingredientBuyingPrice}, 0, '${janifferId}'
    );
  `);

  console.log("\n=== TEST 1: Editing a non-most-recent stock_entries row is rejected (409) ===");
  {
    const res = await api(admin, "PATCH", "/api/dashboard/ledger/entry", {
      table: "stock_entries",
      item_id: itemId,
      location: "restaurant",
      entry_date: YESTERDAY,
      till_quantity_sold: 99,
      added_stock: 20,
      sent_out: 0,
      wastage: 0,
    });
    check("Rejected with 409", res.status === 409, res);
    check(
      "Clear rejection message mentions editing forward",
      typeof res.body?.error === "string" && res.body.error.toLowerCase().includes("edit forward"),
      res.body,
    );

    const untouched = psql(
      `select till_quantity_sold from stock_entries where item_id = '${itemId}' and location = 'restaurant' and entry_date = '${YESTERDAY}';`,
    );
    check("Yesterday's row was NOT modified by the rejected attempt", Number(untouched) === 5, untouched);
  }

  console.log("\n=== TEST 2: Editing a non-most-recent ingredient_entries row is rejected (409) ===");
  {
    const res = await api(admin, "PATCH", "/api/dashboard/ledger/entry", {
      table: "ingredient_entries",
      ingredient_id: ingredientId,
      entry_date: YESTERDAY,
      received: 99,
      quantity_used: 10,
      wastage: 0,
    });
    check("Rejected with 409", res.status === 409, res);

    const untouched = psql(
      `select received from ingredient_entries where ingredient_id = '${ingredientId}' and entry_date = '${YESTERDAY}';`,
    );
    check("Yesterday's ingredient row was NOT modified", Number(untouched) === 50, untouched);
  }

  console.log("\n=== TEST 3: Editing the actual most-recent stock_entries row succeeds and re-derives correctly ===");
  {
    const before = psql(
      `select selling_price_snapshot, buying_price_snapshot, created_by from stock_entries where item_id = '${itemId}' and location = 'restaurant' and entry_date = '${TODAY}';`,
    );

    const res = await api(admin, "PATCH", "/api/dashboard/ledger/entry", {
      table: "stock_entries",
      item_id: itemId,
      location: "restaurant",
      entry_date: TODAY,
      till_quantity_sold: 7,
      added_stock: 0,
      sent_out: 0,
      wastage: 2,
    });
    check("Edit succeeds (200)", res.status === 200, res);

    // opening_stock (15, carried from yesterday's closing_stock) + added_stock(0)
    // - quantity_sold(7) - wastage(2) = 6
    check("closing_stock re-derived correctly (15 - 7 - 2 = 6)", res.body?.entry?.closing_stock === 6, res.body);
    check(
      "sales_value = quantity_sold * selling_price_snapshot",
      res.body?.entry?.sales_value === 7 * Number(sellingPrice),
      res.body,
    );
    check(
      "wastage_value = wastage * buying_price_snapshot",
      res.body?.entry?.wastage_value === 2 * Number(buyingPrice),
      res.body,
    );

    const after = psql(
      `select selling_price_snapshot, buying_price_snapshot, created_by from stock_entries where item_id = '${itemId}' and location = 'restaurant' and entry_date = '${TODAY}';`,
    );
    check("Price snapshots are byte-for-byte unchanged by the edit", after === before, { before, after });
    check(
      "created_by still Sarah (original author), not reassigned to admin",
      after.split("|")[2] === sarahId,
      after,
    );
  }

  console.log("\n=== TEST 4: Editing the actual most-recent ingredient_entries row succeeds and re-derives correctly ===");
  {
    const before = psql(
      `select buying_price_snapshot, created_by from ingredient_entries where ingredient_id = '${ingredientId}' and entry_date = '${TODAY}';`,
    );

    const res = await api(admin, "PATCH", "/api/dashboard/ledger/entry", {
      table: "ingredient_entries",
      ingredient_id: ingredientId,
      entry_date: TODAY,
      received: 5,
      quantity_used: 10,
      wastage: 1,
    });
    check("Edit succeeds (200)", res.status === 200, res);
    // opening_stock (40) + received(5) - quantity_used(10) - wastage(1) = 34
    check("closing_stock re-derived correctly (40 + 5 - 10 - 1 = 34)", res.body?.entry?.closing_stock === 34, res.body);

    const after = psql(
      `select buying_price_snapshot, created_by from ingredient_entries where ingredient_id = '${ingredientId}' and entry_date = '${TODAY}';`,
    );
    check("Price snapshot is byte-for-byte unchanged by the edit", after === before, { before, after });
    check(
      "created_by still Janiffer (original author), not reassigned to admin",
      after.split("|")[1] === janifferId,
      after,
    );
  }

  console.log("\n=== TEST 5: Every edit writes an audit_log entry with before/after quantities, actor = admin ===");
  {
    const adminId = psql(`select id from users where name = 'WaPrecious';`);

    const stockAudit = psql(
      `select actor_id, changes from audit_log where action = 'stock_entry.admin_edit' and target_id = (select id from stock_entries where item_id = '${itemId}' and location = 'restaurant' and entry_date = '${TODAY}') order by created_at desc limit 1;`,
    );
    const [stockActor, stockChangesRaw] = stockAudit.split("|");
    check("stock_entry.admin_edit actor is the admin, not Sarah", stockActor === adminId, stockAudit);
    const stockChanges = JSON.parse(stockChangesRaw);
    check(
      "stock_entry.admin_edit records the after quantities actually saved",
      stockChanges.after?.till_quantity_sold === 7 && stockChanges.after?.wastage === 2,
      stockChanges,
    );
    check(
      "stock_entry.admin_edit records a before snapshot too",
      stockChanges.before !== null && typeof stockChanges.before === "object",
      stockChanges,
    );

    const ingredientAudit = psql(
      `select actor_id, changes from audit_log where action = 'ingredient_entry.admin_edit' and target_id = (select id from ingredient_entries where ingredient_id = '${ingredientId}' and entry_date = '${TODAY}') order by created_at desc limit 1;`,
    );
    const [ingredientActor, ingredientChangesRaw] = ingredientAudit.split("|");
    check("ingredient_entry.admin_edit actor is the admin, not Janiffer", ingredientActor === adminId, ingredientAudit);
    const ingredientChanges = JSON.parse(ingredientChangesRaw);
    check(
      "ingredient_entry.admin_edit records before/after quantities",
      ingredientChanges.after?.received === 5 && ingredientChanges.after?.quantity_used === 10,
      ingredientChanges,
    );
  }

  console.log("\n=== TEST 6: A brand-new 'today' row (no existing entry) is created via the same edit form ===");
  {
    const newItemId = psql(`select id from items where name = 'Samosa';`); // restaurant_only, untouched fixture
    psql(`delete from stock_entries where item_id = '${newItemId}' and location = 'restaurant' and entry_date = '${TODAY}';`);
    const adminId = psql(`select id from users where name = 'WaPrecious';`);

    const res = await api(admin, "PATCH", "/api/dashboard/ledger/entry", {
      table: "stock_entries",
      item_id: newItemId,
      location: "restaurant",
      entry_date: TODAY,
      till_quantity_sold: 2,
      added_stock: 10,
      sent_out: 0,
      wastage: 0,
    });
    check("Creating today's entry as admin succeeds (200)", res.status === 200, res);
    check(
      "created_by is the admin's own id for a genuinely new row",
      res.body?.entry?.created_by === adminId,
      res.body,
    );

    psql(`delete from stock_entries where item_id = '${newItemId}' and location = 'restaurant' and entry_date = '${TODAY}';`);
  }

  console.log(
    "\n=== TEST 7: Admin can log a brand-new ingredient_entries row (docs/backlog/07_admin_ux_sweep.md item 6, Ledger's 'New entry') ===",
  );
  {
    const newIngredientId = psql(`select id from ingredients where name = 'Rice';`); // untouched fixture ingredient
    psql(`delete from ingredient_entries where ingredient_id = '${newIngredientId}' and entry_date = '${TODAY}';`);
    const adminId = psql(`select id from users where name = 'WaPrecious';`);
    const riceBuyingPrice = psql(`select buying_price from ingredients where name = 'Rice';`);

    const res = await api(admin, "PATCH", "/api/dashboard/ledger/entry", {
      table: "ingredient_entries",
      ingredient_id: newIngredientId,
      entry_date: TODAY,
      received: 25,
      quantity_used: 4,
      wastage: 1,
    });
    check("Creating a new ingredient entry as admin succeeds (200)", res.status === 200, res);
    check(
      "created_by is the admin's own id for a genuinely new row (no prior author to preserve)",
      res.body?.entry?.created_by === adminId,
      res.body,
    );
    // opening_stock (0, no prior row) + received(25) - quantity_used(4) - wastage(1) = 20
    check("closing_stock derived correctly (0 + 25 - 4 - 1 = 20)", res.body?.entry?.closing_stock === 20, res.body);
    check(
      "buying_price_snapshot pulled from the current ingredient catalog, not left null/zero",
      res.body?.entry?.buying_price_snapshot === Number(riceBuyingPrice),
      res.body,
    );

    const audit = psql(
      `select actor_id, changes from audit_log where action = 'ingredient_entry.admin_edit' and target_id = '${res.body?.entry?.id}' order by created_at desc limit 1;`,
    );
    const [auditActor, auditChangesRaw] = audit.split("|");
    check("New-entry creation also writes an audit_log entry, actor = admin", auditActor === adminId, audit);
    const auditChanges = JSON.parse(auditChangesRaw);
    check(
      "Audit entry's before is null (nothing existed prior) and after matches what was saved",
      auditChanges.before === null && auditChanges.after?.received === 25,
      auditChanges,
    );

    psql(`delete from ingredient_entries where ingredient_id = '${newIngredientId}' and entry_date = '${TODAY}';`);
    psql(`delete from audit_log where action = 'ingredient_entry.admin_edit' and target_id = '${res.body?.entry?.id}';`);
  }

  cleanup();
  const stockLeftover = psql(
    `select count(*) from stock_entries where item_id = '${itemId}' and location = 'restaurant' and entry_date in ('${YESTERDAY}', '${TODAY}');`,
  );
  const ingredientLeftover = psql(
    `select count(*) from ingredient_entries where ingredient_id = '${ingredientId}' and entry_date in ('${YESTERDAY}', '${TODAY}');`,
  );
  check("Fixture rows cleaned up", stockLeftover === "0" && ingredientLeftover === "0", {
    stockLeftover,
    ingredientLeftover,
  });

  summarizeAndExit("Admin ledger-row edit (post-launch)");
}

main().catch((err) => {
  cleanup();
  console.error(err);
  process.exit(1);
});
