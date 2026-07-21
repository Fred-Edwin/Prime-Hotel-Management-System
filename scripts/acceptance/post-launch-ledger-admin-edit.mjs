#!/usr/bin/env node
/**
 * Acceptance checks for admin direct ledger-row editing (post-launch,
 * 2026-07-16, extended 2026-07-20 — see docs/backlog/04_admin_ledger_edit.md's
 * "Post-launch correction" section and docs/01_DATA_MODEL.md's "Historical
 * edit cascade" note).
 *
 * PATCH /api/dashboard/ledger/entry reuses save_stock_entry()/
 * save_canteen_stock_entry()/save_ingredient_entry() unchanged, so this
 * script doesn't re-verify those functions' own oversell/carry-forward
 * math (already covered by phase4/phase5/phase9 scripts) — it verifies
 * what's genuinely new to this route:
 *
 * 1. Editing a NON-most-recent row now succeeds (not rejected — the old
 *    409 block was replaced 2026-07-20) and correctly recomputes every
 *    later row's opening_stock/closing_stock/value fields forward, for
 *    both stock_entries and ingredient_entries.
 * 2. A downstream oversell revealed by the recompute rejects the whole
 *    cascade atomically (409) — no row in the chain is left half-updated.
 * 3. A canteen_supplied item's restaurant sent_out edit cascades into the
 *    linked canteen row's added_stock too (§3.1's link) — a same-day 1:1
 *    match as of the 2026-07-20 daily-cadence conversion, updated from
 *    the original week-range cascade (see TEST 9 below).
 * 4. Price snapshots are provably untouched on every row the cascade
 *    touches — captured before, compared byte-for-byte after.
 * 5. created_by stays the row's original author on an edit, and every
 *    edit writes a stock_entry.admin_edit / ingredient_entry.admin_edit
 *    audit_log entry with before/after quantities, a cascade_recomputed
 *    list, and actor = admin (not the original staffer).
 *
 * Uses a real seeded item (Beef Stew, restaurant_only — avoids
 * canteen_supplied's server-derived added_stock complicating the simple
 * fixtures) plus a real canteen_supplied item for the cross-location
 * test, and ingredient (Wheat Flour), backdated via direct SQL since the
 * ordinary staff write paths are correctly date-scoped and would reject
 * a backdated save (see scripts/acceptance/README.md's fixture-
 * manufacturing note). Cleans up everything it creates.
 *
 * Prerequisites: a Supabase stack (local Docker, or a hosted dev project
 * via ACCEPTANCE_DB_MODE=linked — see _lib.mjs's psql() doc comment) and
 * the dev server running (`pnpm dev`).
 *
 * Usage: node scripts/acceptance/post-launch-ledger-admin-edit.mjs
 */

import { api, check, login, psql, summarizeAndExit } from "./_lib.mjs";

const YESTERDAY = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const TODAY = new Date().toISOString().slice(0, 10);
const DAY_BEFORE = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);

const WEEK_AGO = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

