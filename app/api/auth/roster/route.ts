import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Unauthenticated roster read for the login name picker — anon key
// only, calls the narrow public.login_roster() security-definer
// function (names only, nothing else). See supabase/migrations for
// why this exists instead of widening users' RLS.
export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const { data, error } = await supabase.rpc("login_roster");

  if (error) {
    return NextResponse.json({ error: "Could not load staff list" }, { status: 500 });
  }

  const names = (data ?? []).map((row: { name: string }) => row.name);
  return NextResponse.json({ names });
}
