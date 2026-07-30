import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";

/**
 * GET /api/ingredients/[id]/on-hand
 *
 * Read-only lookup for the Ingredients edit drawer's price-edit warning
 * (docs/01_DATA_MODEL.md §3.20, companion to §3.19) — how many units of
 * this ingredient currently exist. Ingredients are restaurant-only (§3.2,
 * no location split), unlike items' on-hand lookup.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("ingredient_entries")
    .select("closing_stock, entry_date")
    .eq("ingredient_id", id)
    .order("entry_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return serverErrorResponse(error, "ingredients/[id]/on-hand");

  return NextResponse.json({ quantityOnHand: data?.closing_stock ?? 0 });
}
