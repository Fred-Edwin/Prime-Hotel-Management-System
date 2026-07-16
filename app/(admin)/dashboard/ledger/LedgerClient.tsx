"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { PeriodToggle } from "@/components/PeriodToggle";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { LowStockIndicator } from "@/components/LowStockIndicator";
import { PlaceholderStat } from "@/components/PlaceholderStat";
import { isLowStock } from "@/lib/calculations";
import catalogStyles from "../../catalog.module.css";
import styles from "./ledger.module.css";

type Period = "today" | "week" | "month";
type Location = "restaurant" | "canteen" | "";

interface ItemLedgerRow {
  entry_date: string;
  item_id: string;
  item_name: string;
  location: "restaurant" | "canteen";
  opening_stock: number;
  added_stock: number;
  sent_out: number;
  till_quantity_sold: number;
  quantity_sold: number;
  wastage: number;
  closing_stock: number;
  sales_value: number;
  cost_value: number;
  closing_stock_value: number;
  wastage_value: number;
  low_stock_threshold: number;
}

interface IngredientLedgerRow {
  entry_date: string;
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  opening_stock: number;
  received: number;
  quantity_used: number;
  wastage: number;
  closing_stock: number;
  closing_stock_value: number;
  wastage_value: number;
  low_stock_threshold: number;
}

interface LedgerResponse {
  period: Period;
  from: string;
  to: string;
  items: ItemLedgerRow[];
  ingredients: IngredientLedgerRow[];
}

const PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

const LOCATION_OPTIONS: { value: Location; label: string }[] = [
  { value: "", label: "Both locations" },
  { value: "restaurant", label: "Restaurant" },
  { value: "canteen", label: "Canteen" },
];

function money(value: number): string {
  return `KES ${Math.round(value).toLocaleString("en-KE")}`;
}

