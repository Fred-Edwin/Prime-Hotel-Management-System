import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";

/**
 * GET /api/ingredients/[id]/delete-impact
 *
 * Read-only preview for the ingredient-delete confirmation modal —
 * counts and total value of everything DELETE /api/ingredients/[id]
 * would permanently remove, via ingredient_delete_impact()
 * (supabase/migrations/20260723080000_ingredient_hard_delete.sql).
 * Mirrors GET /api/items/[id]/delete-impact.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .rpc("ingredient_delete_impact", { p_ingredient_id: id })
    .maybeSingle();
  if (error) return serverErrorResponse(error, "ingredients/[id]/delete-impact");

  return NextResponse.json({ impact: data });
}
