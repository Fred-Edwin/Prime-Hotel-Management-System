import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { expenseCategorySchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { describeSaveError, serverErrorResponse } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";

/**
 * PATCH /api/expense-categories/[id] — rename and/or retire (active:
 * false) a category. Retiring a category doesn't hide it from past
 * expenses' display (the FK reference stays live), it only stops it
 * from being offered for new entries going forward — same as an
 * inactive item still showing on old stock_entries rows. See DELETE
 * below for the separate, permanent-removal path.
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

/**
 * DELETE /api/expense-categories/[id]
 *
 * Admin-only, permanent — extends items' hard-delete exception
 * (app/api/items/[id]/route.ts) to expense_categories per direct client
 * confirmation (2026-07-23). expenses.category_id is not null, with no
 * nullable escape like delivery_locations has, so deleting a category
 * also deletes every expense row filed under it, permanently changing
 * already-closed days' expense/profit figures. The client was shown
 * this consequence and confirmed it before this was built — see
 * supabase/migrations/20260723100000_expense_category_hard_delete.sql.
 * The UI must call GET .../delete-impact first and show the real
 * before-you-confirm counts; this route does not re-warn, it deletes.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: existing } = await supabase
    .from("expense_categories")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  const { data: impact } = await supabase
    .rpc("expense_category_delete_impact", { p_expense_category_id: id })
    .maybeSingle();

  const { error: deleteError } = await supabase.rpc("delete_expense_category", {
    p_expense_category_id: id,
  });

  if (deleteError) {
    if (deleteError.code === "P0005") {
      return NextResponse.json({ error: "That category no longer exists." }, { status: 404 });
    }
    const { message, status } = describeSaveError(deleteError);
    return NextResponse.json({ error: message }, { status });
  }

  await writeAuditLog(supabase, {
    actorId: admin.id,
    action: "expense_category.delete",
    targetTable: "expense_categories",
    targetId: id,
    changes: { before: existing ?? null, impact: impact ?? null },
  });

  return NextResponse.json({ success: true });
}
