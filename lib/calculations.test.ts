import { describe, expect, it } from "vitest";
import {
  calculateIngredientEntryTotals,
  calculateStockEntryTotals,
  isIngredientEntryOversold,
  isStockEntryOversold,
  totalStock,
} from "./calculations";

describe("totalStock", () => {
  it("sums opening and added stock", () => {
    expect(totalStock(10, 5)).toBe(15);
  });
});

describe("calculateStockEntryTotals", () => {
  it("computes closing stock and derived values per §3's formulas", () => {
    const result = calculateStockEntryTotals({
      openingStock: 20,
      addedStock: 10,
      sentOut: 5,
      quantitySold: 15,
      wastage: 2,
      sellingPriceSnapshot: 50,
      buyingPriceSnapshot: 30,
    });

    // total_stock = 30, closing = 30 - 5 - 15 - 2 = 8
    expect(result.closingStock).toBe(8);
    expect(result.salesValue).toBe(750); // 15 * 50
    expect(result.costValue).toBe(450); // 15 * 30
    expect(result.closingStockValue).toBe(240); // 8 * 30
    expect(result.wastageValue).toBe(60); // 2 * 30
  });

  it("values wastage at buying price, never selling price", () => {
    const result = calculateStockEntryTotals({
      openingStock: 10,
      addedStock: 0,
      sentOut: 0,
      quantitySold: 0,
      wastage: 4,
      sellingPriceSnapshot: 100,
      buyingPriceSnapshot: 20,
    });

    expect(result.wastageValue).toBe(80); // 4 * 20, not 4 * 100
  });
});

describe("isStockEntryOversold", () => {
  it("rejects when sent_out + quantity_sold + wastage exceeds total_stock", () => {
    expect(
      isStockEntryOversold({
        openingStock: 10,
        addedStock: 0,
        sentOut: 0,
        quantitySold: 8,
        wastage: 3,
      }),
    ).toBe(true);
  });

  it("allows exactly using up total_stock", () => {
    expect(
      isStockEntryOversold({
        openingStock: 10,
        addedStock: 0,
        sentOut: 0,
        quantitySold: 8,
        wastage: 2,
      }),
    ).toBe(false);
  });
});

describe("calculateIngredientEntryTotals", () => {
  it("computes closing stock and values per §3's ingredient formula", () => {
    const result = calculateIngredientEntryTotals({
      openingStock: 5,
      received: 10,
      quantityUsed: 8,
      wastage: 1,
      buyingPriceSnapshot: 40,
    });

    // closing = 5 + 10 - 8 - 1 = 6
    expect(result.closingStock).toBe(6);
    expect(result.closingStockValue).toBe(240); // 6 * 40
    expect(result.wastageValue).toBe(40); // 1 * 40
  });
});

describe("isIngredientEntryOversold", () => {
  it("rejects quantity_used + wastage exceeding opening_stock + received", () => {
    expect(
      isIngredientEntryOversold({
        openingStock: 5,
        received: 5,
        quantityUsed: 9,
        wastage: 2,
      }),
    ).toBe(true);
  });

  it("allows exactly using up available ingredient stock", () => {
    expect(
      isIngredientEntryOversold({
        openingStock: 5,
        received: 5,
        quantityUsed: 9,
        wastage: 1,
      }),
    ).toBe(false);
  });
});
