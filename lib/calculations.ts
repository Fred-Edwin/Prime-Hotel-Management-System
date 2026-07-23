/**
 * Single source of truth for stock/profit math — see docs/01_DATA_MODEL.md §3.
 * Never re-implement this math in a route handler or component.
 */

/**
 * Prosper Hotel operates in Nairobi (Africa/Nairobi, UTC+3, no DST — this
 * offset never changes). All "what date/day is it right now" logic in this
 * app — server routes and client components alike — must go through
 * nairobiNow()/nairobiToday(), never raw `new Date()`/`toISOString()`.
 * Vercel serverless functions default to UTC, so a bare `new Date()` on the
 * server is up to 3 hours behind Nairobi wall-clock time — e.g. an order
 * placed at 1am Nairobi time would otherwise be dated to the previous day.
 */
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Current instant, shifted so its UTC getters read as Nairobi wall-clock time. */
export function nairobiNow(): Date {
  return new Date(Date.now() + NAIROBI_OFFSET_MS);
}

/** Today's date in Nairobi, as YYYY-MM-DD. */
export function nairobiToday(): string {
  return nairobiNow().toISOString().slice(0, 10);
}

export interface StockEntryTotals {
  closingStock: number;
  salesValue: number;
  costValue: number;
  closingStockValue: number;
  wastageValue: number;
  wastageEstimatedValue: number;
}

/**
 * total_stock = opening_stock + added_stock. Not stored (§3) — only used
 * momentarily during entry/validation.
 */
export function totalStock(openingStock: number, addedStock: number): number {
  return openingStock + addedStock;
}

/**
 * Fallback per-unit cost used ONLY for the *_estimated_value reporting
 * figures (docs/01_DATA_MODEL.md §3.11, client feedback 2026-07-23):
 * WaPrecious zeroes items.buying_price for most ingredient-cooked menu
 * items to avoid double-counting cost against ingredient-level tracking
 * (§3.10). That's correct and stays — but it makes wastage_value/
 * staff_meal value/etc. collapse to 0 for those items even though real
 * stock moved. This function is the ONE place the fallback is expressed
 * — mirrors the SQL helper public.effective_unit_cost() exactly. Used
 * only to derive wastageEstimatedValue/estimated_value display figures,
 * NEVER buyingPriceSnapshot/costValue/closingStockValue/periodicCogs()/
 * netProfit() — those stay real-buying-price-only, untouched.
 */
export function effectiveUnitCost(
  buyingPrice: number,
  sellingPrice: number,
  estimatedCostRatio: number,
): number {
  return buyingPrice > 0 ? buyingPrice : sellingPrice * estimatedCostRatio;
}

export function calculateStockEntryTotals(params: {
  openingStock: number;
  addedStock: number;
  sentOut: number;
  quantitySold: number;
  wastage: number;
  staffMeals: number;
  complimentaryMeals: number;
  stockAdjustments: number;
  sellingPriceSnapshot: number;
  buyingPriceSnapshot: number;
  estimatedCostRatio: number;
}): StockEntryTotals {
  const {
    openingStock,
    addedStock,
    sentOut,
    quantitySold,
    wastage,
    staffMeals,
    complimentaryMeals,
    stockAdjustments,
    sellingPriceSnapshot,
    buyingPriceSnapshot,
    estimatedCostRatio,
  } = params;

  const closingStock =
    totalStock(openingStock, addedStock) -
    sentOut -
    quantitySold -
    wastage -
    staffMeals -
    complimentaryMeals -
    stockAdjustments;

  return {
    closingStock,
    salesValue: quantitySold * sellingPriceSnapshot,
    costValue: quantitySold * buyingPriceSnapshot,
    closingStockValue: closingStock * buyingPriceSnapshot,
    wastageValue: wastage * buyingPriceSnapshot,
    wastageEstimatedValue: wastage * effectiveUnitCost(buyingPriceSnapshot, sellingPriceSnapshot, estimatedCostRatio),
  };
}

