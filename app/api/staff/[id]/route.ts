import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { staffUpdateSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";

/**
 * PATCH /api/staff/[id]
 * Phase 9 — edits an existing staff account's name/role/location/
 * store-manager flag/active status. Same cross-field business rules as
 * POST /api/staff (admin has no location, staff must have one, only
 * restaurant staff can be store manager) — re-checked here rather than
 * assumed, since a role/location change can make a previously-valid
 * combination invalid (e.g. flipping a store-manager restaurant staffer
 * to canteen).
 *
 * PIN reset is a separate route (POST /api/staff/[id]/pin) since it
 * requires the Auth admin API (service role), not a plain table update
 * — see that route's comment.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = staffUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { name, role, location, is_store_manager, active } = parsed.data;

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
  if (id === admin.id && !active) {
    return NextResponse.json({ error: "You can't deactivate your own account" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("users")
    .update({ name, role, location, is_store_manager, active })
    .eq("id", id)
    .select()
    .single();

  if (error) return serverErrorResponse(error, "staff/[id]");
  return NextResponse.json({ staff: data });
}
