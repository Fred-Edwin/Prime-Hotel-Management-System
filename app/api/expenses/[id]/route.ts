import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { expenseUpdateSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";

/**
 * PATCH /api/expenses/[id]
 * Admin-only correction of a past expense (expenses_update_admin_only
 * RLS) — category, location, amount, note, or date, any subset. Staff
 * can never edit an expense, including their own; a logging mistake is
 * an admin correction, same as stock_entries/ingredient_entries.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = expenseUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: before } = await supabase.from("expenses").select("*").eq("id", id).maybeSingle();

  const { data, error } = await supabase
    .from("expenses")
    .update(parsed.data)
    .eq("id", id)
    .select("*, expense_categories(id, name)")
    .single();

  if (error) return serverErrorResponse(error, "expenses/[id]");

  await writeAuditLog(supabase, {
    actorId: admin.id,
    action: "expense.admin_edit",
    targetTable: "expenses",
    targetId: id,
    changes: { before: before ?? null, after: parsed.data },
  });

  return NextResponse.json({ expense: data });
}

/**
 * DELETE /api/expenses/[id]
 * Admin-only. Unlike ingredient_purchases/canteen_stock_purchases, an
 * expense has no derived value (weighted-average cost, stock quantity)
 * to unwind — only dashboard_expenses_summary() sums it at read time —
 * so a plain RLS-gated delete is sufficient (expenses_delete_admin_only,
 * see 20260721090000_expense_categories_catalog.sql), no companion RPC.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: existing } = await supabase.from("expenses").select("*").eq("id", id).maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "That expense no longer exists." }, { status: 404 });
  }

  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) return serverErrorResponse(error, "expenses/[id]");

  await writeAuditLog(supabase, {
    actorId: admin.id,
    action: "expense.delete",
    targetTable: "expenses",
    targetId: id,
    changes: { before: existing },
  });

  return NextResponse.json({ success: true });
}
