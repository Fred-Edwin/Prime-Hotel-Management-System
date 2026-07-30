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
}

/**
 * total_stock = opening_stock + added_stock. Not stored (§3) — only used
 * momentarily during entry/validation.
 */
export function totalStock(openingStock: number, addedStock: number): number {
  return openingStock + addedStock;
}

/**
 * wastageValue (docs/01_DATA_MODEL.md §3.11, simplified 2026-07-23):
 * quantity * sellingPriceSnapshot * estimatedCostRatio — unconditional,
 * regardless of buyingPriceSnapshot. Snapshotted at entry time, same as
 * every other price in this schema. buyingPriceSnapshot/costValue/
 * closingStockValue/periodicCogs()/netProfit() are untouched by this —
 * they keep using the real buying price exactly as before.
 */
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
    wastageValue: wastage * sellingPriceSnapshot * estimatedCostRatio,
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
 * sales_value - cost_value - expenses - assetPurchases. Both inputs are
 * already period/location-aggregated in SQL before reaching this function —
 * this is a pure combining step, never a re-derivation of either input.
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
 * assetPurchases (post-launch addition, 2026-07-28 — see the asset-register
 * subsection of docs/01_DATA_MODEL.md) is DIFFERENT from the four
 * categories above and genuinely IS subtracted: a durable-asset purchase
 * (a new pot, cutlery) has no `closing_stock` anywhere in this schema to
 * embed its cost into — assets aren't sellable stock, so there's no other
 * place its cost is already accounted for. Optional, defaults to 0 so
 * every pre-existing caller (byLocation.restaurant/canteen, which have no
 * asset-purchase concept of their own) is unaffected. Asset LOSSES
 * (breakage) are the opposite — reporting-only, same treatment as
 * wastage, since a loss is a sunk cost already reflected in the business
 * no longer owning the item, not a new deduction against sales.
 *
 * costValue is expected to be splitCogs()'s costOfGoodsSold output (post-
 * launch change, 2026-07-30, docs/01_DATA_MODEL.md §3.18) — NOT
 * periodicCogs()'s raw combined figure. The combined figure also includes
 * stockRevaluation (a price-edit artifact, not real trading cost), which
 * must stay OUT of net profit entirely, same reporting-only treatment as
 * wastage/staff meals/complimentary meals/stock adjustments above.
 */
export function netProfit(params: {
  salesValue: number;
  costValue: number;
  expenses: number;
  assetPurchases?: number;
}): number {
  return params.salesValue - params.costValue - params.expenses - (params.assetPurchases ?? 0);
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
 *
 * As of the split below (docs/01_DATA_MODEL.md §3.18), this raw combined
 * figure is still computed (it's exactly costOfGoodsSold + stockRevaluation
 * from splitCogs()) but is no longer what feeds netProfit() directly — see
 * splitCogs().
 */
export function periodicCogs(params: {
  openingStockValue: number;
  addedStockValue: number;
  closingStockValue: number;
}): number {
  return params.openingStockValue + params.addedStockValue - params.closingStockValue;
}

/**
 * Splits periodicCogs()'s combined figure into "Cost of Goods Sold" (the
 * real trading cost) and "Stock Revaluation" (a price-edit artifact) —
 * client-agreed change, 2026-07-30, see docs/01_DATA_MODEL.md §3.18.
 *
 * periodicCogs() = Opening + Added − Closing correctly measures total cost
 * IF the per-unit price never changes mid-period. When WaPrecious edits an
 * item/ingredient's buying_price while units of it are still sitting in
 * stock, the SAME formula also captures that price edit as if it were cost
 * — e.g. editing "Printing/Papers" from KES 3.50 to KES 1.00 while 94+416
 * units sat untouched manufactured ~KES 1,275 of apparent "cost of goods"
 * for stock nothing had sold or used. She edits buying prices frequently
 * (real supplier costs fluctuate), so this isn't a one-off — it's a
 * recurring source of noise in her COGS/net-profit figures.
 *
 * revaluationValue is computed in SQL (dashboard_stock_summary()/
 * dashboard_ingredient_summary(), 20260730180000_split_cogs_sold_vs_
 * revaluation.sql), per item/location (items) or per ingredient
 * (ingredients), as:
 *
 *   closing_stock_qty * (closing_unit_price − opening_unit_price)
 *
 * i.e. exactly the value swing on units that are STILL ON HAND at period
 * end, attributable purely to the difference between the unit price now in
 * effect and the unit price in effect at period start — zero whenever the
 * price never changed intra-period, by construction. Summed across every
 * item/ingredient before reaching this function, same "SQL sums, JS
 * combines" division of responsibility as periodicCogs()'s own inputs.
 *
 * costOfGoodsSold is a strict decomposition, not a new formula: it always
 * equals combinedCostValue − revaluationValue, so
 * costOfGoodsSold + revaluationValue === periodicCogs()'s old combined
 * output exactly. costOfGoodsSold is what now feeds netProfit() (the real
 * trading-cost figure); stockRevaluation is reporting-only, shown
 * separately, NEVER netted into profit — same treatment as wastage/staff
 * meals/complimentary meals/stock adjustments (§3.10). This applies to
 * every period, past and present, since it only changes how already-
 * stored, already-correct values are READ and LABELED — no stored row
 * (buying_price_snapshot, closing_stock_value, etc.) is ever rewritten.
 */
export function splitCogs(params: {
  openingStockValue: number;
  addedStockValue: number;
  closingStockValue: number;
  revaluationValue: number;
}): { costOfGoodsSold: number; stockRevaluation: number } {
  const combinedCostValue = periodicCogs(params);
  return {
    costOfGoodsSold: combinedCostValue - params.revaluationValue,
    stockRevaluation: params.revaluationValue,
  };
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
