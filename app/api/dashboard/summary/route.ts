import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { dashboardPeriodRange, netProfit, type DashboardPeriod } from "@/lib/calculations";
import { serverErrorResponse } from "@/lib/errors";

/**
 * GET /api/dashboard/summary?period=today|week|month
 *
 * Profit dashboard's top-line figures (04_PHASE_PLAN.md Phase 7): sales,
 * cost, wastage (stock_entries + ingredient_entries, §3.3), net profit
 * (lib/calculations.ts netProfit()), closing stock value, per-location
 * split, a daily trend series for the hero band's chart, and the
 * low-stock "Needs attention" list. All aggregation happens in SQL via
 * the public.dashboard_*() functions (see
 * 20260712121500_dashboard_aggregation_functions.sql) — this route only
 * combines already-aggregated numbers, never sums raw rows in JS.
 *
 * quantity_sold on stock_entries already includes order-driven sales
 * (docs/01_DATA_MODEL.md §3.4) — sales_value/cost_value sums here pick up
 * orders for free, no separate order aggregation needed (per
 * docs/phases/phase6_context.md's "Instructions for the next phase").
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") ?? "today";
  if (!["today", "week", "month"].includes(period)) {
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  }

  const { from, to } = dashboardPeriodRange(period as DashboardPeriod);

  const supabase = await createServerSupabaseClient();

  const [
    stockSummaryRes,
    ingredientSummaryRes,
    expensesSummaryRes,
    staffMealSummaryRes,
    trendRes,
    lowStockItemsRes,
    lowStockIngredientsRes,
  ] = await Promise.all([
    supabase.rpc("dashboard_stock_summary", { p_from: from, p_to: to }),
    supabase.rpc("dashboard_ingredient_summary", { p_from: from, p_to: to }),
    supabase.rpc("dashboard_expenses_summary", { p_from: from, p_to: to }),
    supabase.rpc("dashboard_staff_meal_summary", { p_from: from, p_to: to }),
    supabase.rpc("dashboard_daily_trend", { p_from: from, p_to: to }),
    supabase.rpc("dashboard_low_stock_items"),
    supabase.rpc("dashboard_low_stock_ingredients"),
  ]);

  for (const res of [
    stockSummaryRes,
    ingredientSummaryRes,
    expensesSummaryRes,
    staffMealSummaryRes,
    trendRes,
    lowStockItemsRes,
    lowStockIngredientsRes,
  ]) {
    if (res.error) return serverErrorResponse(res.error, "dashboard/summary");
  }

  const stockByLocation = stockSummaryRes.data ?? [];
  const expensesByLocation = expensesSummaryRes.data ?? [];
  const staffMealsByLocation = staffMealSummaryRes.data ?? [];
  const ingredientSummary = ingredientSummaryRes.data?.[0] ?? {
    wastage_value: 0,
    closing_stock_value: 0,
  };

  const restaurantStock = stockByLocation.find((r) => r.location === "restaurant");
  const canteenStock = stockByLocation.find((r) => r.location === "canteen");
  const restaurantExpenses = expensesByLocation.find((r) => r.location === "restaurant")?.total_amount ?? 0;
  const canteenExpenses = expensesByLocation.find((r) => r.location === "canteen")?.total_amount ?? 0;
  // Admin-only business-wide expenses (rent, salaries, etc. — location is
  // null, see 20260721070000_admin_business_wide_expenses.sql). Not
  // attributable to either location's own P&L split, but still netted out
  // of the combined figure below.
  const businessWideExpenses = expensesByLocation.find((r) => r.location === null)?.total_amount ?? 0;
  const restaurantStaffMeals = staffMealsByLocation.find((r) => r.location === "restaurant")?.value ?? 0;
  const canteenStaffMeals = staffMealsByLocation.find((r) => r.location === "canteen")?.value ?? 0;

  const combined = {
    salesValue: (restaurantStock?.sales_value ?? 0) + (canteenStock?.sales_value ?? 0),
    costValue: (restaurantStock?.cost_value ?? 0) + (canteenStock?.cost_value ?? 0),
    // Ingredient wastage is restaurant-only (§3.2) — folded into the
    // combined figure, but not attributed to canteen's per-location split.
    wastageValue:
      (restaurantStock?.wastage_value ?? 0) +
      (canteenStock?.wastage_value ?? 0) +
      ingredientSummary.wastage_value,
    // Staff meals (§3.5) — a distinct figure from wastageValue, never
    // folded into it. Restaurant-only in practice today (canteen items
    // can't currently be claimed as a staff meal from canteen's own
    // screen — canteen staff use the same /expenses tab, scoped to their
    // own location like every other write path), but summed the same
    // both-locations way as expenses/wastage for forward consistency.
    staffMealValue: restaurantStaffMeals + canteenStaffMeals,
    closingStockValue:
      (restaurantStock?.closing_stock_value ?? 0) +
      (canteenStock?.closing_stock_value ?? 0) +
      ingredientSummary.closing_stock_value,
    expenses: restaurantExpenses + canteenExpenses + businessWideExpenses,
    businessWideExpenses,
  };

  const netProfitCombined = netProfit(combined);

  const byLocation = {
    restaurant: {
      salesValue: restaurantStock?.sales_value ?? 0,
      costValue: restaurantStock?.cost_value ?? 0,
      wastageValue: (restaurantStock?.wastage_value ?? 0) + ingredientSummary.wastage_value,
      staffMealValue: restaurantStaffMeals,
      closingStockValue: (restaurantStock?.closing_stock_value ?? 0) + ingredientSummary.closing_stock_value,
      expenses: restaurantExpenses,
      netProfit: netProfit({
        salesValue: restaurantStock?.sales_value ?? 0,
        costValue: restaurantStock?.cost_value ?? 0,
        wastageValue: (restaurantStock?.wastage_value ?? 0) + ingredientSummary.wastage_value,
        staffMealValue: restaurantStaffMeals,
        expenses: restaurantExpenses,
      }),
    },
    canteen: {
      salesValue: canteenStock?.sales_value ?? 0,
      costValue: canteenStock?.cost_value ?? 0,
      wastageValue: canteenStock?.wastage_value ?? 0,
      staffMealValue: canteenStaffMeals,
      closingStockValue: canteenStock?.closing_stock_value ?? 0,
      expenses: canteenExpenses,
      netProfit: netProfit({
        salesValue: canteenStock?.sales_value ?? 0,
        costValue: canteenStock?.cost_value ?? 0,
        wastageValue: canteenStock?.wastage_value ?? 0,
        staffMealValue: canteenStaffMeals,
        expenses: canteenExpenses,
      }),
    },
  };

  return NextResponse.json({
    period,
    from,
    to,
    combined: { ...combined, netProfit: netProfitCombined },
    byLocation,
    trend: trendRes.data ?? [],
    lowStockItems: lowStockItemsRes.data ?? [],
    lowStockIngredients: lowStockIngredientsRes.data ?? [],
  });
}
