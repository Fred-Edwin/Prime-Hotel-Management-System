import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { describeSaveError, serverErrorResponse } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";

/**
 * DELETE /api/orders/[id]
 *
 * Admin-only whole-order delete (client feedback, 2026-07-28: "Debtor's
 * delete was supposed to delete the debt. We currently just have
 * reverse payment" — DELETE /api/orders/[id]/payments/[paymentId]
 * only lets admin remove one payment, not the underlying debt itself).
 * Deletes the order (which cascades order_items/order_payments too,
 * see docs/01_DATA_MODEL.md §2), then re-derives stock_entries for
 * every item the order touched via delete_order()'s own cascade call
 * — never a direct client-side DELETE FROM, same discipline as every
 * other admin delete in this codebase. See §3.16/§6.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const orderQuery = supabase.from("orders").select("*, order_items(*), order_payments(*)").eq("id", id).maybeSingle();
  const { data: existing, error: existingError } = await orderQuery;
  if (existingError) return serverErrorResponse(existingError, "orders/delete");

  const { error } = await supabase.rpc("delete_order", { p_order_id: id, p_created_by: admin.id });

  if (error) {
    if (error.code === "P0007") {
      return NextResponse.json({ error: "That order no longer exists." }, { status: 404 });
    }
    const { message, status } = describeSaveError(error);
    return NextResponse.json({ error: `Couldn't delete: ${message}` }, { status });
  }

  await writeAuditLog(supabase, {
    actorId: admin.id,
    action: "order.admin_delete",
    targetTable: "orders",
    targetId: id,
    changes: { before: existing ?? null },
  });

  return NextResponse.json({ success: true });
}
