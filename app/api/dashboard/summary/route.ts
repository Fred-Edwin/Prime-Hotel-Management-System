import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { dashboardPeriodRange, netProfit, periodicCogs, type DashboardPeriod } from "@/lib/calculations";
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
 * 20260721120000_dashboard_stock_quantity_columns.sql,
 * 20260721140000_dashboard_periodic_cogs_columns.sql) — this route only
 * combines already-aggregated numbers, never sums raw rows in JS.
 *
 * COGS methodology (post-launch change, 2026-07-21, client-directed —
 * WaPrecious): `combined`/`byLocation.restaurant`'s costValue is now
 * `periodicCogs()` (lib/calculations.ts) — her own Excel-era formula,
 * Opening Stock Value + Added Stock Value − Closing Stock Value —
 * computed over items AND ingredients COMBINED into one figure, per her
 * explicit confirmation that she wants the two closing-stock values added
 * together. This deliberately double-counts an in-house-cooked item's own
 * buying_price against the ingredient cost that produced it (e.g.
 * Chapati's own price + the flour used to make it) — a known overlap
 * accepted by the client, not a bug; see docs/01_DATA_MODEL.md §3.2's
 * note. `byLocation.canteen` has no ingredients (§3.2, restaurant-only),
 * so canteen's costValue is items-only periodic COGS. The dashboard's
 * daily TREND chart (`dashboard_daily_trend()`) deliberately still uses
 * the OLD quantity_sold * buying_price_snapshot cost_value — periodic
 * COGS only makes sense over a real range, a single day's opening/added/
 * closing swings don't represent "cost of what moved that day."
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
 *
 * Net profit no longer subtracts wastage/staff-meal/complimentary-meal/
 * stock-adjustment value (client-directed change, 2026-07-22 — see
 * docs/backlog/05_stock_consumption.md, lib/calculations.ts's netProfit()
 * doc comment). Since periodicCogs() derives cost from the change in
 * stock value over a period, and all four of those categories already
 * reduce closing_stock, their cost is already embedded in costValue —
 * subtracting them again in netProfit() double-counted it. They remain
 * visible as `stockConsumption`, a combined total + per-category
 * breakdown, purely for stock-control reporting — never fed into
 * netProfit()'s inputs.
 *
 * estimatedTotal/estimatedValue fields (post-launch addition, 2026-07-23
 * — see docs/01_DATA_MODEL.md §3.11): WaPrecious zeroed items.buying_price
 * for most ingredient-cooked menu items (§3.10), which correctly zeroes
 * their real wastageValue/staffMealValue/etc. too — but that also makes
 * those figures uninformative for stock-control purposes ("how much are
 * we actually losing to waste/staff meals" reads as KES 0 even when real
 * stock moved). estimatedTotal/estimatedValue substitute
 * selling_price * app_settings.estimated_cost_ratio ONLY when
 * buying_price is 0 (see public.effective_unit_cost() /
 * lib/calculations.ts's effectiveUnitCost()) — purely a parallel display
 * figure. They are never fed into costValue/closingStockValue/
 * periodicCogs()/netProfit() — those keep using the real, possibly-zero
 * buying_price, exactly as before.
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
    complimentaryMealSummaryRes,
    stockAdjustmentSummaryRes,
    trendRes,
    lowStockItemsRes,
    lowStockIngredientsRes,
  ] = await Promise.all([
    supabase.rpc("dashboard_stock_summary", { p_from: from, p_to: to }),
    supabase.rpc("dashboard_ingredient_summary", { p_from: from, p_to: to }),
    supabase.rpc("dashboard_expenses_summary", { p_from: from, p_to: to }),
    supabase.rpc("dashboard_staff_meal_summary", { p_from: from, p_to: to }),
    supabase.rpc("dashboard_complimentary_meal_summary", { p_from: from, p_to: to }),
    supabase.rpc("dashboard_stock_adjustment_summary", { p_from: from, p_to: to }),
    supabase.rpc("dashboard_daily_trend", { p_from: from, p_to: to }),
    supabase.rpc("dashboard_low_stock_items"),
    supabase.rpc("dashboard_low_stock_ingredients"),
  ]);

  for (const res of [
    stockSummaryRes,
    ingredientSummaryRes,
    expensesSummaryRes,
    staffMealSummaryRes,
    complimentaryMealSummaryRes,
    stockAdjustmentSummaryRes,
    trendRes,
    lowStockItemsRes,
    lowStockIngredientsRes,
  ]) {
    if (res.error) return serverErrorResponse(res.error, "dashboard/summary");
  }

  const stockByLocation = stockSummaryRes.data ?? [];
  const expensesByLocation = expensesSummaryRes.data ?? [];
  const staffMealsByLocation = staffMealSummaryRes.data ?? [];
  const complimentaryMealsByLocation = complimentaryMealSummaryRes.data ?? [];
  const stockAdjustmentsByLocation = stockAdjustmentSummaryRes.data ?? [];
  const ingredientSummary = ingredientSummaryRes.data?.[0] ?? {
    wastage_value: 0,
    closing_stock_value: 0,
    opening_stock: 0,
    opening_stock_value: 0,
    received: 0,
    received_value: 0,
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
  const restaurantStaffMealsEstimated =
    staffMealsByLocation.find((r) => r.location === "restaurant")?.estimated_value ?? 0;
  const canteenStaffMealsEstimated = staffMealsByLocation.find((r) => r.location === "canteen")?.estimated_value ?? 0;
  const restaurantComplimentaryMeals =
    complimentaryMealsByLocation.find((r) => r.location === "restaurant")?.value ?? 0;
  const canteenComplimentaryMeals =
    complimentaryMealsByLocation.find((r) => r.location === "canteen")?.value ?? 0;
  const restaurantComplimentaryMealsEstimated =
    complimentaryMealsByLocation.find((r) => r.location === "restaurant")?.estimated_value ?? 0;
  const canteenComplimentaryMealsEstimated =
    complimentaryMealsByLocation.find((r) => r.location === "canteen")?.estimated_value ?? 0;
  const restaurantStockAdjustments =
    stockAdjustmentsByLocation.find((r) => r.location === "restaurant")?.value ?? 0;
  const canteenStockAdjustments =
    stockAdjustmentsByLocation.find((r) => r.location === "canteen")?.value ?? 0;
  const restaurantStockAdjustmentsEstimated =
    stockAdjustmentsByLocation.find((r) => r.location === "restaurant")?.estimated_value ?? 0;
  const canteenStockAdjustmentsEstimated =
    stockAdjustmentsByLocation.find((r) => r.location === "canteen")?.estimated_value ?? 0;

  // Combined periodic COGS (client formula, see route doc comment above):
  // items' + ingredients' opening/added/closing VALUES all summed
  // together before the single opening+added-closing subtraction, per
  // WaPrecious's explicit instruction to add the two closing-stock values
  // together into one figure.
  const combinedCostValue = periodicCogs({
    openingStockValue:
      (restaurantStock?.opening_stock_value ?? 0) +
      (canteenStock?.opening_stock_value ?? 0) +
      ingredientSummary.opening_stock_value,
    addedStockValue:
      (restaurantStock?.added_stock_value ?? 0) +
      (canteenStock?.added_stock_value ?? 0) +
      ingredientSummary.received_value,
    closingStockValue:
      (restaurantStock?.closing_stock_value ?? 0) +
      (canteenStock?.closing_stock_value ?? 0) +
      ingredientSummary.closing_stock_value,
  });

  const combinedWastageValue =
    (restaurantStock?.wastage_value ?? 0) + (canteenStock?.wastage_value ?? 0) + ingredientSummary.wastage_value;
  // Ingredient wastage has no estimated variant (ingredients were never
  // zeroed, see the ledger migration's note) — its estimated figure is
  // just its own real wastage_value, same as the ledger function does.
  const combinedWastageEstimatedValue =
    (restaurantStock?.wastage_estimated_value ?? 0) +
    (canteenStock?.wastage_estimated_value ?? 0) +
    ingredientSummary.wastage_value;
  const combinedStaffMealValue = restaurantStaffMeals + canteenStaffMeals;
  const combinedStaffMealEstimatedValue = restaurantStaffMealsEstimated + canteenStaffMealsEstimated;
  const combinedComplimentaryMealValue = restaurantComplimentaryMeals + canteenComplimentaryMeals;
  const combinedComplimentaryMealEstimatedValue =
    restaurantComplimentaryMealsEstimated + canteenComplimentaryMealsEstimated;
  const combinedStockAdjustmentValue = restaurantStockAdjustments + canteenStockAdjustments;
  const combinedStockAdjustmentEstimatedValue = restaurantStockAdjustmentsEstimated + canteenStockAdjustmentsEstimated;

  const combined = {
    salesValue: (restaurantStock?.sales_value ?? 0) + (canteenStock?.sales_value ?? 0),
    costValue: combinedCostValue,
    closingStockValue:
      (restaurantStock?.closing_stock_value ?? 0) +
      (canteenStock?.closing_stock_value ?? 0) +
      ingredientSummary.closing_stock_value,
    expenses: restaurantExpenses + canteenExpenses + businessWideExpenses,
    businessWideExpenses,
  };

  const netProfitCombined = netProfit(combined);

  // Stock Consumption (docs/backlog/05_stock_consumption.md, 2026-07-22):
  // wastage + staff meals + complimentary meals + stock adjustments,
  // reporting-only — none of these four feed netProfit()'s inputs
  // anymore (their cost is already embedded in costValue via reduced
  // closing stock). Combined total + per-category breakdown, mirroring
  // how `combined`/`byLocation` already separate a total from its parts.
  const stockConsumption = {
    total:
      combinedWastageValue + combinedStaffMealValue + combinedComplimentaryMealValue + combinedStockAdjustmentValue,
    wastageValue: combinedWastageValue,
    staffMealValue: combinedStaffMealValue,
    complimentaryMealValue: combinedComplimentaryMealValue,
    stockAdjustmentValue: combinedStockAdjustmentValue,
    estimatedTotal:
      combinedWastageEstimatedValue +
      combinedStaffMealEstimatedValue +
      combinedComplimentaryMealEstimatedValue +
      combinedStockAdjustmentEstimatedValue,
    wastageEstimatedValue: combinedWastageEstimatedValue,
    staffMealEstimatedValue: combinedStaffMealEstimatedValue,
    complimentaryMealEstimatedValue: combinedComplimentaryMealEstimatedValue,
    stockAdjustmentEstimatedValue: combinedStockAdjustmentEstimatedValue,
  };

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
  // Restaurant's periodic COGS folds in ingredients (its own central
  // store, §3.2) — same combined-values approach as `combined` above,
  // just scoped to restaurant's items instead of items+canteen. Canteen
  // has no ingredients of its own, so its COGS below stays items-only.
  const restaurantCostValue = periodicCogs({
    openingStockValue: (restaurantStock?.opening_stock_value ?? 0) + ingredientSummary.opening_stock_value,
    addedStockValue: (restaurantStock?.added_stock_value ?? 0) + ingredientSummary.received_value,
    closingStockValue: (restaurantStock?.closing_stock_value ?? 0) + ingredientSummary.closing_stock_value,
  });
  const canteenCostValue = periodicCogs({
    openingStockValue: canteenStock?.opening_stock_value ?? 0,
    addedStockValue: canteenStock?.added_stock_value ?? 0,
    closingStockValue: canteenStock?.closing_stock_value ?? 0,
  });

  const restaurantWastageValue = (restaurantStock?.wastage_value ?? 0) + ingredientSummary.wastage_value;
  const canteenWastageValue = canteenStock?.wastage_value ?? 0;
  const restaurantWastageEstimatedValue =
    (restaurantStock?.wastage_estimated_value ?? 0) + ingredientSummary.wastage_value;
  const canteenWastageEstimatedValue = canteenStock?.wastage_estimated_value ?? 0;

  const byLocation = {
    restaurant: {
      salesValue: restaurantStock?.sales_value ?? 0,
      costValue: restaurantCostValue,
      closingStockValue: restaurantStock?.closing_stock_value ?? 0,
      openingStock: restaurantStock?.opening_stock ?? 0,
      addedStock: restaurantStock?.added_stock ?? 0,
      sentOut: restaurantStock?.sent_out ?? 0,
      quantitySold: restaurantStock?.quantity_sold ?? 0,
      closingStock: restaurantStock?.closing_stock ?? 0,
      expenses: restaurantExpenses,
      netProfit: netProfit({
        salesValue: restaurantStock?.sales_value ?? 0,
        costValue: restaurantCostValue,
        expenses: restaurantExpenses,
      }),
      stockConsumption: {
        total: restaurantWastageValue + restaurantStaffMeals + restaurantComplimentaryMeals + restaurantStockAdjustments,
        wastageValue: restaurantWastageValue,
        staffMealValue: restaurantStaffMeals,
        complimentaryMealValue: restaurantComplimentaryMeals,
        stockAdjustmentValue: restaurantStockAdjustments,
        estimatedTotal:
          restaurantWastageEstimatedValue +
          restaurantStaffMealsEstimated +
          restaurantComplimentaryMealsEstimated +
          restaurantStockAdjustmentsEstimated,
        wastageEstimatedValue: restaurantWastageEstimatedValue,
        staffMealEstimatedValue: restaurantStaffMealsEstimated,
        complimentaryMealEstimatedValue: restaurantComplimentaryMealsEstimated,
        stockAdjustmentEstimatedValue: restaurantStockAdjustmentsEstimated,
      },
    },
    canteen: {
      salesValue: canteenStock?.sales_value ?? 0,
      costValue: canteenCostValue,
      closingStockValue: canteenStock?.closing_stock_value ?? 0,
      openingStock: canteenStock?.opening_stock ?? 0,
      addedStock: canteenStock?.added_stock ?? 0,
      sentOut: canteenStock?.sent_out ?? 0,
      quantitySold: canteenStock?.quantity_sold ?? 0,
      closingStock: canteenStock?.closing_stock ?? 0,
      expenses: canteenExpenses,
      netProfit: netProfit({
        salesValue: canteenStock?.sales_value ?? 0,
        costValue: canteenCostValue,
        expenses: canteenExpenses,
      }),
      stockConsumption: {
        total: canteenWastageValue + canteenStaffMeals + canteenComplimentaryMeals + canteenStockAdjustments,
        wastageValue: canteenWastageValue,
        staffMealValue: canteenStaffMeals,
        complimentaryMealValue: canteenComplimentaryMeals,
        stockAdjustmentValue: canteenStockAdjustments,
        estimatedTotal:
          canteenWastageEstimatedValue +
          canteenStaffMealsEstimated +
          canteenComplimentaryMealsEstimated +
          canteenStockAdjustmentsEstimated,
        wastageEstimatedValue: canteenWastageEstimatedValue,
        staffMealEstimatedValue: canteenStaffMealsEstimated,
        complimentaryMealEstimatedValue: canteenComplimentaryMealsEstimated,
        stockAdjustmentEstimatedValue: canteenStockAdjustmentsEstimated,
      },
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
    combined: { ...combined, netProfit: netProfitCombined, stockConsumption },
    byLocation,
    ingredients,
    trend: trendRes.data ?? [],
    lowStockItems: lowStockItemsRes.data ?? [],
    lowStockIngredients: lowStockIngredientsRes.data ?? [],
  });
}
