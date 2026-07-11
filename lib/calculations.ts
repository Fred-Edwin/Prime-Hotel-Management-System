/**
 * Single source of truth for stock/profit math — see docs/01_DATA_MODEL.md §3.
 * Never re-implement this math in a route handler or component.
 */

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
