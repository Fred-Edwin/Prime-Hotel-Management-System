import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { deliveryLocationSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { describeSaveError, serverErrorResponse } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = deliveryLocationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();

  const { data: before } = await supabase
    .from("delivery_locations")
    .select("name, fee, active")
    .eq("id", id)
    .single();

  const { data, error } = await supabase
    .from("delivery_locations")
    .update(parsed.data)
    .eq("id", id)
    .select()
    .single();

  if (error) return serverErrorResponse(error, "delivery-locations/[id]");

  // Same gap-closing rationale as ingredients/items — a silent fee edit
  // here changes what future orders charge with no record of who/when.
  const action =
    before && before.active !== parsed.data.active
      ? parsed.data.active
        ? "delivery_location.reactivate"
        : "delivery_location.deactivate"
      : "delivery_location.edit";

  await writeAuditLog(supabase, {
    actorId: admin.id,
    action,
    targetTable: "delivery_locations",
    targetId: id,
    changes: { before, after: parsed.data },
  });

  return NextResponse.json({ deliveryLocation: data });
}

/**
 * DELETE /api/delivery-locations/[id]
 *
 * Admin-only, permanent — extends items' hard-delete exception
 * (app/api/items/[id]/route.ts) to delivery_locations per direct client
 * confirmation (2026-07-23). orders.delivery_location_id is nullable
 * ("null for pickup"), so deleting a zone nulls out that reference on
 * any order that used it rather than deleting or rewriting the order —
 * a much smaller blast radius than items/ingredients, but still shown
 * to the admin via the impact preview before confirming. See
 * supabase/migrations/20260723090000_delivery_location_hard_delete.sql.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: existing } = await supabase
    .from("delivery_locations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  const { data: impact } = await supabase
    .rpc("delivery_location_delete_impact", { p_delivery_location_id: id })
    .maybeSingle();

  const { error } = await supabase.rpc("delete_delivery_location", { p_delivery_location_id: id });

  if (error) {
    if (error.code === "P0005") {
      return NextResponse.json({ error: "That delivery location no longer exists." }, { status: 404 });
    }
    const { message, status } = describeSaveError(error);
    return NextResponse.json({ error: message }, { status });
  }

  await writeAuditLog(supabase, {
    actorId: admin.id,
    action: "delivery_location.delete",
    targetTable: "delivery_locations",
    targetId: id,
    changes: { before: existing ?? null, impact: impact ?? null },
  });

  return NextResponse.json({ success: true });
}
