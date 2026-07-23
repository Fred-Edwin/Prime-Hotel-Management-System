import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";

/**
 * GET /api/delivery-locations/[id]/delete-impact
 *
 * Read-only preview for the delivery-location-delete confirmation modal
 * — how many past orders reference this zone and their total delivery-fee
 * value, via delivery_location_delete_impact()
 * (supabase/migrations/20260723090000_delivery_location_hard_delete.sql).
 * Mirrors GET /api/items/[id]/delete-impact.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .rpc("delivery_location_delete_impact", { p_delivery_location_id: id })
    .maybeSingle();
  if (error) return serverErrorResponse(error, "delivery-locations/[id]/delete-impact");

  return NextResponse.json({ impact: data });
}
