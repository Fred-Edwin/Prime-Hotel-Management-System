import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";

/**
 * GET /api/expense-categories/[id]/delete-impact
 *
 * Read-only preview for the expense-category-delete confirmation modal
 * — count and total value of every expense filed under this category,
 * via expense_category_delete_impact()
 * (supabase/migrations/20260723100000_expense_category_hard_delete.sql).
 * Mirrors GET /api/items/[id]/delete-impact.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .rpc("expense_category_delete_impact", { p_expense_category_id: id })
    .maybeSingle();
  if (error) return serverErrorResponse(error, "expense-categories/[id]/delete-impact");

  return NextResponse.json({ impact: data });
}
