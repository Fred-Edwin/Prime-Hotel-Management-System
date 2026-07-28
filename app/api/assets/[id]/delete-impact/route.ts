import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";

/**
 * GET /api/assets/[id]/delete-impact
 *
 * Preview shown before an admin confirms a hard delete — how many
 * asset_events would be removed along with the asset, and their
 * combined value. See asset_delete_impact() (20260728140000_asset_hard_delete.sql).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("asset_delete_impact", { p_asset_id: id }).maybeSingle();

  if (error) return serverErrorResponse(error, "assets/[id]/delete-impact");
  return NextResponse.json({ impact: data ?? null });
}