/**
 * §3 validation rule: reject a write where sent_out + quantity_sold +
 * wastage + staff_meals + complimentary_meals + stock_adjustments >
 * total_stock (docs/backlog/05_stock_consumption.md added the last two
 * terms, 2026-07-22). Must be checked against the COMBINED quantity_sold
 * (till + orders) and the combined staff_meals/complimentary_meals/
 * stock_adjustments (each a sum over its own entries table for that
 * item/location/period), not just one write-path's contribution — see
 * §3.4.
 *
 * stockAdjustments is SIGNED (docs/backlog/05_stock_consumption.md,
 * signed follow-up, 2026-07-22): positive = shortfall (removes stock,
 * same direction as every other term here), negative = surplus (stock
 * found, added back). This formula needs no special-casing for the sign
 * — a negative stockAdjustments only ever shrinks the left-hand side, so
 * a surplus can never trigger a false oversell rejection, while a
 * shortfall is still capped exactly like wastage/staff meals/
 * complimentary meals.
 */
export function isStockEntryOversold(params: {
  openingStock: number;
  addedStock: number;
  sentOut: number;
  quantitySold: number;
  wastage: number;
  staffMeals: number;
  complimentaryMeals: number;
  stockAdjustments: number;
}): boolean {
  const {
    openingStock,
    addedStock,
    sentOut,
    quantitySold,
    wastage,
    staffMeals,
    complimentaryMeals,
    stockAdjustments,
  } = params;
  return (
    sentOut + quantitySold + wastage + staffMeals + complimentaryMeals + stockAdjustments >
    totalStock(openingStock, addedStock)
  );
}

export interface IngredientEntryTotals {
  closingStock: number;
  closingStockValue: number;
  wastageValue: number;
}

export function calculateIngredientEntryTotals(params: {
  openingStock: number;
  received: number;
  quantityUsed: number;
  wastage: number;
  buyingPriceSnapshot: number;
}): IngredientEntryTotals {
  const { openingStock, received, quantityUsed, wastage, buyingPriceSnapshot } = params;
  const closingStock = openingStock + received - quantityUsed - wastage;

  return {
    closingStock,
    closingStockValue: closingStock * buyingPriceSnapshot,
    wastageValue: wastage * buyingPriceSnapshot,
  };
}

/**
 * Same oversell principle as stock_entries, applied to ingredients (§3):
 * reject quantity_used + wastage > opening_stock + received.
 */
export function isIngredientEntryOversold(params: {
  openingStock: number;
  received: number;
  quantityUsed: number;
  wastage: number;
}): boolean {
  const { openingStock, received, quantityUsed, wastage } = params;
  return quantityUsed + wastage > openingStock + received;
}

/**
 * Monday-start-of-week helper, used by dashboardPeriodRange()'s "week"
 * period toggle. No longer used for canteen's stock_entries cadence
 * (canteen converted to daily — see docs/01_DATA_MODEL.md §3.1) — kept
 * here purely for the dashboard's Week view. Sunday counts as the end
 * of the same week, not the start of a new one.
 */
export function weekStartMonday(date: Date): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay(); // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  utc.setUTCDate(utc.getUTCDate() + diffToMonday);
  return utc.toISOString().slice(0, 10);
}

