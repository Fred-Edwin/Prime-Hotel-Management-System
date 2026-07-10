import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { loginSchema } from "@/lib/validation";
import { staffCodeToSyntheticEmail } from "@/lib/staffCode";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { name, pin } = parsed.data;

  // Service-role lookup: resolves the picked name to its staff_code so
  // we can build the synthetic email. Safe here — this is a trusted
  // server context, not client-exposed, and only staff_code (never a
  // PIN or anything else) is read. If multiple staff share the exact
  // same name, this picks the first by staff_code; see phase2 context
  // file for why that's an accepted V1 tradeoff.
  const serviceClient = createServiceRoleClient();
  const query = serviceClient
    .from("users")
    .select("staff_code")
    .eq("name", name)
    .order("staff_code", { ascending: true })
    .limit(1);
  const { data: matches, error: lookupError }: Awaited<typeof query> = await query;

  if (lookupError || !matches || matches.length === 0) {
    return NextResponse.json({ error: "Name or PIN is incorrect" }, { status: 401 });
  }

  const firstMatch: { staff_code: string } = matches[0];
  const email = staffCodeToSyntheticEmail(firstMatch.staff_code);

  const cookieStore = await cookies();
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name: cookieName, value, options } of cookiesToSet) {
            cookieStore.set(cookieName, value, options);
          }
        },
      },
    },
  );

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password: pin,
  });

  if (signInError) {
    return NextResponse.json({ error: "Name or PIN is incorrect" }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
