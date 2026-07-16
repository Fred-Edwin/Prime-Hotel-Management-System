/**
 * Acceptance checks for the audit log (post-launch, 2026-07-16 — see
 * docs/backlog/03_audit_log.md and docs/01_DATA_MODEL.md's audit_log
 * section).
 *
 * First pass covers Staff edit/deactivate/reactivate/PIN-reset only.
 * The real correctness risk here isn't the write path (a plain insert)
 * — it's the RLS boundary: admin can read, staff cannot, and — the
 * whole point of an audit trail — NO ONE, including admin, can write
 * or delete rows through the client. Only write_audit_log() (security
 * definer) may insert. This script proves that boundary by RLS-
 * impersonating both roles directly against Postgres (psqlAsUser),
 * not just checking what one route handler happens to expose.
 *
 * Uses a dedicated fixture staff account (created and torn down by
 * this script) so it never touches the real roster's history.
 */

import { login, api, check, summarizeAndExit, psql, psqlAsUser } from "./_lib.mjs";

const FIXTURE_NAME = "[acceptance-test] Audit Log Fixture Staff";
let fixtureStaffId = null;

function cleanup() {
  // Sweep by name (public.users) in addition to the captured id, so a
  // prior interrupted run's fixture is cleaned up even if this process
  // instance never captured its id. auth.users has no name column —
  // deleted by id via the public.users lookup instead, since staff
  // creation (POST /api/staff, exercised by this script) always
  // creates a matching auth.users row that a plain `delete from users`
  // never touches (public.users.id merely FKs to it, on delete
  // cascade would drop it too, but we go through public.users first
  // to look the id up before it's gone). Leaving auth.users rows
  // behind was confirmed to break a second run: the next
  // POST /api/staff picks the next staff_code and a fresh synthetic
  // email, so it wouldn't collide on email — but the leaked row was
  // still worth cleaning up properly rather than accumulating orphans
  // across every re-run.
  const ids = psql(`select id from users where name = '${FIXTURE_NAME}'${fixtureStaffId ? ` or id = '${fixtureStaffId}'` : ""};`);
  for (const id of ids.split("\n").filter(Boolean)) {
    psql(`delete from audit_log where target_id = '${id}';`);
    psql(`delete from users where id = '${id}';`);
    psql(`delete from auth.users where id = '${id}';`);
  }
}

