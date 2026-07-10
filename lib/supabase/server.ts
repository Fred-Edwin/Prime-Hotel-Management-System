import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/** Server component / route handler client, scoped to the current user's session (anon key + RLS). */
export async function createServerSupabaseClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // setAll can be called from a Server Component, where cookie
            // writes are ignored — safe as long as middleware refreshes
            // the session on every request (see middleware.ts).
          }
        },
      },
    },
  );
}

/**
 * Service-role client for trusted server-only contexts that must bypass
 * RLS (e.g. admin creating a staff account via Supabase Auth admin API).
 * Never imported into client components; never exposed to the browser.
 */
export function createServiceRoleClient(): SupabaseClient<Database> {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {
          // service-role client is never session-bound
        },
      },
    },
  );
}
