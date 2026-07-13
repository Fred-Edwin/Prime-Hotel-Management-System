import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { staffCreateSchema } from "@/lib/validation";
import { nextStaffCode, staffCodeToSyntheticEmail } from "@/lib/staffCode";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = await createServerSupabaseClient();
  const query = supabase
    .from("users")
    .select("id, name, staff_code, role, location, is_store_manager, created_at")
    .order("staff_code");
  const { data, error }: Awaited<typeof query> = await query;

  if (error) return serverErrorResponse(error, "staff");
  return NextResponse.json({ staff: data });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = staffCreateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { name, pin, role, location, is_store_manager } = parsed.data;

  // Business rules not expressible as a single-field Zod check: admin
  // accounts have no location; staff accounts must have one. Only
  // restaurant staff can be flagged store manager (00_ARCHITECTURE.md
  // §5.1 — canteen has no store-manager responsibility).
  if (role === "admin" && location !== null) {
    return NextResponse.json({ error: "Admin accounts have no location" }, { status: 400 });
  }
  if (role === "staff" && location === null) {
    return NextResponse.json({ error: "Select a location for this staff account" }, { status: 400 });
  }
  if (is_store_manager && location !== "restaurant") {
    return NextResponse.json(
      { error: "Only restaurant staff can be flagged as store manager" },
      { status: 400 },
    );
  }

  // Service-role client: same pattern as scripts/seed-staff.ts. Needed to
  // call the Auth admin API (create the auth.users row) and to insert
  // into public.users, which staff-scoped RLS would otherwise block.
  const serviceClient = createServiceRoleClient();

  const { data: existingCodes, error: codesError } = await serviceClient
    .from("users")
    .select("staff_code");

  if (codesError) {
    return serverErrorResponse(codesError, "staff");
  }

  const staffCode = nextStaffCode((existingCodes ?? []).map((row) => row.staff_code));
  const email = staffCodeToSyntheticEmail(staffCode);

  const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
    email,
    password: pin,
    email_confirm: true,
  });

  if (createError || !created.user) {
    console.error("[staff] createUser failed", createError);
    return NextResponse.json(
      { error: "Something went wrong on our end — please try again." },
      { status: 500 },
    );
  }

  const { data: profile, error: profileError } = await serviceClient
    .from("users")
    .insert({
      id: created.user.id,
      name,
      staff_code: staffCode,
      role,
      location,
      is_store_manager,
    })
    .select()
    .single();

  if (profileError) {
    // Roll back the orphaned auth user so a failed staff creation doesn't
    // leave an auth.users row with no matching public.users row.
    await serviceClient.auth.admin.deleteUser(created.user.id);
    return serverErrorResponse(profileError, "staff");
  }

  return NextResponse.json({ staff: profile }, { status: 201 });
}