async function main() {
  cleanup();

  const admin = await login("admin");
  const sarah = await login("sarah");

  // Created through the real POST /api/staff route (not direct SQL) so
  // the fixture gets a proper auth.users row too — public.users.id FKs
  // to auth.users(id), and staff creation isn't in this pass's audit
  // scope anyway (docs/backlog/03_audit_log.md scopes this to
  // edit/deactivate/pin_reset only).
  const created = await api(admin, "POST", "/api/staff", {
    name: FIXTURE_NAME,
    pin: "111111",
    role: "staff",
    location: "restaurant",
    is_store_manager: false,
  });
  check("Fixture staff created via POST /api/staff (201)", created.status === 201, created);
  fixtureStaffId = created.body?.staff?.id ?? null;
  check("Fixture staff id captured", typeof fixtureStaffId === "string" && fixtureStaffId.length > 0);

  console.log("\n=== TEST 1: Staff edit writes a staff.edit audit entry ===");
  {
    const { status } = await api(admin, "PATCH", `/api/staff/${fixtureStaffId}`, {
      name: "Audit Log Fixture Staff (edited)",
      role: "staff",
      location: "restaurant",
      is_store_manager: false,
      active: true,
    });
    check("PATCH succeeds (200)", status === 200, { status });

    const row = psql(
      `select action from audit_log where target_id = '${fixtureStaffId}' and action = 'staff.edit';`,
    );
    check("staff.edit entry exists", row === "staff.edit", row);
  }

  console.log("\n=== TEST 2: Deactivate/reactivate write distinct action names ===");
  {
    await api(admin, "PATCH", `/api/staff/${fixtureStaffId}`, {
      name: "Audit Log Fixture Staff (edited)",
      role: "staff",
      location: "restaurant",
      is_store_manager: false,
      active: false,
    });
    const deactivateRow = psql(
      `select action from audit_log where target_id = '${fixtureStaffId}' and action = 'staff.deactivate';`,
    );
    check("staff.deactivate entry exists", deactivateRow === "staff.deactivate", deactivateRow);

    await api(admin, "PATCH", `/api/staff/${fixtureStaffId}`, {
      name: "Audit Log Fixture Staff (edited)",
      role: "staff",
      location: "restaurant",
      is_store_manager: false,
      active: true,
    });
    const reactivateRow = psql(
      `select action from audit_log where target_id = '${fixtureStaffId}' and action = 'staff.reactivate';`,
    );
    check("staff.reactivate entry exists", reactivateRow === "staff.reactivate", reactivateRow);
  }

  console.log("\n=== TEST 3: PIN reset writes staff.pin_reset with no PIN value logged ===");
  {
    const { status } = await api(admin, "POST", `/api/staff/${fixtureStaffId}/pin`, { pin: "654321" });
    check("PIN reset succeeds (200)", status === 200, { status });

    const row = psql(
      `select changes from audit_log where target_id = '${fixtureStaffId}' and action = 'staff.pin_reset';`,
    );
    check("staff.pin_reset entry exists with no changes payload", row === "", row);
  }

  console.log("\n=== TEST 4: Admin can read via the API; staff cannot ===");
  {
    const { status, body } = await api(admin, "GET", "/api/audit-log");
    check("Admin GET /api/audit-log succeeds (200)", status === 200, { status });
    check(
      "Admin sees this fixture's entries",
      Array.isArray(body?.entries) && body.entries.some((e) => e.target_id === fixtureStaffId),
      body?.entries?.length,
    );

    const staffAttempt = await api(sarah, "GET", "/api/audit-log");
    check("Staff GET /api/audit-log is forbidden (403)", staffAttempt.status === 403, staffAttempt);
  }

  console.log("\n=== TEST 5: RLS itself blocks staff reads, not just the route handler ===");
  {
    const sarahDirect = psqlAsUser(
      "Sarah Makena",
      `select count(*) from audit_log where target_id = '${fixtureStaffId}';`,
    );
    check("Staff role sees zero rows via direct RLS-impersonated query", sarahDirect === "0", sarahDirect);

    const adminDirect = psqlAsUser(
      "WaPrecious",
      `select count(*) from audit_log where target_id = '${fixtureStaffId}';`,
    );
    check("Admin role sees the real rows via direct RLS-impersonated query", Number(adminDirect) >= 4, adminDirect);
  }

  console.log("\n=== TEST 6: No role can INSERT directly — writes only via write_audit_log() ===");
  {
    let staffInsertBlocked = false;
    try {
      psqlAsUser(
        "Sarah Makena",
        `insert into audit_log (actor_id, action, target_table, target_id) values ('${fixtureStaffId}', 'fake.action', 'users', '${fixtureStaffId}');`,
      );
    } catch {
      staffInsertBlocked = true;
    }
    check("Staff role cannot INSERT into audit_log directly", staffInsertBlocked);

    let adminInsertBlocked = false;
    try {
      psqlAsUser(
        "WaPrecious",
        `insert into audit_log (actor_id, action, target_table, target_id) values ('${fixtureStaffId}', 'fake.action', 'users', '${fixtureStaffId}');`,
      );
    } catch {
      adminInsertBlocked = true;
    }
    check(
      "Admin role ALSO cannot INSERT into audit_log directly — only write_audit_log() may write",
      adminInsertBlocked,
    );
  }

  cleanup();
  const cleanedCheck = psql(`select count(*) from users where id = '${fixtureStaffId}';`);
  check("Fixture staff and its audit entries cleaned up", cleanedCheck === "0", cleanedCheck);

  summarizeAndExit("Audit log (post-launch)");
}

main().catch((err) => {
  cleanup();
  console.error(err);
  process.exit(1);
});
