import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { describeSaveError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";

/**
 * DELETE /api/asset-events/[id]
 *
 * Admin-only correction path, mirrors DELETE /api/ingredient-purchases/[id]
 * — asset_events is append-only for staff (no update/delete RLS policy at
 * all beyond asset_events_delete_admin), a logging mistake is an admin
 * correction, not a UI edit path.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: existing } = await supabase.from("asset_events").select("*").eq("id", id).maybeSingle();

  const { error } = await supabase.rpc("delete_asset_event", { p_event_id: id });

  if (error) {
    const { message, status } = describeSaveError(error);
    return NextResponse.json({ error: message }, { status });
  }

  await writeAuditLog(supabase, {
    actorId: admin.id,
    action: "asset_event.delete",
    targetTable: "asset_events",
    targetId: id,
    changes: { before: existing ?? null },
  });

  return NextResponse.json({ success: true });
}
