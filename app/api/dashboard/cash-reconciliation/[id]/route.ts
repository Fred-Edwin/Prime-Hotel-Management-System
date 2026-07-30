import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";

/**
 * DELETE /api/dashboard/cash-reconciliation/[id]
 *
 * Admin-only (client feedback, 2026-07-30: "make the history table
 * editable in case she needs to delete or edit anything"). Same shape
 * as order_payments' delete (docs/01_DATA_MODEL.md §6, "Payment
 * delete") — a plain RLS-gated delete with no companion cleanup
 * function, since cash_reconciliations has no cascade to unwind:
 * nothing else in the schema reads this table (it has no relationship
 * to closing_stock/COGS/netProfit — see §3.17), so removing the row is
 * the entire operation. `cash_reconciliations_admin_all`'s `for all`
 * policy already covers delete; this route's requireAdmin() check is
 * the first line of defense, same two-layer discipline as every other
 * admin write in this codebase.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: existing } = await supabase.from("cash_reconciliations").select("*").eq("id", id).maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "That reconciliation no longer exists." }, { status: 404 });
  }

  const { error } = await supabase.from("cash_reconciliations").delete().eq("id", id);

  if (error) return serverErrorResponse(error, "dashboard/cash-reconciliation/delete");

  await writeAuditLog(supabase, {
    actorId: admin.id,
    action: "cash_reconciliation.admin_delete",
    targetTable: "cash_reconciliations",
    targetId: id,
    changes: { before: existing },
  });

  return NextResponse.json({ success: true });
}
