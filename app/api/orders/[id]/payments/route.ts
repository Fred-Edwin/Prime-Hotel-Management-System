import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { orderPaymentSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { describeSaveError, serverErrorResponse } from "@/lib/errors";

/**
 * GET /api/orders/[id]/payments
 * POST /api/orders/[id]/payments
 *
 * Payment ledger for a single order (docs/01_DATA_MODEL.md §6's "Credit
 * sales and customer payments" subsection, Phase 11). Any staff/admin
 * who can see the order (order_payments_select_scoped joins back to
 * orders' own location scoping — RLS) can see its payments and record
 * a new one; a cashier at either location may legitimately record a
 * payment against an order they didn't originally create (e.g. a
 * different shift, the customer pays days later).
 *
 * POST delegates the actual write to record_order_payment() (§6),
 * which does the overpayment recheck + advisory lock atomically —
 * this route never computes "is this within the remaining balance"
 * itself, since that can only be answered correctly against the
 * current DB state at write time, not a client-side snapshot.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const orderQuery = supabase.from("orders").select("*").eq("id", id).single();
  const { data: order, error: orderError }: Awaited<typeof orderQuery> = await orderQuery;
  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const paymentsQuery = supabase
    .from("order_payments")
    .select("*")
    .eq("order_id", id)
    .order("paid_at", { ascending: false });
  const { data: payments, error: paymentsError }: Awaited<typeof paymentsQuery> = await paymentsQuery;
  if (paymentsError) return serverErrorResponse(paymentsError, "orders/payments");

  const totalPaid = (payments ?? []).reduce((sum, p) => sum + p.amount, 0);
  const outstanding = order.total_amount - totalPaid;

  return NextResponse.json({
    order,
    payments: payments ?? [],
    totalPaid,
    outstanding,
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = orderPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.rpc("record_order_payment", {
    p_order_id: id,
    p_amount: parsed.data.amount,
    p_recorded_by: user.id,
    p_note: parsed.data.note ?? undefined,
    ...(parsed.data.paid_at ? { p_paid_at: parsed.data.paid_at } : {}),
  });

  if (error) {
    const { message, status } = describeSaveError(error);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ payment: data }, { status: 201 });
}
