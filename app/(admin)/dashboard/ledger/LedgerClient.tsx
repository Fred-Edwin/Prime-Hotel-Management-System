"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Input } from "@/components/Input";
import { Modal } from "@/components/Modal";
import { PeriodToggle } from "@/components/PeriodToggle";
import { EmptyState } from "@/components/EmptyState";
import { FilterBar } from "@/components/FilterBar";
import { Icon } from "@/components/Icon";
import { LowStockIndicator } from "@/components/LowStockIndicator";
import { MetricCard } from "@/components/MetricCard";
import { PlaceholderStat } from "@/components/PlaceholderStat";
import { Toast } from "@/components/Toast";
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

/**
 * Admin direct ledger-row edit (docs/backlog/04_admin_ledger_edit.md) — a
 * quantities-only edit form opened from a row's edit affordance, submitted
 * through PATCH /api/dashboard/ledger/entry. Price snapshots are never
 * editable here (resolved design decision #2); the server rejects the edit
 * outright (409) if this isn't the most-recent row for the item/ingredient
 * (resolved design decision #1) — the modal just surfaces that message.
 */
type StockEntryEditTarget = {
  kind: "stock_entries";
  item_id: string;
  item_name: string;
  location: "restaurant" | "canteen";
  entry_date: string;
  till_quantity_sold: number;
  added_stock: number;
  sent_out: number;
  wastage: number;
};

type IngredientEntryEditTarget = {
  kind: "ingredient_entries";
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  entry_date: string;
  received: number;
  quantity_used: number;
  wastage: number;
};

type EditTarget = StockEntryEditTarget | IngredientEntryEditTarget;

