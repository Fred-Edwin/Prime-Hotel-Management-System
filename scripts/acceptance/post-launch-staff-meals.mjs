/**
 * Acceptance checks for staff meal / unpaid-food consumption accounting
 * (docs/backlog/02_staff_meals.md, docs/01_DATA_MODEL.md §3.5).
 *
 * Environment note (read before "fixing" this script to use psql()):
 * this repo's .env.local currently points at a HOSTED free-tier dev
 * Supabase project, not a local Docker stack (docs/00_ARCHITECTURE.md
 * §7) — _lib.mjs's psql()/psqlAsUser() shell out to `docker exec` against
 * a local container, which doesn't exist here. This script therefore
 * does NOT use psql() at all: fixture setup/teardown goes through a
 * direct service-role Supabase client (supabaseAdmin below, same
 * approach scripts/seed-data/*.mjs already use) instead of raw SQL via
 * Docker, and every correctness assertion goes through real HTTP calls
 * (login()/api()) against the live dev server — exactly like every other
 * acceptance script, just without psql's direct-RLS-impersonation proof
 * or backdated-row fixtures. If a future session moves back to local
 * Docker (or adds a hosted-Postgres-compatible psql() to _lib.mjs), this
 * script can be extended with the equivalent direct-RLS-impersonation
 * check other post-launch-*.mjs scripts have (see README.md) — flagged
 * here as a known gap, not silently dropped.
 *
 * Covers:
 *  - happy path: a claim reduces closing_stock, is valued at
 *    buying_price (not selling_price), and shows up in the admin ledger
 *  - the oversell check now includes staff_meals as a third contributor
 *    alongside wastage (§3.5) — a claim that would push the combined
 *    total over available stock is rejected with 409
 *  - staff_meal_value is a distinct dashboard figure, never folded into
 *    wastage_value
 *  - location scoping: a staff member cannot claim an item belonging to
 *    the other location (403, same as /api/orders' existing rule)
 *  - a non-staff (admin) request is rejected (403) — this route is
 *    staff-only, same as /api/expenses
 *  - public.staff_meal_available_stock() (post-launch UX-audit fix)
 *    reports NULL, not 0, for an item with no stock_entries history at
 *    all — a real bug found live-testing this feature: collapsing
 *    "unknown" into "confirmed empty" made every never-yet-stocked item
 *    permanently unclaimable in the picker until its first till sale of
 *    the day, and staff could still submit past the (missing) client
 *    cap into a real server-side oversell rejection
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { login, api, check, summarizeAndExit, ROSTER } from "./_lib.mjs";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TODAY = new Date().toISOString().slice(0, 10);
const FIXTURE_PREFIX = "[acceptance-test] Staff Meals";

const restaurantItemId = randomUUID();
const canteenOnlyItemId = randomUUID();
const noHistoryItemId = randomUUID();

async function cleanup() {
  const ids = [restaurantItemId, canteenOnlyItemId, noHistoryItemId];
  await supabaseAdmin.from("staff_meal_entries").delete().in("item_id", ids);
  await supabaseAdmin.from("stock_entries").delete().in("item_id", ids);
  await supabaseAdmin.from("items").delete().in("id", ids);
}

async function main() {
  await cleanup();

  // Fixture items: one restaurant_only item this script fully controls
  // (never touches real seed catalog data), one canteen_independent item
  // to prove restaurant staff can't claim across the location boundary.
  const { error: itemInsertError } = await supabaseAdmin.from("items").insert([
    {
      id: restaurantItemId,
      name: `${FIXTURE_PREFIX} Item`,
      category: "meals",
      supply_type: "restaurant_only",
      buying_price: 80,
      selling_price: 150,
      low_stock_threshold: 5,
      active: true,
    },
    {
      id: canteenOnlyItemId,
      name: `${FIXTURE_PREFIX} Canteen Item`,
      category: "snacks",
      supply_type: "canteen_independent",
      buying_price: 20,
      selling_price: 40,
      low_stock_threshold: 5,
      active: true,
    },
    {
      // No stock_entries row is ever created for this one — exercises
      // staff_meal_available_stock()'s "unknown, not confirmed-empty"
      // case (§3.5's fix for the real bug where every item was shown as
      // 0-available, and thus unclaimable, until its first till sale of
      // the day).
      id: noHistoryItemId,
      name: `${FIXTURE_PREFIX} No History Item`,
      category: "meals",
      supply_type: "restaurant_only",
      buying_price: 50,
      selling_price: 100,
      low_stock_threshold: 5,
      active: true,
    },
  ]);
  check("Fixture items created", !itemInsertError, itemInsertError);

  // Seed today's restaurant stock_entries row directly (service role) so
  // this script controls exactly how much stock exists, without going
  // through the till-entry save flow — mirrors how other acceptance
  // scripts manufacture fixture stock_entries rows, just via the admin
  // client instead of psql() (see header note above).
  const { error: stockInsertError } = await supabaseAdmin.from("stock_entries").insert({
    item_id: restaurantItemId,
    location: "restaurant",
    entry_date: TODAY,
    opening_stock: 0,
    added_stock: 10,
    sent_out: 0,
    till_quantity_sold: 0,
    quantity_sold: 0,
    wastage: 0,
    selling_price_snapshot: 150,
    buying_price_snapshot: 80,
    closing_stock: 10,
    sales_value: 0,
    cost_value: 0,
    closing_stock_value: 800,
    wastage_value: 0,
    created_by: (await supabaseAdmin.from("users").select("id").eq("name", ROSTER.sarah.name).single()).data.id,
  });
  check("Fixture stock_entries row created (10 in stock)", !stockInsertError, stockInsertError);

  const sarah = await login("sarah"); // restaurant, cashier
  const anne = await login("anne"); // canteen
  const admin = await login("admin");

  console.log("\n=== TEST 1: Happy path — a claim reduces closing_stock and is valued at buying_price ===");
  {
    const { status, body } = await api(sarah, "POST", "/api/staff-meals", {
      item_id: restaurantItemId,
      quantity: 2,
      note: "lunch",
    });
    check("Claim succeeds (201)", status === 201, { status, body });
    check("value = quantity(2) * buying_price(80) = 160, not selling_price", body?.claim?.value === 160, body?.claim);
    check("staff_id/created_by are Sarah's own id (self-attribution)", body?.claim?.staff_id === body?.claim?.created_by, body?.claim);

    const { data: row } = await supabaseAdmin
      .from("stock_entries")
      .select("closing_stock, closing_stock_value")
      .eq("item_id", restaurantItemId)
      .eq("location", "restaurant")
      .eq("entry_date", TODAY)
      .single();
    check("closing_stock reduced from 10 to 8 (10 - 2 claimed)", row?.closing_stock === 8, row);
    check("closing_stock_value = 8 * 80 = 640", row?.closing_stock_value === 640, row);
  }

  console.log("\n=== TEST 2 (MANDATORY): Oversell rejected — staff_meals is a real contributor to the check ===");
  {
    // 8 left after test 1; claiming 9 more must be rejected (409), not
    // silently allowed to push closing_stock negative.
    const { status, body } = await api(sarah, "POST", "/api/staff-meals", {
      item_id: restaurantItemId,
      quantity: 9,
    });
    check("Oversell claim rejected with 409", status === 409, { status, body });

    const { data: row } = await supabaseAdmin
      .from("stock_entries")
      .select("closing_stock")
      .eq("item_id", restaurantItemId)
      .eq("location", "restaurant")
      .eq("entry_date", TODAY)
      .single();
    check("closing_stock unchanged after rejected oversell (still 8)", row?.closing_stock === 8, row);
  }

  console.log("\n=== TEST 3: A claim within the remaining stock still succeeds after the rejected attempt ===");
  {
    const { status, body } = await api(sarah, "POST", "/api/staff-meals", {
      item_id: restaurantItemId,
      quantity: 8,
    });
    check("Claiming exactly the remaining stock (8) succeeds", status === 201, { status, body });

    const { data: row } = await supabaseAdmin
      .from("stock_entries")
      .select("closing_stock")
      .eq("item_id", restaurantItemId)
      .eq("location", "restaurant")
      .eq("entry_date", TODAY)
      .single();
    check("closing_stock now exactly 0", row?.closing_stock === 0, row);
  }

  console.log("\n=== TEST 4: Location scoping — canteen staff can't claim a restaurant_only item ===");
  {
    const { status, body } = await api(anne, "POST", "/api/staff-meals", {
      item_id: restaurantItemId,
      quantity: 1,
    });
    check("Cross-location claim rejected (400 — not sold at Anne's location)", status === 400, { status, body });
  }

  console.log("\n=== TEST 5: Non-staff (admin) is forbidden from the staff-only claim route ===");
  {
    const { status, body } = await api(admin, "POST", "/api/staff-meals", {
      item_id: restaurantItemId,
      quantity: 1,
    });
    check("Admin POST rejected with 403", status === 403, { status, body });
  }

  console.log("\n=== TEST 6: staff_meal_value is distinct from wastage_value on the dashboard summary ===");
  {
    const { status, body } = await api(admin, "GET", "/api/dashboard/summary?period=today");
    check("Dashboard summary loads (200)", status === 200, { status });
    const restaurantFigures = body?.byLocation?.restaurant;
    check(
      "restaurant.staffMealValue includes this script's claims (>= 800, i.e. 10 * buying_price(80))",
      typeof restaurantFigures?.staffMealValue === "number" && restaurantFigures.staffMealValue >= 800,
      restaurantFigures,
    );
    check(
      "combined.staffMealValue is a real field, separate from combined.wastageValue",
      typeof body?.combined?.staffMealValue === "number" && "wastageValue" in body.combined,
      body?.combined,
    );
  }

  console.log("\n=== TEST 7: The claim is itemized (who, what, how much) on the admin ledger ===");
  {
    const { status, body } = await api(admin, "GET", "/api/dashboard/ledger?period=today&location=restaurant");
    check("Ledger loads (200)", status === 200, { status });
    const claims = (body?.staffMeals ?? []).filter((row) => row.item_id === restaurantItemId);
    check("Both of Sarah's successful claims appear in the ledger", claims.length === 2, claims);
    check(
      "Ledger rows are attributed to Sarah by name, not just an id",
      claims.every((row) => row.staff_name === ROSTER.sarah.name),
      claims,
    );
    const totalClaimed = claims.reduce((sum, row) => sum + row.quantity, 0);
    check("Ledger quantities sum to 10 (2 + 8)", totalClaimed === 10, claims);
  }

  console.log(
    "\n=== TEST 8 (MANDATORY): staff_meal_available_stock() distinguishes 'no history yet' from 'confirmed 0' ===",
  );
  {
    // Real bug found live-testing this feature: the picker's client-side
    // availability check originally only looked at TODAY's stock_entries
    // row, which usually doesn't exist yet — so it showed no cap at all
    // and let a staff member submit a quantity the server then rejected
    // with a confusing "That's more than the available stock available."
    // The fix (public.staff_meal_available_stock()) must report NULL for
    // an item with zero stock_entries history, not 0 — collapsing the
    // two would make every never-yet-stocked item permanently
    // unclaimable in the UI, not just correctly capped.
    const { data: rows, error } = await supabaseAdmin.rpc("staff_meal_available_stock", {
      p_location: "restaurant",
      p_as_of_date: TODAY,
    });
    check("staff_meal_available_stock() call succeeds", !error, error);

    const noHistoryRow = (rows ?? []).find((r) => r.item_id === noHistoryItemId);
    check(
      "Item with zero stock_entries history reports available = null (unknown), not 0",
      noHistoryRow !== undefined && noHistoryRow.available === null,
      noHistoryRow,
    );

    const restaurantRow = (rows ?? []).find((r) => r.item_id === restaurantItemId);
    check(
      "Item WITH stock history reports a real number, already net of every claim made today (0, not 10)",
      restaurantRow?.available === 0,
      restaurantRow,
    );
  }

  await cleanup();
  summarizeAndExit("Post-launch: staff meals");
}

main().catch(async (err) => {
  console.error(err);
  await cleanup();
  process.exit(1);
});
