import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";

/**
 * GET /api/admin/debtors/[customerId]/orders
 *
 * Every order placed by one customer, across both locations — backs the
 * debtors screen's drill-in (docs/01_DATA_MODEL.md §6's "Credit sales
 * and customer payments" subsection, Phase 11). Admin-only; is_admin()
 * already bypasses orders_select_scoped's location boundary (§4), so
 * this deliberately doesn't filter by location — a debtor isn't scoped
 * to one location any more than the customers catalog itself is.
 *
 * Deliberately not filtered to "outstanding only" server-side — the
 * client (DebtorsClient) fetches each order's own payment figures via
 * GET /api/orders/[id]/payments to decide what's actually still owed,
 * since the outstanding/paid split can only be computed correctly per
 * order, not guessed from this list alone. Returning the full order
 * history for the customer here is intentional, not a shortcut that
 * skipped a filter.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ customerId: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { customerId } = await params;
  const supabase = await createServerSupabaseClient();

  const query = supabase
    .from("orders")
    .select("*")
    .eq("customer_id", customerId)
    .order("order_date", { ascending: false });
  const { data, error }: Awaited<typeof query> = await query;

  if (error) return serverErrorResponse(error, "admin/debtors/orders");

  return NextResponse.json({ orders: data ?? [] });
}
