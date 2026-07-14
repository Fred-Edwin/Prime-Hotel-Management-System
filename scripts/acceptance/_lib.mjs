/**
 * Shared helpers for scripts/acceptance/*.mjs — one script per phase,
 * each a real, repeatable HTTP-level acceptance check against a live
 * dev server + local Supabase stack (not a unit test; see
 * scripts/acceptance/README.md for when to use these vs. `pnpm test`).
 *
 * Not a project dependency, not imported by app code — a dev-only test
 * harness, same spirit as scripts/verify-screenshot.mjs but for
 * data/RLS/calculation correctness instead of visual/layout checks
 * (see CLAUDE.md's "Verifying data/logic/RLS correctness" section for
 * why curl/fetch is the right tool for this kind of claim, not a
 * browser).
 */

export const BASE = process.env.ACCEPTANCE_BASE_URL ?? "http://localhost:3000";

// Mirrors scripts/seed-staff.ts's roster exactly (same roster
// scripts/verify-screenshot.mjs uses) — keep in sync if that file's
// PINs/names ever change.
export const ROSTER = {
  admin: { name: "WaPrecious", pin: "1234" },
  janiffer: { name: "Janiffer Maina", pin: "1111" }, // restaurant, store manager
  sarah: { name: "Sarah Makena", pin: "2222" }, // restaurant, cashier
  mercy: { name: "Mercy Wanjohi", pin: "3333" }, // restaurant, cashier
  anne: { name: "Anne Gitonga", pin: "4444" }, // canteen
};

function parseSetCookies(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

/** Logs in as a roster role, returns a Cookie header string for subsequent requests. */
export async function login(role) {
  const { name, pin } = ROSTER[role];
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, pin }),
  });
  if (!res.ok) throw new Error(`Login failed for ${role}: ${res.status} ${await res.text()}`);
  return parseSetCookies(res);
}

/** Calls a route as an already-logged-in cookie session; returns { status, body }. */
export async function api(cookie, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

/**
 * Runs raw SQL against the local Supabase Postgres container via `docker
 * exec psql`. Used for: (a) direct RLS-impersonation checks that prove a
 * table policy itself blocks a query (not just that one route handler
 * happens to filter it), and (b) manufacturing/cleaning up backdated
 * fixture rows the app's own date-scoped write paths would reject (see
 * docs/phases/phase5_context.md's documented pattern for this). Assumes
 * the local Supabase Docker container name below; override via
 * ACCEPTANCE_DB_CONTAINER if your local stack uses a different project name.
 */
import { execFileSync } from "node:child_process";

const DB_CONTAINER = process.env.ACCEPTANCE_DB_CONTAINER ?? "supabase_db_mqtlxuwbjzsjtywhjjtf_Reference_used_in_A";

export function psql(sql) {
  const out = execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c", sql],
    { encoding: "utf-8" },
  );
  return out.trim();
}

/**
 * RLS-impersonates a user by name (via set_config), runs one query as
 * `authenticated`. Returns just the query's own result (the last
 * non-empty output line before the trailing `reset role`), not the
 * whole multi-statement psql transcript — `set_config`/`set role`/
 * `reset role` all print their own lines with `-t -A`, so a caller
 * comparing the raw blob (e.g. checking it "ends with 0") would get a
 * false negative whenever those wrapper lines follow the result.
 */
export function psqlAsUser(userName, sql) {
  const script = `
select set_config('request.jwt.claims', json_build_object('sub', (select id::text from users where name='${userName}'), 'role','authenticated')::text, true);
set role authenticated;
${sql}
reset role;
`;
  const lines = psql(script).split("\n").map((l) => l.trim()).filter(Boolean);
  // Drop the trailing "RESET" (from `reset role;`) and the leading
  // set_config/"SET" lines, leaving only sql's own result line(s).
  const resultLines = lines.slice(2, lines.indexOf("RESET") === -1 ? undefined : lines.lastIndexOf("RESET"));
  return resultLines.join("\n");
}

// --- Tiny pass/fail tracker, shared by every phase script ---

let passed = 0;
let failed = 0;
const failures = [];

export function check(label, condition, detail) {
  if (condition) {
    console.log(`PASS: ${label}`);
    passed++;
  } else {
    console.log(`FAIL: ${label}${detail !== undefined ? " -- " + JSON.stringify(detail) : ""}`);
    failed++;
    failures.push(label);
  }
}

export function summarizeAndExit(phaseName) {
  console.log(`\n${phaseName}: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("Failed checks:", failures.join("; "));
  }
  process.exit(failed > 0 ? 1 : 0);
}

/** Looks up an item's id by exact name from a caller's /api/stock-entries or /api/orders items list. */
export function findItemByName(items, name) {
  const item = items.find((i) => i.name === name);
  if (!item) throw new Error(`Seed item "${name}" not found — has supabase/seed.sql changed?`);
  return item;
}
