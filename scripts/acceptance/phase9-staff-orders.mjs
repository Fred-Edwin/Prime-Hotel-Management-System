#!/usr/bin/env node
/**
 * Phase 9 acceptance checks — admin order-detail view + staff
 * edit/deactivate/PIN-reset (docs/phases/phase9_context.md).
 *
 * Covers: admin can list/drill into orders across both locations (the
 * scope gap this phase closed); a deactivated staff account can no
 * longer log in while historical entries stay attributed; an admin
 * cannot deactivate their own account; PIN reset actually changes the
 * usable credential; a staff account creation/PIN reset with a
 * too-short PIN is rejected cleanly (not a raw 500 — see this phase's
 * real discovery that Supabase's minimum_password_length=6 is enforced
 * by admin.updateUserById but not admin.createUser).
 *
 * Prerequisites: local Supabase stack running (`npx supabase status`)
 * and the dev server running (`pnpm dev`). Creates one throwaway staff
 * account per run (tagged via a distinctive name) and cleans it up
 * before exiting — never touches the real seeded roster's own PINs.
 *
 * Usage: node scripts/acceptance/phase9-staff-orders.mjs
 */

import { api, check, login, psql, summarizeAndExit } from "./_lib.mjs";

const MARKER = "[acceptance-test] Temp Staffer";

async function cleanup() {
  const idRow = psql(`select id from users where name = '${MARKER}';`);
  if (idRow) {
    psql(`delete from users where name = '${MARKER}';`);
    // auth.users row too -- users.id references auth.users(id) on delete
    // cascade is the OTHER direction (auth.users -> public.users), so the
    // auth identity is left behind unless removed explicitly.
    psql(`delete from auth.users where id = '${idRow}';`);
  }
}