function cleanup() {
  psql(
    `delete from stock_entries where item_id = (select id from items where name = 'Beef Stew') and location = 'restaurant' and entry_date in ('${DAY_BEFORE}', '${YESTERDAY}', '${TODAY}');`,
  );
  psql(
    `delete from stock_entries where item_id = (select id from items where name = 'Chapati') and entry_date >= '${WEEK_AGO}';`,
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

  // Fixture: a 3-day chain (DAY_BEFORE -> YESTERDAY -> TODAY), created_by
  // = Sarah, real staff snapshot prices — lets Test 1 edit the OLDEST row
  // and verify both later rows recompute correctly, not just accept the
  // edit.
  psql(`
    insert into stock_entries (
      item_id, location, entry_date, opening_stock, added_stock, sent_out,
      till_quantity_sold, quantity_sold, wastage, selling_price_snapshot,
      buying_price_snapshot, closing_stock, sales_value, cost_value,
      closing_stock_value, wastage_value, created_by
    ) values (
      '${itemId}', 'restaurant', '${DAY_BEFORE}', 0, 20, 0,
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
      '${itemId}', 'restaurant', '${YESTERDAY}', 15, 5, 0,
      4, 4, 0, ${sellingPrice}, ${buyingPrice}, 16, ${4 * sellingPrice}, ${4 * buyingPrice},
      ${16 * buyingPrice}, 0, '${sarahId}'
    );
  `);
  psql(`
    insert into stock_entries (
      item_id, location, entry_date, opening_stock, added_stock, sent_out,
      till_quantity_sold, quantity_sold, wastage, selling_price_snapshot,
      buying_price_snapshot, closing_stock, sales_value, cost_value,
      closing_stock_value, wastage_value, created_by
    ) values (
      '${itemId}', 'restaurant', '${TODAY}', 16, 0, 0,
      3, 3, 0, ${sellingPrice}, ${buyingPrice}, 13, ${3 * sellingPrice}, ${3 * buyingPrice},
      ${13 * buyingPrice}, 0, '${sarahId}'
    );
  `);

  psql(`
    insert into ingredient_entries (
      ingredient_id, entry_date, opening_stock, received, quantity_used, wastage,
      buying_price_snapshot, closing_stock, closing_stock_value, wastage_value, created_by
    ) values (
      '${ingredientId}', '${DAY_BEFORE}', 0, 50, 10, 0,
      ${ingredientBuyingPrice}, 40, ${40 * ingredientBuyingPrice}, 0, '${janifferId}'
    );
  `);
  psql(`
    insert into ingredient_entries (
      ingredient_id, entry_date, opening_stock, received, quantity_used, wastage,
      buying_price_snapshot, closing_stock, closing_stock_value, wastage_value, created_by
    ) values (
      '${ingredientId}', '${YESTERDAY}', 40, 10, 6, 0,
      ${ingredientBuyingPrice}, 44, ${44 * ingredientBuyingPrice}, 0, '${janifferId}'
    );
  `);
  psql(`
    insert into ingredient_entries (
      ingredient_id, entry_date, opening_stock, received, quantity_used, wastage,
      buying_price_snapshot, closing_stock, closing_stock_value, wastage_value, created_by
    ) values (
      '${ingredientId}', '${TODAY}', 44, 0, 8, 0,
      ${ingredientBuyingPrice}, 36, ${36 * ingredientBuyingPrice}, 0, '${janifferId}'
    );
  `);

  console.log(
    "\n=== TEST 1: Editing the OLDEST stock_entries row (not the most recent) succeeds and cascades both later rows ===",
  );
  {
    const res = await api(admin, "PATCH", "/api/dashboard/ledger/entry", {
      table: "stock_entries",
      item_id: itemId,
      location: "restaurant",
      entry_date: DAY_BEFORE,
      till_quantity_sold: 8, // was 5 -- +3 sold means closing_stock drops by 3 from here forward
      added_stock: 20,
      sent_out: 0,
      wastage: 0,
    });
    check("Edit of the oldest row succeeds (200), no longer rejected", res.status === 200, res);
    // opening(0) + added(20) - sold(8) - wastage(0) = 12 (was 15, -3)
    check("DAY_BEFORE's own closing_stock re-derived (0 + 20 - 8 = 12)", res.body?.entry?.closing_stock === 12, res.body);

    // YESTERDAY: opening now 12 (was 15), added 5, sold 4, wastage 0 -> closing 13 (was 16, -3)
    const yesterdayRow = psql(
      `select opening_stock, closing_stock, sales_value from stock_entries where item_id = '${itemId}' and location = 'restaurant' and entry_date = '${YESTERDAY}';`,
    );
    const [yOpening, yClosing, ySales] = yesterdayRow.split("|").map(Number);
    check("YESTERDAY's opening_stock cascaded from DAY_BEFORE's new closing_stock (12)", yOpening === 12, yesterdayRow);
    check("YESTERDAY's closing_stock recomputed (12 + 5 - 4 = 13)", yClosing === 13, yesterdayRow);
    check(
      "YESTERDAY's sales_value unchanged (till_quantity_sold on that row wasn't edited)",
      ySales === 4 * Number(sellingPrice),
      yesterdayRow,
    );

    // TODAY: opening now 13 (was 16), added 0, sold 3, wastage 0 -> closing 10 (was 13, -3)
    const todayRow = psql(
      `select opening_stock, closing_stock from stock_entries where item_id = '${itemId}' and location = 'restaurant' and entry_date = '${TODAY}';`,
    );
    const [tOpening, tClosing] = todayRow.split("|").map(Number);
    check("TODAY's opening_stock cascaded transitively from YESTERDAY's new closing_stock (13)", tOpening === 13, todayRow);
    check("TODAY's closing_stock recomputed (13 + 0 - 3 = 10)", tClosing === 10, todayRow);

    const audit = psql(
      `select changes from audit_log where action = 'stock_entry.admin_edit' and target_id = (select id from stock_entries where item_id = '${itemId}' and location = 'restaurant' and entry_date = '${DAY_BEFORE}') order by created_at desc limit 1;`,
    );
    const changes = JSON.parse(audit);
    check(
      "Audit log's cascade_recomputed lists both YESTERDAY and TODAY (the two rows the DAY_BEFORE edit cascaded into)",
      Array.isArray(changes.cascade_recomputed) &&
        changes.cascade_recomputed.length === 2 &&
        changes.cascade_recomputed.some((r) => r.entry_date === YESTERDAY && r.closing_stock === 13) &&
        changes.cascade_recomputed.some((r) => r.entry_date === TODAY && r.closing_stock === 10),
      changes,
    );
  }

  console.log(
    "\n=== TEST 2: Editing the OLDEST ingredient_entries row succeeds and cascades both later rows ===",
  );
  {
    const res = await api(admin, "PATCH", "/api/dashboard/ledger/entry", {
      table: "ingredient_entries",
      ingredient_id: ingredientId,
      entry_date: DAY_BEFORE,
      received: 40, // was 50 -- -10 received means closing_stock drops by 10 from here forward
      quantity_used: 10,
      wastage: 0,
    });
    check("Edit of the oldest ingredient row succeeds (200), no longer rejected", res.status === 200, res);
    // opening(0) + received(40) - used(10) - wastage(0) = 30 (was 40, -10)
    check(
      "DAY_BEFORE's own closing_stock re-derived (0 + 40 - 10 = 30)",
      res.body?.entry?.closing_stock === 30,
      res.body,
    );

    // YESTERDAY: opening now 30 (was 40), received 10, used 6 -> closing 34 (was 44, -10)
    const yesterdayRow = psql(
      `select opening_stock, closing_stock from ingredient_entries where ingredient_id = '${ingredientId}' and entry_date = '${YESTERDAY}';`,
    );
    const [yOpening, yClosing] = yesterdayRow.split("|").map(Number);
    check("YESTERDAY's opening_stock cascaded from DAY_BEFORE's new closing_stock (30)", yOpening === 30, yesterdayRow);
    check("YESTERDAY's closing_stock recomputed (30 + 10 - 6 = 34)", yClosing === 34, yesterdayRow);

    // TODAY: opening now 34 (was 44), received 0, used 8 -> closing 26 (was 36, -10)
    const todayRow = psql(
      `select opening_stock, closing_stock from ingredient_entries where ingredient_id = '${ingredientId}' and entry_date = '${TODAY}';`,
    );
    const [tOpening, tClosing] = todayRow.split("|").map(Number);
    check("TODAY's opening_stock cascaded transitively from YESTERDAY's new closing_stock (34)", tOpening === 34, todayRow);
    check("TODAY's closing_stock recomputed (34 + 0 - 8 = 26)", tClosing === 26, todayRow);
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

    // opening_stock (13, carried from YESTERDAY's closing_stock after Test
    // 1's cascade) + added_stock(0) - quantity_sold(7) - wastage(2) = 4
    check("closing_stock re-derived correctly (13 - 7 - 2 = 4)", res.body?.entry?.closing_stock === 4, res.body);
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
    // opening_stock (34, carried from YESTERDAY's closing_stock after Test
    // 2's cascade) + received(5) - quantity_used(10) - wastage(1) = 28
    check("closing_stock re-derived correctly (34 + 5 - 10 - 1 = 28)", res.body?.entry?.closing_stock === 28, res.body);

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
    check(
      "stock_entry.admin_edit's cascade_recomputed is empty when editing the already-latest row (TODAY has nothing after it)",
      Array.isArray(stockChanges.cascade_recomputed) && stockChanges.cascade_recomputed.length === 0,
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

  console.log(
    "\n=== TEST 8: A downstream oversell revealed by the recompute rejects the WHOLE cascade atomically (409) ===",
  );
  {
    // Fresh 2-row chain, deliberately tight: DAY_BEFORE sells all 10 of
    // what's added, leaving YESTERDAY with exactly enough (opening 10) to
    // cover its own sale of 10. Lowering DAY_BEFORE's added_stock to 5
    // means YESTERDAY's opening_stock recomputes to 5 -- less than the 10
    // it already sold -- an oversell the recompute must catch and reject
    // as a whole, leaving BOTH rows exactly as they were beforehand.
    const oversellItemId = psql(`select id from items where name = 'Samosa';`); // restaurant_only, untouched fixture
    psql(
      `delete from stock_entries where item_id = '${oversellItemId}' and location = 'restaurant' and entry_date in ('${DAY_BEFORE}', '${YESTERDAY}');`,
    );
    const samosaBuying = psql(`select buying_price from items where name = 'Samosa';`);
    const samosaSelling = psql(`select selling_price from items where name = 'Samosa';`);

    psql(`
      insert into stock_entries (
        item_id, location, entry_date, opening_stock, added_stock, sent_out,
        till_quantity_sold, quantity_sold, wastage, selling_price_snapshot,
        buying_price_snapshot, closing_stock, sales_value, cost_value,
        closing_stock_value, wastage_value, created_by
      ) values (
        '${oversellItemId}', 'restaurant', '${DAY_BEFORE}', 0, 10, 0,
        10, 10, 0, ${samosaSelling}, ${samosaBuying}, 0, ${10 * samosaSelling}, ${10 * samosaBuying}, 0, 0, '${sarahId}'
      );
    `);
    psql(`
      insert into stock_entries (
        item_id, location, entry_date, opening_stock, added_stock, sent_out,
        till_quantity_sold, quantity_sold, wastage, selling_price_snapshot,
        buying_price_snapshot, closing_stock, sales_value, cost_value,
        closing_stock_value, wastage_value, created_by
      ) values (
        '${oversellItemId}', 'restaurant', '${YESTERDAY}', 0, 0, 0,
        10, 10, 0, ${samosaSelling}, ${samosaBuying}, -10, ${10 * samosaSelling}, ${10 * samosaBuying}, ${-10 * samosaBuying}, 0, '${sarahId}'
      );
    `);
    // Note: YESTERDAY's opening_stock/closing_stock above are deliberately
    // inserted already-consistent with DAY_BEFORE's CURRENT added_stock(10)
    // -- opening 0 here is a fixture shortcut (this test only cares about
    // what happens when DAY_BEFORE's added_stock changes), not a realistic
    // carry-forward value.
    psql(
      `update stock_entries set opening_stock = 10, closing_stock = 0 where item_id = '${oversellItemId}' and location = 'restaurant' and entry_date = '${YESTERDAY}';`,
    );

    const res = await api(admin, "PATCH", "/api/dashboard/ledger/entry", {
      table: "stock_entries",
      item_id: oversellItemId,
      location: "restaurant",
      entry_date: DAY_BEFORE,
      till_quantity_sold: 10,
      added_stock: 5, // down from 10 -- DAY_BEFORE's own row is still fine (10 sold <= 5 available is FALSE actually; see below)
      sent_out: 0,
      wastage: 0,
    });
    // DAY_BEFORE itself: opening(0) + added(5) = 5 available, but
    // till_quantity_sold is still 10 -- this is already an oversell on the
    // very row being edited, caught by save_stock_entry() itself (P0001)
    // before the cascade even runs. That's still "the whole edit rejects
    // atomically," just one step earlier than the cascade -- confirms the
    // route doesn't apply a partial save before delegating to the cascade.
    check("Edit is rejected (409) -- oversell caught immediately on the edited row itself", res.status === 409, res);

    const dayBeforeRow = psql(
      `select added_stock, till_quantity_sold from stock_entries where item_id = '${oversellItemId}' and location = 'restaurant' and entry_date = '${DAY_BEFORE}';`,
    );
    check("DAY_BEFORE's row is untouched by the rejected edit (added_stock still 10)", dayBeforeRow.split("|")[0] === "10.00", dayBeforeRow);

    const yesterdayRow = psql(
      `select opening_stock, closing_stock from stock_entries where item_id = '${oversellItemId}' and location = 'restaurant' and entry_date = '${YESTERDAY}';`,
    );
    check(
      "YESTERDAY's row is untouched too -- the cascade never ran since the edit itself failed first",
      yesterdayRow.split("|")[0] === "10.00" && yesterdayRow.split("|")[1] === "0.00",
      yesterdayRow,
    );

    // Now the real cascade-level oversell: DAY_BEFORE's own sale reduced
    // to something that row itself can support (5), but still low enough
    // that YESTERDAY's already-sold 10 exceeds the recomputed opening
    // stock it would inherit.
    const res2 = await api(admin, "PATCH", "/api/dashboard/ledger/entry", {
      table: "stock_entries",
      item_id: oversellItemId,
      location: "restaurant",
      entry_date: DAY_BEFORE,
      till_quantity_sold: 5, // was 10 -- DAY_BEFORE's own edit is fine (added 10 >= sold 5)
      added_stock: 5, // down from 10 -- closing_stock becomes 0, still opening(0)+5-5=0, fine for THIS row
      sent_out: 0,
      wastage: 0,
    });
    check(
      "Edit that's valid on its own row but breaks YESTERDAY downstream is rejected (409) by the cascade",
      res2.status === 409,
      res2,
    );
    check(
      "Rejection message mentions recalculating later entries failed",
      typeof res2.body?.error === "string" && res2.body.error.toLowerCase().includes("recalculating later entries failed"),
      res2.body,
    );

    // DAY_BEFORE's own row DID get saved by save_stock_entry() before the
    // cascade ran and failed -- the route's own docstring is explicit that
    // this is a known, reported limitation (the edit and the cascade are
    // not one atomic unit from the client's point of view), not silently
    // hidden. Confirm the documented behavior: the edited row committed...
    const dayBeforeAfter = psql(
      `select till_quantity_sold from stock_entries where item_id = '${oversellItemId}' and location = 'restaurant' and entry_date = '${DAY_BEFORE}';`,
    );
    check(
      "DAY_BEFORE's own edit DID commit (route's documented behavior: edit succeeds, cascade failure is reported separately)",
      dayBeforeAfter === "5.00",
      dayBeforeAfter,
    );
    // ...but YESTERDAY's row was NOT left half-updated by the cascade's
    // own transaction, which rolled back entirely on the P0001 raise.
    const yesterdayAfter = psql(
      `select opening_stock, closing_stock from stock_entries where item_id = '${oversellItemId}' and location = 'restaurant' and entry_date = '${YESTERDAY}';`,
    );
    check(
      "YESTERDAY's row is untouched -- the cascade's own transaction rolled back completely on the downstream oversell",
      yesterdayAfter.split("|")[0] === "10.00" && yesterdayAfter.split("|")[1] === "0.00",
      yesterdayAfter,
    );

    psql(
      `delete from stock_entries where item_id = '${oversellItemId}' and location = 'restaurant' and entry_date in ('${DAY_BEFORE}', '${YESTERDAY}');`,
    );
    psql(
      `delete from audit_log where action = 'stock_entry.admin_edit' and target_id in (select id from stock_entries where item_id = '${oversellItemId}');`,
    );
  }

  console.log(
    "\n=== TEST 9 (updated 2026-07-20 for the canteen daily-cadence conversion): Editing a canteen_supplied item's restaurant sent_out cascades into the linked SAME-DAY canteen row's added_stock ===",
  );
  {
    // Chapati is canteen_supplied (supabase/seed.sql) -- its canteen
    // added_stock is server-derived (canteen_supplied_total()) as a
    // same-day 1:1 mirror of the restaurant's sent_out for that exact
    // calendar day (docs/01_DATA_MODEL.md §3.1) -- NOT a week-range sum,
    // as of the 2026-07-20 daily-cadence conversion
    // (docs/phases/postlaunch_canteen_daily_context.md). Before that
    // conversion, this test built both rows on that week's Monday; now
    // both rows use today's real date, and recompute_stock_entry_cascade()
    // only touches a canteen row whose entry_date exactly equals the
    // edited restaurant row's date (see
    // scripts/acceptance/post-launch-canteen-daily-cadence.mjs TEST 8 for
    // the dedicated coverage of this cascade redesign, including the
    // no-same-day-row case).
    const chapatiId = psql(`select id from items where name = 'Chapati';`);
    const chapatiBuying = psql(`select buying_price from items where name = 'Chapati';`);
    const chapatiSelling = psql(`select selling_price from items where name = 'Chapati';`);
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const restaurantDate = todayStr; // today, restaurant-side daily row

    psql(
      `delete from stock_entries where item_id = '${chapatiId}' and entry_date = '${restaurantDate}' and location = 'restaurant';`,
    );
    psql(`delete from stock_entries where item_id = '${chapatiId}' and entry_date = '${todayStr}' and location = 'canteen';`);

    // Restaurant sends 30 Chapati today.
    psql(`
      insert into stock_entries (
        item_id, location, entry_date, opening_stock, added_stock, sent_out,
        till_quantity_sold, quantity_sold, wastage, selling_price_snapshot,
        buying_price_snapshot, closing_stock, sales_value, cost_value,
        closing_stock_value, wastage_value, created_by
      ) values (
        '${chapatiId}', 'restaurant', '${restaurantDate}', 0, 50, 30,
        10, 10, 0, ${chapatiSelling}, ${chapatiBuying}, 10, ${10 * chapatiSelling}, ${10 * chapatiBuying},
        ${10 * chapatiBuying}, 0, '${sarahId}'
      );
    `);
    // Canteen's own today row: added_stock should already reflect the
    // restaurant's 30 sent_out (canteen_supplied_total() reads it
    // same-day) -- simulate that as already-saved with a real canteen
    // sale against it.
    psql(`
      insert into stock_entries (
        item_id, location, entry_date, opening_stock, added_stock, sent_out,
        till_quantity_sold, quantity_sold, wastage, selling_price_snapshot,
        buying_price_snapshot, closing_stock, sales_value, cost_value,
        closing_stock_value, wastage_value, created_by
      ) values (
        '${chapatiId}', 'canteen', '${todayStr}', 0, 30, 0,
        5, 5, 0, ${chapatiSelling}, ${chapatiBuying}, 25, ${5 * chapatiSelling}, ${5 * chapatiBuying},
        ${25 * chapatiBuying}, 0, (select id from users where name = 'Anne Gitonga')
      );
    `);

    const res = await api(admin, "PATCH", "/api/dashboard/ledger/entry", {
      table: "stock_entries",
      item_id: chapatiId,
      location: "restaurant",
      entry_date: restaurantDate,
      till_quantity_sold: 10,
      added_stock: 50,
      sent_out: 45, // up from 30 -- canteen's added_stock should follow
      wastage: 0,
    });
    check("Edit to restaurant sent_out succeeds (200)", res.status === 200, res);

    const canteenRow = psql(
      `select added_stock, opening_stock, closing_stock from stock_entries where item_id = '${chapatiId}' and location = 'canteen' and entry_date = '${todayStr}';`,
    );
    const [cAdded, cOpening, cClosing] = canteenRow.split("|").map(Number);
    check(
      "Canteen's same-day added_stock cascaded to match the new sent_out total (45)",
      cAdded === 45,
      canteenRow,
    );
    // opening(0) + added(45) - sold(5) - wastage(0) = 40 (was 25, +15 matching the +15 sent_out)
    check("Canteen's closing_stock recomputed against the new added_stock (0 + 45 - 5 = 40)", cClosing === 40, canteenRow);
    check("Canteen's opening_stock unaffected (still 0, no prior canteen row)", cOpening === 0, canteenRow);

    const audit = psql(
      `select changes from audit_log where action = 'stock_entry.admin_edit' and target_id = (select id from stock_entries where item_id = '${chapatiId}' and location = 'restaurant' and entry_date = '${restaurantDate}') order by created_at desc limit 1;`,
    );
    const changes = JSON.parse(audit);
    check(
      "Audit log's cascade_recomputed includes the canteen row, not just the restaurant one",
      Array.isArray(changes.cascade_recomputed) &&
        changes.cascade_recomputed.some((r) => r.location === "canteen" && r.closing_stock === 40),
      changes,
    );

    psql(
      `delete from stock_entries where item_id = '${chapatiId}' and entry_date = '${restaurantDate}' and location = 'restaurant';`,
    );
    psql(`delete from stock_entries where item_id = '${chapatiId}' and entry_date = '${todayStr}' and location = 'canteen';`);
    psql(
      `delete from audit_log where action = 'stock_entry.admin_edit' and target_id in (select id from stock_entries where item_id = '${chapatiId}');`,
    );
  }

  cleanup();
  const stockLeftover = psql(
    `select count(*) from stock_entries where item_id = '${itemId}' and location = 'restaurant' and entry_date in ('${DAY_BEFORE}', '${YESTERDAY}', '${TODAY}');`,
  );
  const ingredientLeftover = psql(
    `select count(*) from ingredient_entries where ingredient_id = '${ingredientId}' and entry_date in ('${DAY_BEFORE}', '${YESTERDAY}', '${TODAY}');`,
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
