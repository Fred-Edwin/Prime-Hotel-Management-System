// Shared by proxy.ts (Edge runtime) and lib/auth.ts (Node) — no
// server-only/Node-specific imports here, this must stay Edge-safe.

export const ADMIN_ACTING_AS_COOKIE = "admin_acting_as";

export type ActingAsRole = "cashier" | "store_manager";
export type ActingAsLocation = "restaurant" | "canteen";

export interface ActingAsState {
  role: ActingAsRole;
  location: ActingAsLocation;
}

/**
 * Validates and normalizes a client-claimed {role, location} pair.
 * store_manager only exists for the restaurant (there's no canteen store
 * screen), so it's not a client-choosable combination — always forced.
 * Returns null for anything malformed; callers must treat null as
 * "no acting mode," never fall back to a guessed default.
 */
export function normalizeActingAs(input: unknown): ActingAsState | null {
  if (!input || typeof input !== "object") return null;
  const role = (input as Record<string, unknown>).role;
  const location = (input as Record<string, unknown>).location;

  if (role === "store_manager") {
    return { role: "store_manager", location: "restaurant" };
  }
  if (role === "cashier" && (location === "restaurant" || location === "canteen")) {
    return { role: "cashier", location };
  }
  return null;
}

/** Parses the raw cookie string value set by POST /api/admin/acting-as. */
export function parseActingAsCookie(rawValue: string | undefined): ActingAsState | null {
  if (!rawValue) return null;
  try {
    return normalizeActingAs(JSON.parse(rawValue));
  } catch {
    return null;
  }
}
