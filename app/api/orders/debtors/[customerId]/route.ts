import { NextResponse } from "next/server";
import { getActingContext } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";

/**
 * GET /api/orders/debtors/[customerId]
 *
 * Staff-facing equivalent of GET /api/admin/debtors/[customerId]/orders
 * (client feedback, 2026-07-28 — see GET /api/orders/debtors's own
 * comment for the full rationale). Same plain `select` off `orders`
 * with no location filter — but here, run under a real staff session
 * rather than admin, orders_select_scoped naturally narrows the result
 * to the caller's own location (`is_admin() or location =
 * my_location()`), so a canteen cashier drilling into a customer only
 * ever sees that customer's canteen orders, never their restaurant
 * ones, without this route needing to filter anything itself.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ customerId: string }> },
) {
  const ctx = await getActingContext();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { customerId } = await params;
  const supabase = await createServerSupabaseClient();

  const query = supabase
    .from("orders")
    .select("*")
    .eq("customer_id", customerId)
    .order("order_date", { ascending: false });
  const { data, error }: Awaited<typeof query> = await query;

  if (error) return serverErrorResponse(error, "orders/debtors/orders");

  return NextResponse.json({ orders: data ?? [] });
}
