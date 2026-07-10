import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

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
