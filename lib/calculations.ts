/**
 * Single source of truth for stock/profit math — see docs/01_DATA_MODEL.md §3.
 * Never re-implement this math in a route handler or component.
 */

/**
 * Prime Hotel operates in Nairobi (Africa/Nairobi, UTC+3, no DST — this
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

export function calculateStockEntryTotals(params: {
  openingStock: number;
  addedStock: number;
  sentOut: number;
  quantitySold: number;
  wastage: number;
  sellingPriceSnapshot: number;
  buyingPriceSnapshot: number;
}): StockEntryTotals {
  const { openingStock, addedStock, sentOut, quantitySold, wastage, sellingPriceSnapshot, buyingPriceSnapshot } =
    params;

  const closingStock = totalStock(openingStock, addedStock) - sentOut - quantitySold - wastage;

  return {
    closingStock,
    salesValue: quantitySold * sellingPriceSnapshot,
    costValue: quantitySold * buyingPriceSnapshot,
    closingStockValue: closingStock * buyingPriceSnapshot,
    wastageValue: wastage * buyingPriceSnapshot,
  };
}

/**
 * §3 validation rule: reject a write where sent_out + quantity_sold +
 * wastage > total_stock. Must be checked against the COMBINED quantity_sold
 * (till + orders), not just one write-path's contribution — see §3.4.
 */
export function isStockEntryOversold(params: {
  openingStock: number;
  addedStock: number;
  sentOut: number;
  quantitySold: number;
  wastage: number;
}): boolean {
  const { openingStock, addedStock, sentOut, quantitySold, wastage } = params;
  return sentOut + quantitySold + wastage > totalStock(openingStock, addedStock);
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
 * Canteen's weekly entry_date convention (docs/01_DATA_MODEL.md §3.1,
 * 04_PHASE_PLAN.md Phase 5): entry_date is always the Monday of the
 * current ISO week, computed from the given date — never client-typed.
 * Sunday counts as the end of the same week, not the start of a new one.
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
 * weekStartMonday/weekEndSunday above (same convention canteen's cadence
 * already uses). Month is calendar-month-to-date-bounded (1st through the
 * month's last day), matching the Period Toggle's plain "this month"
 * framing in the PRD.
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
 * §3.3): sales_value - cost_value - expenses - wastage_value. All four
 * inputs are already period/location-aggregated in SQL (sum() over
 * stock_entries/ingredient_entries/expenses) before reaching this
 * function — this is a pure combining step, never a re-derivation of any
 * of its inputs. wastageValue must already include BOTH
 * stock_entries.wastage_value and ingredient_entries.wastage_value (§3.3)
 * — this function doesn't know or care which table each unit came from,
 * the caller sums both first.
 */
export function netProfit(params: {
  salesValue: number;
  costValue: number;
  expenses: number;
  wastageValue: number;
}): number {
  return params.salesValue - params.costValue - params.expenses - params.wastageValue;
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
