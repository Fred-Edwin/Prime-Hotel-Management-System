import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";

/**
 * GET /api/items/[id]/delete-impact
 *
 * Read-only preview for the item-delete confirmation modal — counts and
 * total value of everything DELETE /api/items/[id] would permanently
 * remove, via item_delete_impact() (supabase/migrations/20260721070000_item_hard_delete.sql).
 * Confirmed with the client (2026-07-21) that the confirmation must show
 * real numbers, not just a generic warning, before an item with history
 * is deleted — this route is what makes that possible.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.rpc("item_delete_impact", { p_item_id: id }).maybeSingle();
  if (error) return serverErrorResponse(error, "items/[id]/delete-impact");

  return NextResponse.json({ impact: data });
}
