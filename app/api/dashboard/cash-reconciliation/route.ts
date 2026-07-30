import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { cashReconciliationSchema } from "@/lib/validation";
import { serverErrorResponse } from "@/lib/errors";

/**
 * GET /api/dashboard/cash-reconciliation?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Admin-only (docs/01_DATA_MODEL.md's cash_reconciliations section — no
 * staff equivalent). Returns every saved reconciliation row (both
 * locations) in the given inclusive date range, most recent first — lets
 * WaPrecious page back through any past date, not just today. Also
 * returns `expectedCash` for restaurant/canteen for the range's single
 * most-recent date (today, in the common case) even if nothing has been
 * saved yet for it — the entry form needs to show "the system currently
 * says X" before she's typed anything into "actual cash received."
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  if (!fromParam || !toParam || !isoDate.test(fromParam) || !isoDate.test(toParam) || fromParam > toParam) {
    return NextResponse.json({ error: "A valid date range is required" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  const [{ data: reconciliations, error }, restaurantExpectedRes, canteenExpectedRes] = await Promise.all([
    supabase
      .from("cash_reconciliations")
      .select("*")
      .gte("reconciliation_date", fromParam)
      .lte("reconciliation_date", toParam)
      .order("reconciliation_date", { ascending: false }),
    supabase.rpc("dashboard_expected_cash", { p_location: "restaurant", p_date: toParam }),
    supabase.rpc("dashboard_expected_cash", { p_location: "canteen", p_date: toParam }),
  ]);

  if (error) return serverErrorResponse(error, "dashboard/cash-reconciliation");
  if (restaurantExpectedRes.error) return serverErrorResponse(restaurantExpectedRes.error, "dashboard/cash-reconciliation");
  if (canteenExpectedRes.error) return serverErrorResponse(canteenExpectedRes.error, "dashboard/cash-reconciliation");

  return NextResponse.json({
    reconciliations: reconciliations ?? [],
    currentExpectedCash: {
      date: toParam,
      restaurant: restaurantExpectedRes.data ?? 0,
      canteen: canteenExpectedRes.data ?? 0,
    },
  });
}

/**
 * POST /api/dashboard/cash-reconciliation
 * Body: { location, reconciliation_date, actual_cash, note? }
 *
 * Admin-only. Calls save_cash_reconciliation() (see the migration's own
 * doc comment) — expected_cash is always freshly derived server-side
 * from that location/date's stock_entries.sales_value, never accepted
 * from the client. Upserts on (location, reconciliation_date), so
 * re-submitting for the same day corrects the existing row rather than
 * creating a duplicate.
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = cashReconciliationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { location, reconciliation_date, actual_cash, note } = parsed.data;
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .rpc("save_cash_reconciliation", {
      p_location: location,
      p_reconciliation_date: reconciliation_date,
      p_actual_cash: actual_cash,
      p_created_by: admin.id,
      p_note: note ?? undefined,
    })
    .single();

  if (error) return serverErrorResponse(error, "dashboard/cash-reconciliation");

  return NextResponse.json({ reconciliation: data });
}
