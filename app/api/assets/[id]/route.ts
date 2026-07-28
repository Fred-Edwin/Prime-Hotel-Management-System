import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { assetSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { describeSaveError, serverErrorResponse } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";

/**
 * PATCH /api/assets/[id]
 *
 * Full catalog edit (name/category/location/unit_cost/threshold/active)
 * is admin-only — matches ingredients'/delivery_locations' admin-only
 * catalog edit (creation is wider, editing isn't).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = assetSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();

  const { data: before } = await supabase
    .from("assets")
    .select("name, category, location, unit_cost, low_stock_threshold, active")
    .eq("id", id)
    .single();

  const { data, error } = await supabase
    .from("assets")
    .update(parsed.data)
    .eq("id", id)
    .select()
    .single();

  if (error) return serverErrorResponse(error, "assets/[id]/PATCH");

  const action =
    before && before.active !== parsed.data.active
      ? parsed.data.active
        ? "asset.reactivate"
        : "asset.deactivate"
      : "asset.edit";

  await writeAuditLog(supabase, {
    actorId: admin.id,
    action,
    targetTable: "assets",
    targetId: id,
    changes: { before, after: parsed.data },
  });

  return NextResponse.json({ asset: data });
}

/**
 * DELETE /api/assets/[id]
 *
 * Admin-only, permanent — extends items'/delivery_locations' hard-delete
 * exception to assets (client request, 2026-07-28). Unlike delivery
 * locations, asset_events.asset_id is not nullable, so this also removes
 * the asset's full purchase/loss event history — confirmed acceptable
 * with the human (assets are a low-stakes catalog, no sales/profit
 * history depends on one). See supabase/migrations/20260728140000_asset_hard_delete.sql.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: existing } = await supabase.from("assets").select("*").eq("id", id).maybeSingle();
  const { data: impact } = await supabase.rpc("asset_delete_impact", { p_asset_id: id }).maybeSingle();

  const { error } = await supabase.rpc("delete_asset", { p_asset_id: id });

  if (error) {
    if (error.code === "P0005") {
      return NextResponse.json({ error: "That asset no longer exists." }, { status: 404 });
    }
    const { message, status } = describeSaveError(error);
    return NextResponse.json({ error: message }, { status });
  }

  await writeAuditLog(supabase, {
    actorId: admin.id,
    action: "asset.delete",
    targetTable: "assets",
    targetId: id,
    changes: { before: existing ?? null, impact: impact ?? null },
  });

  return NextResponse.json({ success: true });
}
