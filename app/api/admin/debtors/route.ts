import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { dashboardPeriodRange, type DashboardPeriod } from "@/lib/calculations";
import { serverErrorResponse } from "@/lib/errors";

/**
 * GET /api/admin/debtors?period=today|week|month
 * GET /api/admin/debtors (no period — every outstanding balance, any age)
 * GET /api/admin/debtors?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Admin-only aggregated outstanding-balance-per-customer view
 * (docs/01_DATA_MODEL.md §6's "Credit sales and customer payments"
 * subsection, Phase 11) — backs /dashboard/debtors. Delegates the
 * actual aggregation to dashboard_debtors() (SQL, security invoker,
 * §4) rather than summing rows in JS, same "aggregate in SQL"
 * discipline every other dashboard_*() route follows.
 *
 * Unlike /api/admin/orders and /api/dashboard/summary, no period is
 * required — "who owes us money right now" naturally wants every
 * outstanding balance regardless of when the order was placed, not
 * just this week's. A period/range filter is still supported (narrows
 * which ORDERS count) for an admin who genuinely wants "debtors from
 * this month only," but omitting it is the sensible default, not an
 * error.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period");
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;

  let from: string | null = null;
  let to: string | null = null;

  if (fromParam || toParam) {
    if (!fromParam || !toParam || !isoDate.test(fromParam) || !isoDate.test(toParam) || fromParam > toParam) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }
    from = fromParam;
    to = toParam;
  } else if (period) {
    if (!["today", "week", "month"].includes(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }
    ({ from, to } = dashboardPeriodRange(period as DashboardPeriod));
  }

  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.rpc("dashboard_debtors", {
    p_from: from ?? undefined,
    p_to: to ?? undefined,
  });

  if (error) return serverErrorResponse(error, "admin/debtors");

  return NextResponse.json({
    period: period ?? null,
    from,
    to,
    debtors: data ?? [],
  });
}
