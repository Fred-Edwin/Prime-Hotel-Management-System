/**
 * Acceptance checks for the /store per-field autosave redesign
 * (post-launch, 2026-07-16 — see docs/01_DATA_MODEL.md §3.3's Phase 10
 * correction and docs/00_ARCHITECTURE.md §12's same correction).
 *
 * Covers PUT /api/ingredient-entries (new single-line autosave route)
 * correctness risk: row carry-forward across repeated single-field
 * saves, the oversell check, RBAC (store-manager-only), and — since
 * this redesign moves /store from one batched daily save to
 * potentially-concurrent per-field autosave calls — the new
 * lock_ingredient_entry_row() advisory lock added in
 * supabase/migrations/20260716090000_ingredient_entry_row_locking.sql.
 * Uses a dedicated fixture ingredient (created and torn down by this
 * script) so it never touches real seed ingredients' entry history.
 */

import { randomUUID } from "node:crypto";
import { login, api, check, summarizeAndExit, psql } from "./_lib.mjs";

const TODAY = new Date().toISOString().slice(0, 10);
const FIXTURE_NAME = "[acceptance-test] Store Autosave Ingredient";
const ingredientId = randomUUID();
const raceIngredientId = randomUUID();

function cleanup() {
  psql(`delete from ingredient_entries where ingredient_id in ('${ingredientId}', '${raceIngredientId}');`);
  psql(`delete from ingredients where id in ('${ingredientId}', '${raceIngredientId}');`);
}

async function main() {
  cleanup();

  psql(
    `insert into ingredients (id, name, unit, buying_price, low_stock_threshold) values ('${ingredientId}', '${FIXTURE_NAME}', 'kg', 100.00, 5);`,
  );
  const createdCheck = psql(`select count(*) from ingredients where id = '${ingredientId}';`);
  check("Fixture ingredient created", createdCheck === "1", createdCheck);

  const janiffer = await login("janiffer");
  const sarah = await login("sarah");

  console.log('\n=== TEST 1: First-ever autosave for this ingredient/date ===');
  {
    const { status, body } = await api(janiffer, "PUT", "/api/ingredient-entries", {
      entry_date: TODAY,
      ingredient_id: ingredientId,
      received: 10,
      quantity_used: 0,
    });
    check("First PUT succeeds (200)", status === 200, { status, body });
    check("opening_stock = 0 (no prior day)", body?.entry?.opening_stock === 0, body?.entry);
    check("received = 10", body?.entry?.received === 10, body?.entry);
    check("wastage hardcoded to 0", body?.entry?.wastage === 0, body?.entry);
    check("wastage_note hardcoded to null", body?.entry?.wastage_note === null, body?.entry);
    check(
      "closing_stock = opening(0) + received(10) - used(0) = 10",
      body?.entry?.closing_stock === 10,
      body?.entry,
    );
  }

  console.log("\n=== TEST 2: Second autosave (a different field) carries the first field forward ===");
  {
    const { status, body } = await api(janiffer, "PUT", "/api/ingredient-entries", {
      entry_date: TODAY,
      ingredient_id: ingredientId,
      received: 10, // unchanged — simulates "used" field's own autosave firing independently
      quantity_used: 4,
    });
    check("Second PUT succeeds (200)", status === 200, { status, body });
    check("received still 10 (not clobbered by the used-field save)", body?.entry?.received === 10, body?.entry);
    check("quantity_used = 4", body?.entry?.quantity_used === 4, body?.entry);
    check(
      "closing_stock = opening(0) + received(10) - used(4) = 6",
      body?.entry?.closing_stock === 6,
      body?.entry,
    );
  }

  console.log("\n=== TEST 3 (MANDATORY): Oversell is rejected with 409, doesn't corrupt the row ===");
  {
    const { status, body } = await api(janiffer, "PUT", "/api/ingredient-entries", {
      entry_date: TODAY,
      ingredient_id: ingredientId,
      received: 10,
      quantity_used: 999,
    });
    check("Oversell rejected with 409", status === 409, { status, body });

    const row = psql(
      `select quantity_used, closing_stock from ingredient_entries where ingredient_id = '${ingredientId}' and entry_date = '${TODAY}';`,
    );
    check("Row unchanged after rejected oversell (quantity_used still 4)", row === "4.00|6.00", row);
  }

  console.log("\n=== TEST 4: Non-store-manager forbidden from the autosave route ===");
  {
    const { status, body } = await api(sarah, "PUT", "/api/ingredient-entries", {
      entry_date: TODAY,
      ingredient_id: ingredientId,
      received: 1,
      quantity_used: 0,
    });
    check("Non-store-manager PUT rejected with 403", status === 403, { status, body });
  }

  console.log("\n=== TEST 5 (MANDATORY): Concurrent first-writer autosaves don't race ===");
  {
    // A second fixture ingredient with NO existing row — the exact race
    // 20260716090000_ingredient_entry_row_locking.sql's advisory lock
    // exists to close: two calls both reading "no row yet" concurrently.
    psql(
      `insert into ingredients (id, name, unit, buying_price, low_stock_threshold) values ('${raceIngredientId}', '${FIXTURE_NAME} (race)', 'kg', 50.00, 5);`,
    );

    const [r1, r2] = await Promise.all([
      api(janiffer, "PUT", "/api/ingredient-entries", {
        entry_date: TODAY,
        ingredient_id: raceIngredientId,
        received: 20,
        quantity_used: 0,
      }),
      api(janiffer, "PUT", "/api/ingredient-entries", {
        entry_date: TODAY,
        ingredient_id: raceIngredientId,
        received: 20,
        quantity_used: 5,
      }),
    ]);

    check(
      "Both concurrent first-writer saves succeed (no false oversell rejection)",
      r1.status === 200 && r2.status === 200,
      { r1: r1.status, r2: r2.status, b1: r1.body, b2: r2.body },
    );

    const row = psql(
      `select received, quantity_used, closing_stock from ingredient_entries where ingredient_id = '${raceIngredientId}' and entry_date = '${TODAY}';`,
    );
    // Whichever call's INSERT/UPDATE lands last wins (both write
    // received=20), so the row must NOT be corrupted (e.g. no null
    // closing_stock, no dropped received value) — it should reflect one
    // of the two fully-consistent writes, not a mix of stale/fresh reads.
    check(
      "Row after race is fully consistent (received=20, not corrupted/null)",
      row === "20.00|0.00|20.00" || row === "20.00|5.00|15.00",
      row,
    );
  }

  cleanup();
  summarizeAndExit("Post-launch: /store autosave");
}

main().catch((err) => {
  console.error(err);
  cleanup();
  process.exit(1);
});
