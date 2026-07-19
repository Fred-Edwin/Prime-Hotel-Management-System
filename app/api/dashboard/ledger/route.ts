import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { dashboardPeriodRange, type DashboardPeriod } from "@/lib/calculations";
import { serverErrorResponse } from "@/lib/errors";

/**
 * GET /api/dashboard/ledger?period=today|week|month&location=restaurant|canteen
 *
 * Item Ledger view (04_PHASE_PLAN.md Phase 7, docs/SCREENS.md
 * "/dashboard/ledger"): every stock_entries column, per item, per period,
 * optionally filtered to one location. Plus a separate restaurant-only
 * ingredient ledger. Both come from single set-based SQL functions
 * (public.dashboard_item_ledger / dashboard_ingredient_ledger) — never an
 * N+1 fetch per item.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") ?? "today";
  if (!["today", "week", "month"].includes(period)) {
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  }
  const locationParam = searchParams.get("location");
  if (locationParam && locationParam !== "restaurant" && locationParam !== "canteen") {
    return NextResponse.json({ error: "Invalid location" }, { status: 400 });
  }
  const location = (locationParam ?? undefined) as "restaurant" | "canteen" | undefined;

  // A custom date range (Phase 10's Item Ledger date-range picker) overrides
  // the period-derived range — same underlying dashboard_item_ledger/
  // dashboard_ingredient_ledger RPCs, which already take explicit p_from/p_to.
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  let from: string;
  let to: string;
  if (fromParam && toParam) {
    if (!isoDate.test(fromParam) || !isoDate.test(toParam) || fromParam > toParam) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }
    from = fromParam;
    to = toParam;
  } else {
    ({ from, to } = dashboardPeriodRange(period as DashboardPeriod));
  }

  const supabase = await createServerSupabaseClient();

  const [itemLedgerRes, ingredientLedgerRes, staffMealLedgerRes] = await Promise.all([
    supabase.rpc("dashboard_item_ledger", { p_from: from, p_to: to, p_location: location }),
    supabase.rpc("dashboard_ingredient_ledger", { p_from: from, p_to: to }),
    supabase.rpc("dashboard_staff_meal_ledger", { p_from: from, p_to: to, p_location: location }),
  ]);

  if (itemLedgerRes.error) {
    return serverErrorResponse(itemLedgerRes.error, "dashboard/ledger");
  }
  if (ingredientLedgerRes.error) {
    return serverErrorResponse(ingredientLedgerRes.error, "dashboard/ledger");
  }
  if (staffMealLedgerRes.error) {
    return serverErrorResponse(staffMealLedgerRes.error, "dashboard/ledger");
  }

  return NextResponse.json({
    period,
    from,
    to,
    items: itemLedgerRes.data ?? [],
    ingredients: ingredientLedgerRes.data ?? [],
    staffMeals: staffMealLedgerRes.data ?? [],
  });
}