export function LedgerClient() {
  const [period, setPeriod] = useState<Period>("week");
  const [location, setLocation] = useState<Location>("");
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [rangeDraft, setRangeDraft] = useState({ from: "", to: "" });
  const [rangePickerOpen, setRangePickerOpen] = useState(false);
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ingredientSearch, setIngredientSearch] = useState("");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [editForm, setEditForm] = useState<Record<string, number>>({});
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  function openStockEntryEdit(row: ItemLedgerRow) {
    setEditError(null);
    setEditTarget({
      kind: "stock_entries",
      item_id: row.item_id,
      item_name: row.item_name,
      location: row.location,
      entry_date: row.entry_date,
      till_quantity_sold: row.till_quantity_sold,
      added_stock: row.added_stock,
      sent_out: row.sent_out,
      wastage: row.wastage,
    });
    setEditForm({
      till_quantity_sold: row.till_quantity_sold,
      added_stock: row.added_stock,
      sent_out: row.sent_out,
      wastage: row.wastage,
    });
  }

  function openIngredientEntryEdit(row: IngredientLedgerRow) {
    setEditError(null);
    setEditTarget({
      kind: "ingredient_entries",
      ingredient_id: row.ingredient_id,
      ingredient_name: row.ingredient_name,
      unit: row.unit,
      entry_date: row.entry_date,
      received: row.received,
      quantity_used: row.quantity_used,
      wastage: row.wastage,
    });
    setEditForm({
      received: row.received,
      quantity_used: row.quantity_used,
      wastage: row.wastage,
    });
  }

  function closeEdit() {
    setEditTarget(null);
    setEditError(null);
  }

  async function submitEdit() {
    if (!editTarget) return;
    setEditSubmitting(true);
    setEditError(null);

    const payload =
      editTarget.kind === "stock_entries"
        ? {
            table: "stock_entries" as const,
            item_id: editTarget.item_id,
            location: editTarget.location,
            entry_date: editTarget.entry_date,
            till_quantity_sold: editForm.till_quantity_sold,
            added_stock: editForm.added_stock,
            sent_out: editForm.sent_out,
            wastage: editForm.wastage,
          }
        : {
            table: "ingredient_entries" as const,
            ingredient_id: editTarget.ingredient_id,
            entry_date: editTarget.entry_date,
            received: editForm.received,
            quantity_used: editForm.quantity_used,
            wastage: editForm.wastage,
          };

    try {
      const res = await fetch("/api/dashboard/ledger/entry", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditError(json.error ?? "Couldn't save — please try again.");
        return;
      }
      setEditTarget(null);
      setToast("Entry updated");
      setReloadKey((key) => key + 1);
    } catch {
      setEditError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setEditSubmitting(false);
    }
  }

  function toggleExpanded(key: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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
  }, [period, location, customRange, reloadKey]);

  function selectPeriod(value: Period) {
    setCustomRange(null);
    setPeriod(value);
  }

  function applyCustomRange() {
    if (!rangeDraft.from || !rangeDraft.to || rangeDraft.from > rangeDraft.to) return;
    setCustomRange({ from: rangeDraft.from, to: rangeDraft.to });
    setRangePickerOpen(false);
  }

  const filteredIngredients =
    data?.ingredients.filter((row) =>
      row.ingredient_name.toLowerCase().includes(ingredientSearch.trim().toLowerCase())
    ) ?? [];

  // Summary strip totals — computed client-side from the already-loaded
  // filtered result set (no new endpoint needed). Answers "how did this
  // period do" at a glance, and gives the page something substantial to
  // show even when the filtered result is a single row.
  const totals = (data?.items ?? []).reduce(
    (acc, row) => ({
      salesValue: acc.salesValue + row.sales_value,
      costValue: acc.costValue + row.cost_value,
      wastageValue: acc.wastageValue + row.wastage_value,
    }),
    { salesValue: 0, costValue: 0, wastageValue: 0 }
  );

  return (
    <div className={`${styles.page} ${styles.pageFullBleed}`}>
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
          {data.items.length > 0 && (
            <div className={styles.summaryStrip}>
              <MetricCard label="Total sales value" value={money(totals.salesValue)} />
              <MetricCard label="Total cost value" value={money(totals.costValue)} />
              <MetricCard label="Total wastage value" value={money(totals.wastageValue)} />
              <MetricCard label="Rows" value={String(data.items.length)} />
            </div>
          )}

          <section className={styles.section}>
            {data.items.length === 0 ? (
              <EmptyState
                icon={<Icon name="summary" size={48} />}
                heading="No item entries this period"
                body="Once staff save till or canteen entries, they'll show up here row by row."
              />
            ) : (
              <Card className={`${catalogStyles.tableCard} ${catalogStyles.desktopOnly}`}>
                <table
                  className={[
                    catalogStyles.table,
                    styles.ledgerTable,
                    data.items.length <= 3 ? styles.ledgerTableSparse : "",
                  ].join(" ")}
                >
                  <thead>
                    <tr>
                      <th colSpan={5} className={[styles.groupHeader, styles.groupHeaderIdentity].join(" ")}>
                        Identity
                      </th>
                      <th
                        colSpan={6}
                        className={[styles.groupHeader, styles.groupHeaderMovement, styles.groupDividerStart].join(
                          " "
                        )}
                      >
                        Stock movement
                      </th>
                      <th
                        colSpan={4}
                        className={[styles.groupHeader, styles.groupHeaderValue, styles.groupDividerStart].join(" ")}
                      >
                        Inventory value
                      </th>
                    </tr>
                    <tr>
                      <th className={styles.stickyCol}>Date</th>
                      <th className={styles.stickyColItem}>Item</th>
                      <th>Location</th>
                      <th>Staff on shift</th>
                      <th className={catalogStyles.numeric}>Opening</th>
                      <th className={[catalogStyles.numeric, styles.groupDividerStart].join(" ")}>Added</th>
                      <th className={catalogStyles.numeric}>Canteen (S/R)</th>
                      <th className={catalogStyles.numeric}>Sold (Hotel)</th>
                      <th className={catalogStyles.numeric}>Sold (total)</th>
                      <th className={catalogStyles.numeric}>Wastage</th>
                      <th className={catalogStyles.numeric}>Closing</th>
                      <th className={[catalogStyles.numeric, styles.groupDividerStart].join(" ")}>Sales value</th>
                      <th className={catalogStyles.numeric}>Cost value</th>
                      <th className={catalogStyles.numeric}>Closing stock value</th>
                      <th className={catalogStyles.numeric}>Wastage value</th>
                      <th aria-label="Edit" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((row) => {
                      const canteenSignedQty =
                        row.location === "canteen" ? row.added_stock : -row.sent_out;
                      return (
                        <tr
                          key={`${row.entry_date}-${row.item_id}-${row.location}`}
                          className={styles.editableRow}
                          onClick={() => openStockEntryEdit(row)}
                        >
                          <td className={styles.stickyCol}>{row.entry_date}</td>
                          <td className={styles.stickyColItem}>{row.item_name}</td>
                          <td className={styles.locationCell}>
                            {row.location === "restaurant" ? "Restaurant" : "Canteen"}
                          </td>
                          <td>
                            <PlaceholderStat
                              label="Staff on shift"
                              reason="Coming with the planned lightweight clock-in feature — not built yet, so this column isn't wired to real attendance data."
                            />
                          </td>
                          <td className={catalogStyles.numeric}>{qty(row.opening_stock)}</td>
                          <td className={[catalogStyles.numeric, styles.groupDividerStart].join(" ")}>
                            {qty(row.added_stock)}
                          </td>
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
                          <td
                            className={[catalogStyles.numeric, styles.numericStrong, styles.groupDividerStart].join(
                              " "
                            )}
                          >
                            <span className={row.sales_value > 0 ? styles.salesValuePositive : undefined}>
                              {money(row.sales_value)}
                            </span>
                          </td>
                          <td className={[catalogStyles.numeric, styles.numericStrong].join(" ")}>
                            {money(row.cost_value)}
                          </td>
                          <td className={[catalogStyles.numeric, styles.numericStrong].join(" ")}>
                            {money(row.closing_stock_value)}
                          </td>
                          <td className={[catalogStyles.numeric, styles.numericStrong].join(" ")}>
                            <span className={row.wastage_value > 0 ? styles.wastageValueNotable : undefined}>
                              {money(row.wastage_value)}
                            </span>
                          </td>
                          <td>
                            <button
                              type="button"
                              className={styles.editButton}
                              onClick={(e) => {
                                e.stopPropagation();
                                openStockEntryEdit(row);
                              }}
                              aria-label={`Edit ${row.item_name} entry`}
                            >
                              <Icon name="edit" size={16} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            )}

            {/* Mobile collapsible-card treatment (<600px), matching the
                pattern already used on Items/Ingredients/Delivery
                Locations/Staff/Orders — the one gap left over from the
                Phase 10 sweep. A 15-column table can't reflow onto a
                phone screen, so each row collapses to Item + Date +
                Closing (the figure most worth a glance) with the rest
                behind a tap, same interaction as Items' price/margin
                summary row. */}
            {data.items.length > 0 && (
              <ul className={`${catalogStyles.cardList} ${catalogStyles.mobileOnly}`}>
                {data.items.map((row) => {
                  const key = `${row.entry_date}-${row.item_id}-${row.location}`;
                  const isOpen = expandedRows.has(key);
                  const canteenSignedQty =
                    row.location === "canteen" ? row.added_stock : -row.sent_out;
                  return (
                    <li key={key} className={catalogStyles.itemCard}>
                      <button
                        type="button"
                        className={catalogStyles.itemCardRow}
                        aria-expanded={isOpen}
                        onClick={() => toggleExpanded(key)}
                      >
                        <span className={catalogStyles.itemCardIdentity}>
                          <span className={catalogStyles.itemCardName}>{row.item_name}</span>
                          <span className={catalogStyles.itemCardCategory}>
                            {row.entry_date} · {row.location === "restaurant" ? "Restaurant" : "Canteen"}
                          </span>
                        </span>
                        <span className={catalogStyles.itemCardMetrics}>
                          <span className={catalogStyles.itemCardPrice}>{money(row.sales_value)}</span>
                          <span
                            className={[
                              styles.itemCardClosingStock,
                              isLowStock(row.closing_stock, row.low_stock_threshold)
                                ? styles.lowValue
                                : "",
                            ].join(" ")}
                          >
                            {qty(row.closing_stock)} left
                          </span>
                        </span>
                        <span
                          className={[
                            catalogStyles.itemCardChevron,
                            isOpen ? catalogStyles.itemCardChevronOpen : "",
                          ].join(" ")}
                        >
                          <Icon name="chevron-right" size={20} />
                        </span>
                      </button>

                      <div
                        className={[
                          catalogStyles.itemCardDetails,
                          isOpen ? catalogStyles.itemCardDetailsOpen : "",
                        ].join(" ")}
                      >
                        <div className={catalogStyles.itemCardDetailsInner}>
                          <div className={catalogStyles.itemCardDetailLine}>
                            <span>Opening</span>
                            <strong>{qty(row.opening_stock)}</strong>
                          </div>
                          <div className={catalogStyles.itemCardDetailLine}>
                            <span>Added</span>
                            <strong>{qty(row.added_stock)}</strong>
                          </div>
                          <div className={catalogStyles.itemCardDetailLine}>
                            <span>Canteen (S/R)</span>
                            <strong>
                              {canteenSignedQty > 0 ? "+" : ""}
                              {qty(canteenSignedQty)}
                            </strong>
                          </div>
                          <div className={catalogStyles.itemCardDetailLine}>
                            <span>Sold (hotel till)</span>
                            <strong>{qty(row.till_quantity_sold)}</strong>
                          </div>
                          <div className={catalogStyles.itemCardDetailLine}>
                            <span>Sold (total)</span>
                            <strong>{qty(row.quantity_sold)}</strong>
                          </div>
                          <div className={catalogStyles.itemCardDetailLine}>
                            <span>Wastage</span>
                            <strong>{qty(row.wastage)}</strong>
                          </div>
                          <div className={catalogStyles.itemCardDetailLine}>
                            <span>Sales value</span>
                            <strong>{money(row.sales_value)}</strong>
                          </div>
                          <div className={catalogStyles.itemCardDetailLine}>
                            <span>Cost value</span>
                            <strong>{money(row.cost_value)}</strong>
                          </div>
                          <div className={catalogStyles.itemCardDetailLine}>
                            <span>Closing stock value</span>
                            <strong>{money(row.closing_stock_value)}</strong>
                          </div>
                          <div className={catalogStyles.itemCardDetailLine}>
                            <span>Wastage value</span>
                            <strong>{money(row.wastage_value)}</strong>
                          </div>
                          <button
                            type="button"
                            className={styles.editCardButton}
                            onClick={() => openStockEntryEdit(row)}
                          >
                            <Icon name="edit" size={14} />
                            Edit entry
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
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
                <>
                  <div className={styles.toolbarRow}>
                    <FilterBar
                      searchValue={ingredientSearch}
                      onSearchChange={setIngredientSearch}
                      searchPlaceholder="Search ingredients…"
                    />
                  </div>
                  {filteredIngredients.length === 0 ? (
                    <EmptyState
                      icon={<Icon name="summary" size={48} />}
                      heading="No matching ingredients"
                      body="Try a different search term."
                    />
                  ) : (
                    <>
                      <Card className={`${catalogStyles.tableCard} ${catalogStyles.desktopOnly}`}>
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
                              <th aria-label="Edit" />
                            </tr>
                          </thead>
                          <tbody>
                            {filteredIngredients.map((row) => (
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
                                <td>
                                  <button
                                    type="button"
                                    className={styles.editButton}
                                    onClick={() => openIngredientEntryEdit(row)}
                                    aria-label={`Edit ${row.ingredient_name} entry`}
                                  >
                                    <Icon name="edit" size={16} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </Card>

                      <ul className={`${catalogStyles.cardList} ${catalogStyles.mobileOnly}`}>
                        {filteredIngredients.map((row) => {
                          const key = `${row.entry_date}-${row.ingredient_id}`;
                          const isOpen = expandedRows.has(key);
                          return (
                            <li key={key} className={catalogStyles.itemCard}>
                              <button
                                type="button"
                                className={catalogStyles.itemCardRow}
                                aria-expanded={isOpen}
                                onClick={() => toggleExpanded(key)}
                              >
                                <span className={catalogStyles.itemCardIdentity}>
                                  <span className={catalogStyles.itemCardName}>
                                    {row.ingredient_name}
                                  </span>
                                  <span className={catalogStyles.itemCardCategory}>{row.entry_date}</span>
                                </span>
                                <span className={catalogStyles.itemCardMetrics}>
                                  <span
                                    className={[
                                      catalogStyles.itemCardPrice,
                                      isLowStock(row.closing_stock, row.low_stock_threshold)
                                        ? styles.lowValue
                                        : "",
                                    ].join(" ")}
                                  >
                                    {qty(row.closing_stock)} {row.unit} left
                                  </span>
                                </span>
                                <span
                                  className={[
                                    catalogStyles.itemCardChevron,
                                    isOpen ? catalogStyles.itemCardChevronOpen : "",
                                  ].join(" ")}
                                >
                                  <Icon name="chevron-right" size={20} />
                                </span>
                              </button>

                              <div
                                className={[
                                  catalogStyles.itemCardDetails,
                                  isOpen ? catalogStyles.itemCardDetailsOpen : "",
                                ].join(" ")}
                              >
                                <div className={catalogStyles.itemCardDetailsInner}>
                                  <div className={catalogStyles.itemCardDetailLine}>
                                    <span>Opening</span>
                                    <strong>
                                      {qty(row.opening_stock)} {row.unit}
                                    </strong>
                                  </div>
                                  <div className={catalogStyles.itemCardDetailLine}>
                                    <span>Received</span>
                                    <strong>
                                      {qty(row.received)} {row.unit}
                                    </strong>
                                  </div>
                                  <div className={catalogStyles.itemCardDetailLine}>
                                    <span>Used</span>
                                    <strong>
                                      {qty(row.quantity_used)} {row.unit}
                                    </strong>
                                  </div>
                                  <div className={catalogStyles.itemCardDetailLine}>
                                    <span>Wastage</span>
                                    <strong>
                                      {qty(row.wastage)} {row.unit}
                                    </strong>
                                  </div>
                                  <div className={catalogStyles.itemCardDetailLine}>
                                    <span>Closing value</span>
                                    <strong>{money(row.closing_stock_value)}</strong>
                                  </div>
                                  <div className={catalogStyles.itemCardDetailLine}>
                                    <span>Wastage value</span>
                                    <strong>{money(row.wastage_value)}</strong>
                                  </div>
                                  <button
                                    type="button"
                                    className={styles.editCardButton}
                                    onClick={() => openIngredientEntryEdit(row)}
                                  >
                                    <Icon name="edit" size={14} />
                                    Edit entry
                                  </button>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </>
              )}
            </section>
          )}
        </>
      ) : null}

      <Modal
        open={editTarget !== null}
        onClose={closeEdit}
        title={
          editTarget?.kind === "stock_entries"
            ? `Edit ${editTarget.item_name} — ${editTarget.entry_date}`
            : editTarget?.kind === "ingredient_entries"
              ? `Edit ${editTarget.ingredient_name} — ${editTarget.entry_date}`
              : "Edit entry"
        }
        footer={
          <>
            <Button variant="tertiary" onClick={closeEdit} disabled={editSubmitting}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submitEdit} disabled={editSubmitting}>
              {editSubmitting ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        {editTarget && (
          <div className={styles.editForm}>
            <p className={styles.editFormMeta}>
              Only quantities are editable here — prices stay locked to what was recorded at the
              time. If this isn&apos;t the most recent entry for this{" "}
              {editTarget.kind === "stock_entries" ? "item" : "ingredient"}, saving will be
              rejected.
            </p>
            {editError && <p className={catalogStyles.formError}>{editError}</p>}

            {editTarget.kind === "stock_entries" ? (
              <>
                <Input
                  label="Till sales"
                  type="number"
                  numeric
                  value={editForm.till_quantity_sold}
                  onChange={(e) =>
                    setEditForm({ ...editForm, till_quantity_sold: Number(e.target.value) })
                  }
                />
                <Input
                  label="Added stock"
                  type="number"
                  numeric
                  value={editForm.added_stock}
                  onChange={(e) => setEditForm({ ...editForm, added_stock: Number(e.target.value) })}
                />
                {editTarget.location === "restaurant" && (
                  <Input
                    label="Sent to canteen"
                    type="number"
                    numeric
                    value={editForm.sent_out}
                    onChange={(e) => setEditForm({ ...editForm, sent_out: Number(e.target.value) })}
                  />
                )}
                <Input
                  label="Wastage"
                  type="number"
                  numeric
                  value={editForm.wastage}
                  onChange={(e) => setEditForm({ ...editForm, wastage: Number(e.target.value) })}
                />
              </>
            ) : (
              <>
                <Input
                  label="Received"
                  type="number"
                  numeric
                  value={editForm.received}
                  onChange={(e) => setEditForm({ ...editForm, received: Number(e.target.value) })}
                />
                <Input
                  label="Used"
                  type="number"
                  numeric
                  value={editForm.quantity_used}
                  onChange={(e) =>
                    setEditForm({ ...editForm, quantity_used: Number(e.target.value) })
                  }
                />
                <Input
                  label="Wastage"
                  type="number"
                  numeric
                  value={editForm.wastage}
                  onChange={(e) => setEditForm({ ...editForm, wastage: Number(e.target.value) })}
                />
              </>
            )}
          </div>
        )}
      </Modal>

      {toast && <Toast message={toast} status="success" onDismiss={() => setToast(null)} />}
    </div>
  );
}
