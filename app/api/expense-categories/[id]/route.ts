import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { expenseCategorySchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";

/**
 * PATCH /api/expense-categories/[id] — rename and/or retire (active:
 * false) a category. No DELETE route — deactivate-only, same
 * ingredients/delivery_locations convention (expense_categories has no
 * delete RLS policy at all, see 20260721090000_expense_categories_catalog.sql).
 * Retiring a category doesn't hide it from past expenses' display (the
 * FK reference stays live), it only stops it from being offered for new
 * entries going forward — same as an inactive item still showing on
 * old stock_entries rows.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = expenseCategorySchema.partial({ name: true }).safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("expense_categories")
    .update(parsed.data)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "A category with that name already exists." }, { status: 409 });
    }
    return serverErrorResponse(error, "expense-categories/[id]");
  }
  return NextResponse.json({ expenseCategory: data });
}