function qty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function LedgerClient() {
  const [period, setPeriod] = useState<Period>("week");
  const [location, setLocation] = useState<Location>("");
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [rangeDraft, setRangeDraft] = useState({ from: "", to: "" });
  const [rangePickerOpen, setRangePickerOpen] = useState(false);
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ period });
        if (location) params.set("location", location);
        if (customRange) {
          params.set("from", customRange.from);
          params.set("to", customRange.to);
        }

        const res = await fetch(`/api/dashboard/ledger?${params.toString()}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Failed to load ledger");
        if (!cancelled) setData(json as LedgerResponse);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load ledger");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [period, location, customRange]);

  function selectPeriod(value: Period) {
    setCustomRange(null);
    setPeriod(value);
  }

  function applyCustomRange() {
    if (!rangeDraft.from || !rangeDraft.to || rangeDraft.from > rangeDraft.to) return;
    setCustomRange({ from: rangeDraft.from, to: rangeDraft.to });
    setRangePickerOpen(false);
  }

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={catalogStyles.title}>Item Ledger</h1>
          <Link href="/dashboard" className={styles.backLink}>
            ← Back to dashboard
          </Link>
        </div>
        <div className={styles.controls}>
          <PeriodToggle
            options={PERIOD_OPTIONS}
            value={customRange ? "" : period}
            onChange={(v) => selectPeriod(v as Period)}
          />
          <div className={styles.rangePicker}>
            <button
              type="button"
              className={styles.rangeButton}
              onClick={() => {
                setRangeDraft(customRange ?? { from: "", to: "" });
                setRangePickerOpen((open) => !open);
              }}
            >
              <Icon name="summary" size={16} />
              {customRange ? `${customRange.from} → ${customRange.to}` : "Select range"}
            </button>
            {rangePickerOpen && (
              <div className={styles.rangePopover}>
                <label className={styles.rangeField}>
                  <span>From</span>
                  <input
                    type="date"
                    value={rangeDraft.from}
                    onChange={(e) => setRangeDraft({ ...rangeDraft, from: e.target.value })}
                  />
                </label>
                <label className={styles.rangeField}>
                  <span>To</span>
                  <input
                    type="date"
                    value={rangeDraft.to}
                    onChange={(e) => setRangeDraft({ ...rangeDraft, to: e.target.value })}
                  />
                </label>
                <button type="button" className={styles.rangeApply} onClick={applyCustomRange}>
                  Apply
                </button>
              </div>
            )}
          </div>
          <label className={styles.locationSelect}>
            <select value={location} onChange={(e) => setLocation(e.target.value as Location)}>
              {LOCATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error && <p className={catalogStyles.formError}>{error}</p>}

      {loading && !data ? (
        <p>Loading…</p>
      ) : data ? (
        <>
          <section className={styles.section}>
            {data.items.length === 0 ? (
              <EmptyState
                icon={<Icon name="summary" size={48} />}
                heading="No item entries this period"
                body="Once staff save till or canteen entries, they'll show up here row by row."
              />
            ) : (
              <Card className={catalogStyles.tableCard}>
                <table className={[catalogStyles.table, styles.ledgerTable].join(" ")}>
                  <thead>
                    <tr>
                      <th colSpan={3} className={styles.groupHeader}>
                        Identity
                      </th>
                      <th colSpan={7} className={styles.groupHeader}>
                        Stock movement
                      </th>
                      <th colSpan={4} className={styles.groupHeader}>
                        Inventory value
                      </th>
                      <th className={styles.groupHeader}>Staffing</th>
                    </tr>
                    <tr>
                      <th className={styles.stickyCol}>Date</th>
                      <th>Item</th>
                      <th>Location</th>
                      <th className={catalogStyles.numeric}>Opening</th>
                      <th className={catalogStyles.numeric}>Added</th>
                      <th className={catalogStyles.numeric}>Canteen (S/R)</th>
                      <th className={catalogStyles.numeric}>Sold (Hotel)</th>
                      <th className={catalogStyles.numeric}>Sold (total)</th>
                      <th className={catalogStyles.numeric}>Wastage</th>
                      <th className={catalogStyles.numeric}>Closing</th>
                      <th className={catalogStyles.numeric}>Sales value</th>
                      <th className={catalogStyles.numeric}>Cost value</th>
                      <th className={catalogStyles.numeric}>Closing stock value</th>
                      <th className={catalogStyles.numeric}>Wastage value</th>
                      <th>Staff on shift</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((row) => {
                      const canteenSignedQty =
                        row.location === "canteen" ? row.added_stock : -row.sent_out;
                      return (
                        <tr key={`${row.entry_date}-${row.item_id}-${row.location}`}>
                          <td className={styles.stickyCol}>{row.entry_date}</td>
                          <td>{row.item_name}</td>
                          <td className={styles.locationCell}>
                            {row.location === "restaurant" ? "Restaurant" : "Canteen"}
                          </td>
                          <td className={catalogStyles.numeric}>{qty(row.opening_stock)}</td>
                          <td className={catalogStyles.numeric}>{qty(row.added_stock)}</td>
                          <td className={catalogStyles.numeric}>
                            <span
                              className={
                                canteenSignedQty < 0
                                  ? styles.negativeValue
                                  : canteenSignedQty > 0
                                    ? styles.positiveValue
                                    : undefined
                              }
                            >
                              {canteenSignedQty > 0 ? "+" : ""}
                              {qty(canteenSignedQty)}
                            </span>
                          </td>
                          <td className={catalogStyles.numeric}>{qty(row.till_quantity_sold)}</td>
                          <td className={catalogStyles.numeric}>{qty(row.quantity_sold)}</td>
                          <td className={catalogStyles.numeric}>{qty(row.wastage)}</td>
                          <td className={catalogStyles.numeric}>
                            <span
                              className={
                                isLowStock(row.closing_stock, row.low_stock_threshold)
                                  ? styles.lowValue
                                  : undefined
                              }
                            >
                              {qty(row.closing_stock)}
                            </span>
                          </td>
                          <td className={catalogStyles.numeric}>{money(row.sales_value)}</td>
                          <td className={catalogStyles.numeric}>{money(row.cost_value)}</td>
                          <td className={catalogStyles.numeric}>{money(row.closing_stock_value)}</td>
                          <td className={catalogStyles.numeric}>{money(row.wastage_value)}</td>
                          <td>
                            <PlaceholderStat
                              label="Staff on shift"
                              reason="Coming with the planned lightweight clock-in feature — not built yet, so this column isn't wired to real attendance data."
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            )}
          </section>

          {location !== "canteen" && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>Ingredients</h2>
                <LowStockIndicator variant="pill" label="Restaurant only" />
              </div>
              {data.ingredients.length === 0 ? (
                <EmptyState
                  icon={<Icon name="summary" size={48} />}
                  heading="No ingredient entries this period"
                  body="Once the store manager saves ingredient receiving/usage, they'll show up here."
                />
              ) : (
                <Card className={catalogStyles.tableCard}>
                  <table className={catalogStyles.table}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Ingredient</th>
                        <th className={catalogStyles.numeric}>Opening</th>
                        <th className={catalogStyles.numeric}>Received</th>
                        <th className={catalogStyles.numeric}>Used</th>
                        <th className={catalogStyles.numeric}>Wastage</th>
                        <th className={catalogStyles.numeric}>Closing</th>
                        <th className={catalogStyles.numeric}>Closing value</th>
                        <th className={catalogStyles.numeric}>Wastage value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.ingredients.map((row) => (
                        <tr key={`${row.entry_date}-${row.ingredient_id}`}>
                          <td>{row.entry_date}</td>
                          <td>{row.ingredient_name}</td>
                          <td className={catalogStyles.numeric}>
                            {qty(row.opening_stock)} {row.unit}
                          </td>
                          <td className={catalogStyles.numeric}>
                            {qty(row.received)} {row.unit}
                          </td>
                          <td className={catalogStyles.numeric}>
                            {qty(row.quantity_used)} {row.unit}
                          </td>
                          <td className={catalogStyles.numeric}>
                            {qty(row.wastage)} {row.unit}
                          </td>
                          <td className={catalogStyles.numeric}>
                            <span
                              className={
                                isLowStock(row.closing_stock, row.low_stock_threshold)
                                  ? styles.lowValue
                                  : undefined
                              }
                            >
                              {qty(row.closing_stock)} {row.unit}
                            </span>
                          </td>
                          <td className={catalogStyles.numeric}>{money(row.closing_stock_value)}</td>
                          <td className={catalogStyles.numeric}>{money(row.wastage_value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </section>
          )}
        </>
      ) : null}
    </div>
  );
}
