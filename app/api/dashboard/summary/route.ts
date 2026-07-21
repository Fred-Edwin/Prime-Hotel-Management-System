import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { dashboardPeriodRange, netProfit, type DashboardPeriod } from "@/lib/calculations";
import { serverErrorResponse } from "@/lib/errors";

/**
 * GET /api/dashboard/summary?period=today|week|month
 * GET /api/dashboard/summary?from=YYYY-MM-DD&to=YYYY-MM-DD (custom range, overrides period)
 *
 * Profit dashboard's top-line figures (04_PHASE_PLAN.md Phase 7): sales,
 * cost, wastage (stock_entries + ingredient_entries, §3.3), net profit
 * (lib/calculations.ts netProfit()), closing stock value, per-location
 * split, a daily trend series for the hero band's chart, and the
 * low-stock "Needs attention" list. All aggregation happens in SQL via
 * the public.dashboard_*() functions (see
 * 20260712121500_dashboard_aggregation_functions.sql,
 * 20260721120000_dashboard_stock_quantity_columns.sql) — this route only
 * combines already-aggregated numbers, never sums raw rows in JS.
 *
 * `byLocation.restaurant`/`byLocation.canteen` are menu-item stock
 * (stock_entries) only. `ingredients` (post-launch addition, 2026-07-21)
 * is a third, separate block for raw-material stock (ingredient_entries,
 * restaurant-only, §3.2) — kept out of `byLocation.restaurant` so the
 * client can see menu-item stock (which should trend toward 0 under the
 * "cook it, send it, sell it" model) distinctly from ingredient stock-on-
 * hand and canteen's shop-style standing balance. Ingredient wastage/
 * closing-stock-value still fold into `combined` and into
 * `byLocation.restaurant.netProfit`'s inputs (ingredients have no sales
 * of their own, so their cost only ever surfaces via restaurant's P&L),
 * just not into `byLocation.restaurant.closingStockValue` itself anymore.
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

  // A custom date range (matching the Item Ledger's existing range picker,
  // app/api/dashboard/ledger/route.ts) overrides the period-derived range —
  // same underlying dashboard_*() RPCs, which already take explicit
  // p_from/p_to, so no schema change is needed here.
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
    opening_stock: 0,
    received: 0,
    quantity_used: 0,
    closing_stock: 0,
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

  // Restaurant/canteen menu-item stock, shown separately from ingredients
  // below (post-launch addition, 2026-07-21 — client wants to see, at a
  // glance, that the restaurant's menu-item stock trends toward 0 since
  // its model is "cook it, send it, sell it," while canteen genuinely
  // carries a standing shop-style balance). netProfit still folds
  // ingredient wastage/closing-stock into restaurant's own figure below
  // (ingredients aren't sold, so they don't get an independent P&L —
  // their cost only ever shows up as part of the restaurant's), but the
  // `ingredients` block further down surfaces ingredient stock as its own
  // row for the comparison table, distinct from menu items.
  const byLocation = {
    restaurant: {
      salesValue: restaurantStock?.sales_value ?? 0,
      costValue: restaurantStock?.cost_value ?? 0,
      wastageValue: (restaurantStock?.wastage_value ?? 0) + ingredientSummary.wastage_value,
      staffMealValue: restaurantStaffMeals,
      closingStockValue: restaurantStock?.closing_stock_value ?? 0,
      openingStock: restaurantStock?.opening_stock ?? 0,
      addedStock: restaurantStock?.added_stock ?? 0,
      sentOut: restaurantStock?.sent_out ?? 0,
      quantitySold: restaurantStock?.quantity_sold ?? 0,
      closingStock: restaurantStock?.closing_stock ?? 0,
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
      openingStock: canteenStock?.opening_stock ?? 0,
      addedStock: canteenStock?.added_stock ?? 0,
      sentOut: canteenStock?.sent_out ?? 0,
      quantitySold: canteenStock?.quantity_sold ?? 0,
      closingStock: canteenStock?.closing_stock ?? 0,
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

  // Ingredients: raw materials, not menu items (§3.2) — a third, distinct
  // stock pool. No sales/cost/expenses/net-profit of its own (ingredients
  // are never sold directly), just the stock-level figures the comparison
  // table needs to show it as its own row instead of folded into
  // restaurant's.
  const ingredients = {
    wastageValue: ingredientSummary.wastage_value,
    closingStockValue: ingredientSummary.closing_stock_value,
    openingStock: ingredientSummary.opening_stock,
    received: ingredientSummary.received,
    quantityUsed: ingredientSummary.quantity_used,
    closingStock: ingredientSummary.closing_stock,
  };

  return NextResponse.json({
    period,
    from,
    to,
    combined: { ...combined, netProfit: netProfitCombined },
    byLocation,
    ingredients,
    trend: trendRes.data ?? [],
    lowStockItems: lowStockItemsRes.data ?? [],
    lowStockIngredients: lowStockIngredientsRes.data ?? [],
  });
}