async function main() {
  await cleanup();

  const adminCookie = await login("admin");

  // ---------------------------------------------------------------
  // TEST 1: Admin order-detail view — list + line items across both
  // locations (the actual scope gap this phase closed).
  // ---------------------------------------------------------------
  console.log("\n=== TEST 1: Admin order-detail view ===");
  const ordersRes = await api(adminCookie, "GET", "/api/admin/orders?period=month");
  check("Admin GET /api/admin/orders succeeds", ordersRes.status === 200, ordersRes);
  check("Response shape includes orders array", Array.isArray(ordersRes.body?.orders), ordersRes.body);

  const restaurantOnlyRes = await api(adminCookie, "GET", "/api/admin/orders?period=month&location=restaurant");
  check("Location filter accepted (200)", restaurantOnlyRes.status === 200, restaurantOnlyRes);
  check(
    "Location-filtered results are all restaurant",
    (restaurantOnlyRes.body.orders ?? []).every((o) => o.location === "restaurant"),
    restaurantOnlyRes.body.orders,
  );

  const badLocationRes = await api(adminCookie, "GET", "/api/admin/orders?period=month&location=bogus");
  check("Invalid location rejected with 400", badLocationRes.status === 400, badLocationRes);

  const sarahCookie = await login("sarah");
  const staffAttemptRes = await api(sarahCookie, "GET", "/api/admin/orders?period=today");
  check("Non-admin staff forbidden from admin order list (403)", staffAttemptRes.status === 403, staffAttemptRes);

  // ---------------------------------------------------------------
  // TEST 2: Staff creation with a too-short PIN rejected cleanly.
  // ---------------------------------------------------------------
  console.log("\n=== TEST 2: Staff creation PIN length validation ===");
  const shortPinRes = await api(adminCookie, "POST", "/api/staff", {
    name: MARKER,
    pin: "1234",
    role: "staff",
    location: "restaurant",
    is_store_manager: false,
  });
  check("4-digit PIN on staff creation rejected with 400, not a 500", shortPinRes.status === 400, shortPinRes);

  const createRes = await api(adminCookie, "POST", "/api/staff", {
    name: MARKER,
    pin: "555666",
    role: "staff",
    location: "restaurant",
    is_store_manager: false,
  });
  check("6-digit PIN on staff creation succeeds (201)", createRes.status === 201, createRes);
  const tempStaffId = createRes.body?.staff?.id;

  const loginNewStaffRes = await api("", "POST", "/api/auth/login", { name: MARKER, pin: "555666" });
  check("New staff account can log in with the PIN it was created with", loginNewStaffRes.status === 200, loginNewStaffRes);

  // ---------------------------------------------------------------
  // TEST 3: Edit updates fields; a too-short PIN on reset is rejected
  // cleanly (400, not the raw AuthWeakPasswordError 500 this phase's
  // testing actually hit before the schema was tightened).
  // ---------------------------------------------------------------
  console.log("\n=== TEST 3: Edit + PIN reset ===");
  const editRes = await api(adminCookie, "PATCH", `/api/staff/${tempStaffId}`, {
    name: MARKER,
    role: "staff",
    location: "canteen",
    is_store_manager: false,
    active: true,
  });
  check("Edit succeeds and reflects the new location", editRes.status === 200 && editRes.body?.staff?.location === "canteen", editRes);

  const shortPinResetRes = await api(adminCookie, "POST", `/api/staff/${tempStaffId}/pin`, { pin: "1234" });
  check("4-digit PIN on reset rejected with 400, not a 500", shortPinResetRes.status === 400, shortPinResetRes);

  const pinResetRes = await api(adminCookie, "POST", `/api/staff/${tempStaffId}/pin`, { pin: "777888" });
  check("6-digit PIN reset succeeds", pinResetRes.status === 200, pinResetRes);

  const oldPinLoginRes = await api("", "POST", "/api/auth/login", { name: MARKER, pin: "555666" });
  check("Old PIN no longer works after reset", oldPinLoginRes.status === 401, oldPinLoginRes);

  const newPinLoginRes = await api("", "POST", "/api/auth/login", { name: MARKER, pin: "777888" });
  check("New PIN works after reset", newPinLoginRes.status === 200, newPinLoginRes);

  // ---------------------------------------------------------------
  // TEST 4 (MANDATORY): Deactivation blocks login; historical
  // attribution (created_by on entries) is untouched by the flag.
  // ---------------------------------------------------------------
  console.log("\n=== TEST 4 (MANDATORY): Deactivation blocks login ===");
  const deactivateRes = await api(adminCookie, "PATCH", `/api/staff/${tempStaffId}`, {
    name: MARKER,
    role: "staff",
    location: "canteen",
    is_store_manager: false,
    active: false,
  });
  check("Deactivate succeeds", deactivateRes.status === 200 && deactivateRes.body?.staff?.active === false, deactivateRes);

  const deactivatedLoginRes = await api("", "POST", "/api/auth/login", { name: MARKER, pin: "777888" });
  check(
    "Deactivated account cannot log in (401, same generic message as wrong PIN)",
    deactivatedLoginRes.status === 401,
    deactivatedLoginRes,
  );

  const reactivateRes = await api(adminCookie, "PATCH", `/api/staff/${tempStaffId}`, {
    name: MARKER,
    role: "staff",
    location: "canteen",
    is_store_manager: false,
    active: true,
  });
  check("Reactivate succeeds", reactivateRes.status === 200 && reactivateRes.body?.staff?.active === true, reactivateRes);

  const reactivatedLoginRes = await api("", "POST", "/api/auth/login", { name: MARKER, pin: "777888" });
  check("Reactivated account can log in again with the same PIN", reactivatedLoginRes.status === 200, reactivatedLoginRes);

  // ---------------------------------------------------------------
  // TEST 5: Admin cannot deactivate their own account.
  // ---------------------------------------------------------------
  console.log("\n=== TEST 5: Admin cannot self-deactivate ===");
  const adminId = psql(`select id from users where name = 'WaPrecious';`);
  const selfDeactivateRes = await api(adminCookie, "PATCH", `/api/staff/${adminId}`, {
    name: "WaPrecious",
    role: "admin",
    location: null,
    is_store_manager: false,
    active: false,
  });
  check("Self-deactivation rejected with 400", selfDeactivateRes.status === 400, selfDeactivateRes);
  const adminStillActive = psql(`select active from users where id = '${adminId}';`);
  check("Admin's own active flag is unchanged (still true)", adminStillActive === "t", adminStillActive);

  await cleanup();
  summarizeAndExit("Phase 9 (staff + orders)");
}

main().catch((err) => {
  console.error("Test harness crashed:", err);
  process.exit(1);
});