/** The Sunday that closes the week started by weekStartMonday's output. */
export function weekEndSunday(weekStartISO: string): string {
  const start = new Date(`${weekStartISO}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + 6);
  return start.toISOString().slice(0, 10);
}

export type DashboardPeriod = "today" | "week" | "month";

/**
 * Admin dashboard period boundaries (Components §4.8 Period Toggle,
 * 04_PHASE_PLAN.md Phase 7). Shared by both dashboard API routes
 * (summary + ledger) so "today/week/month" means exactly the same date
 * range everywhere — never reimplemented per route. Week reuses
 * weekStartMonday/weekEndSunday above (Monday–Sunday, for the dashboard's
 * Week toggle only — orthogonal to either location's storage cadence).
 * Month is calendar-month-to-date-bounded (1st through the month's last
 * day), matching the Period Toggle's plain "this month" framing in the
 * PRD.
 */
export function dashboardPeriodRange(period: DashboardPeriod): { from: string; to: string } {
  const now = nairobiNow();
  const todayISO = now.toISOString().slice(0, 10);

  if (period === "today") {
    return { from: todayISO, to: todayISO };
  }

  if (period === "week") {
    const from = weekStartMonday(now);
    return { from, to: weekEndSunday(from) };
  }

  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const from = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}

/**
 * Order total (docs/01_DATA_MODEL.md §6): sum(order_items.quantity *
 * selling_price_snapshot) + delivery_fee_snapshot. delivery_fee_snapshot
 * is 0 for pickup orders (schema default) — same formula either way.
 */
export function orderTotal(params: {
  items: { quantity: number; sellingPriceSnapshot: number }[];
  deliveryFeeSnapshot: number;
}): number {
  const itemsTotal = params.items.reduce(
    (sum, item) => sum + item.quantity * item.sellingPriceSnapshot,
    0,
  );
  return itemsTotal + params.deliveryFeeSnapshot;
}

/**
 * Admin dashboard net profit (04_PHASE_PLAN.md Phase 7, docs/01_DATA_MODEL.md
 * §3.3, revised per docs/backlog/05_stock_consumption.md, 2026-07-22):
 * sales_value - cost_value - expenses. Both inputs are already
 * period/location-aggregated in SQL before reaching this function — this
 * is a pure combining step, never a re-derivation of either input.
 *
 * wastage/staff-meal/complimentary-meal/stock-adjustment values are
 * DELIBERATELY NOT subtracted here (client-directed change, 2026-07-22 —
 * WaPrecious). Since periodicCogs() (below) derives cost from the change
 * in stock value over a period, and all four of those categories already
 * reduce closing_stock (§3.3, §3.5, §3.10), their cost is already
 * embedded in costValue. Subtracting them again here double-counted that
 * cost against net profit. They remain visible, reporting-only figures
 * (the dashboard's "Stock Consumption" section) — informational, not a
 * profit deduction.
 *
 * costValue is expected to be periodicCogs()'s output as of the post-launch
 * COGS methodology change (2026-07-21) — see that function's doc comment.
 */
export function netProfit(params: {
  salesValue: number;
  costValue: number;
  expenses: number;
}): number {
  return params.salesValue - params.costValue - params.expenses;
}

/**
 * COGS via the client's (WaPrecious) own periodic-inventory method —
 * replaces the previous quantity_sold * buying_price_snapshot approach on
 * the admin dashboard (post-launch change, 2026-07-21, client-directed):
 *
 *   COGS = Opening Stock Value + Added Stock Value - Closing Stock Value
 *
 * This is the same formula she already used on her Excel sheet, applied to
 * a combined items+ingredients figure — she explicitly confirmed she wants
 * the two closing-stock VALUES added together into one COGS, accepting
 * that an in-house-cooked item's own buying_price and the ingredient cost
 * that produced it both contribute (a genuine overlap vs. a formal
 * bill-of-materials system, but not something this app models — see
 * docs/01_DATA_MODEL.md §3.2/§3 note added alongside this change).
 *
 * Each of the three inputs must already be a period-correct VALUE (money,
 * not quantity) from the dashboard_stock_summary()/dashboard_ingredient_
 * summary() SQL functions — opening/added priced at each row's own
 * buying_price_snapshot, closing priced the same way, never today's
 * catalog price. This function is a pure combining step, same convention
 * as netProfit() above.
 *
 * Only meaningful over a genuine date RANGE, not a single day — do not use
 * this for the dashboard's daily trend chart, which stays on the older
 * quantity_sold-based cost_value (a single day's opening/added/closing
 * swings don't represent "cost of what moved that day" the way a
 * sold-based daily figure does).
 */
export function periodicCogs(params: {
  openingStockValue: number;
  addedStockValue: number;
  closingStockValue: number;
}): number {
  return params.openingStockValue + params.addedStockValue - params.closingStockValue;
}

/**
 * Low-stock check (docs/01_DATA_MODEL.md §2 items.low_stock_threshold,
 * added Phase 7 — see that migration's comment for why no such field
 * existed before this phase). A stock/ingredient row is "low" when its
 * closing_stock is at or below the item/ingredient's own threshold —
 * matches Components §4.9's indicator, shown wherever stock is displayed.
 */
export function isLowStock(closingStock: number, lowStockThreshold: number): boolean {
  return closingStock <= lowStockThreshold;
}
