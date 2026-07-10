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
