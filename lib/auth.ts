import "server-only";
import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { ADMIN_ACTING_AS_COOKIE, parseActingAsCookie, type ActingAsState } from "@/lib/actingAs";

export type UserRow = Database["public"]["Tables"]["users"]["Row"];

export { staffCodeToSyntheticEmail, nextStaffCode } from "@/lib/staffCode";

/** Returns the currently authenticated user's `public.users` row, or null if not logged in. */
export async function getCurrentUser(): Promise<UserRow | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) return null;

  const { data: userRow } = await supabase
    .from("users")
    .select("*")
    .eq("id", authUser.id)
    .single();

  return userRow ?? null;
}

/** Signs out the current session by clearing Supabase auth cookies. */
export async function signOut(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
}

/**
 * Returns the current user's row if they're an admin, or null otherwise.
 * Route handlers for admin-only resources (items, ingredients,
 * delivery-locations, staff — see 00_ARCHITECTURE.md §5) must call this
 * and reject with 403 themselves, not rely on middleware/RLS alone.
 */
export async function requireAdmin(): Promise<UserRow | null> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return null;
  return user;
}

export type ActingContext =
  | { location: "restaurant" | "canteen"; actingAs: null; isStoreManager: boolean; user: UserRow }
  | { location: "restaurant" | "canteen"; actingAs: ActingAsState; isStoreManager: boolean; user: UserRow };

/**
 * The single chokepoint every staff-facing page/route should call instead
 * of getCurrentUser() when it needs a location to scope a read/write to.
 * A real staff member always resolves from their own session row. An
 * admin resolves only if they've entered acting mode via
 * POST /api/admin/acting-as (see lib/actingAs.ts) — the cookie is
 * re-validated here, never trusted at face value, mirroring the same
 * "RLS grants the capability, the route must still enforce sensibility"
 * discipline already used for staff_id picking on stock-consumption
 * claims (app/api/dashboard/ledger/entry/route.ts). Returns null for
 * anyone else (no session, or admin not currently acting) — callers
 * treat null exactly as they previously treated a failed
 * role/location check.
 */
export async function getActingContext(): Promise<ActingContext | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  if (user.role === "staff") {
    if (!user.location) return null;
    return { location: user.location, actingAs: null, isStoreManager: user.is_store_manager, user };
  }

  if (user.role === "admin") {
    const cookieStore = await cookies();
    const actingAs = parseActingAsCookie(cookieStore.get(ADMIN_ACTING_AS_COOKIE)?.value);
    if (!actingAs) return null;
    return {
      location: actingAs.location,
      actingAs,
      isStoreManager: actingAs.role === "store_manager",
      user,
    };
  }

  return null;
}
