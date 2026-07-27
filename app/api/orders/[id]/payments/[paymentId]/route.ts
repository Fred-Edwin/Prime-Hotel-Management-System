import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";

/**
 * DELETE /api/orders/[id]/payments/[paymentId]
 *
 * Admin-only payment delete (client feedback, 2026-07-27: "Delete
 * options required under Debtors for admin") — the follow-up flagged
 * as a known gap in Phase 11 (docs/phases/phase11_context.md: "No
 * payment reversal/refund route"). Unlike the Item Ledger deletes,
 * there is no cascade to recompute here: outstanding balance is
 * derived at read time from total_amount - sum(order_payments.amount)
 * (docs/01_DATA_MODEL.md §6), never denormalized, so removing the row
 * is the entire operation — see
 * 20260727110000_order_payment_delete.sql's new admin-only DELETE RLS
 * policy, which is the actual enforcement (this route's requireAdmin()
 * check is the first line of defense, same two-layer discipline as
 * every other admin write in this codebase).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; paymentId: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, paymentId } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: existing } = await supabase
    .from("order_payments")
    .select("*")
    .eq("id", paymentId)
    .eq("order_id", id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "That payment no longer exists." }, { status: 404 });
  }

  const { error } = await supabase
    .from("order_payments")
    .delete()
    .eq("id", paymentId)
    .eq("order_id", id);

  if (error) return serverErrorResponse(error, "orders/payments/delete");

  await writeAuditLog(supabase, {
    actorId: admin.id,
    action: "order_payment.admin_delete",
    targetTable: "order_payments",
    targetId: paymentId,
    changes: { before: existing },
  });

  return NextResponse.json({ success: true });
}
