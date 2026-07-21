"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PeriodToggle } from "@/components/PeriodToggle";
import { MetricCard } from "@/components/MetricCard";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { InfoTooltip } from "@/components/InfoTooltip";
import { useAdminTopBarSlot } from "../AdminTopBarSlot";
import styles from "./dashboard.module.css";

type Period = "today" | "week" | "month";

interface LocationFigures {
  salesValue: number;
  costValue: number;
  wastageValue: number;
  staffMealValue: number;
  closingStockValue: number;
  // Quantity flows (post-launch addition, 2026-07-21) — opening_stock/
  // closing_stock are point-in-time balances (each item's earliest/latest
  // row in the selected range), added_stock/sent_out/quantitySold are
  // period sums. See 20260721120000_dashboard_stock_quantity_columns.sql,
  // 20260721130000_dashboard_stock_sold_used_columns.sql.
  openingStock: number;
  addedStock: number;
  sentOut: number;
  quantitySold: number;
  closingStock: number;
  expenses: number;
  netProfit: number;
}

interface CombinedFigures extends LocationFigures {
  // Admin-logged expenses with no location (rent, salaries, etc.) — not
  // attributable to either location's own P&L, so it only exists on the
  // combined figures, never in byLocation.
  businessWideExpenses: number;
}

// Ingredients (raw materials, §3.2) — a third, separate stock pool from
// restaurant/canteen menu items. No sales/cost/expenses/net-profit of its
// own since ingredients are never sold directly; just stock-level figures
// for its own comparison-table row, kept out of byLocation.restaurant so
// the client can see menu-item stock trend toward 0 distinctly from
// ingredient stock-on-hand.
interface IngredientFigures {
  wastageValue: number;
  closingStockValue: number;
  openingStock: number;
  received: number;
  quantityUsed: number;
  closingStock: number;
}

interface TrendPoint {
  entry_date: string;
  sales_value: number;
  cost_value: number;
  wastage_value: number;
}

interface LowStockItem {
  item_id: string;
  item_name: string;
  location: "restaurant" | "canteen";
  closing_stock: number;
  low_stock_threshold: number;
  entry_date: string;
}

interface LowStockIngredient {
  ingredient_id: string;
  ingredient_name: string;
  closing_stock: number;
  low_stock_threshold: number;
  unit: string;
  entry_date: string;
}

interface SummaryResponse {
  period: Period;
  from: string;
  to: string;
  combined: CombinedFigures;
  byLocation: { restaurant: LocationFigures; canteen: LocationFigures };
  ingredients: IngredientFigures;
  trend: TrendPoint[];
  lowStockItems: LowStockItem[];
  lowStockIngredients: LowStockIngredient[];
}

const PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

// Plain-language calculation explanations (post-launch addition,
// 2026-07-21, client request — WaPrecious wants to be able to check how
// each dashboard figure was arrived at). Wording matches what was already
// explained to her directly for the COGS formula change (§3.8) — kept
// here rather than duplicated so the in-app text and the conversation
// with her stay consistent. Shown via InfoTooltip, click-to-open (not
// hover-only — this is a mobile-first app).
const TOOLTIPS = {
  netProfit: "Total sales, minus cost of goods, wastage, staff meals, and operating expenses.",
  salesValue: "Everything sold this period, at the price it was sold for (till sales plus delivery/pickup orders).",
  costValue:
    "Opening stock value + added stock value − closing stock value, for menu items and ingredients combined. This is WaPrecious's own method: it works out cost from how much the stock's value changed, not just from what was sold — so it also picks up wastage, staff meals, and ingredients used in cooking.",
  wastageValue: "Stock lost to spoilage, breakage, or spillage — valued at what it cost to buy or produce, not what it would have sold for.",
  staffMealValue: "Menu items staff ate without paying, valued at cost — a separate figure from wastage since it was consumed on purpose, not spoiled.",
  closingStock: "Value of unsold stock still on hand at the end of this period, priced at buying cost.",
  closingStockRestaurant: "Value of unsold restaurant menu-item stock still on hand at the end of this period, priced at buying cost.",
  closingStockCanteen: "Value of unsold canteen stock still on hand at the end of this period, priced at buying cost.",
  closingStockIngredients: "Value of raw ingredients still in the central store at the end of this period, priced at buying cost.",
  businessWideExpenses: "Costs not tied to either location specifically — rent, salaries, and similar — still subtracted from the combined net profit.",
  expenses: "Costs logged for this location — utilities, supplies, and similar — via the Expenses tab.",
} as const;

const COMPARISON_ROWS = [
  { label: "Gross sales", key: "salesValue", tooltip: TOOLTIPS.salesValue },
  { label: "Cost of goods", key: "costValue", tooltip: TOOLTIPS.costValue },
  { label: "Recorded wastage", key: "wastageValue", tooltip: TOOLTIPS.wastageValue },
  { label: "Staff meals", key: "staffMealValue", tooltip: TOOLTIPS.staffMealValue },
  { label: "Operating expenses", key: "expenses", tooltip: TOOLTIPS.expenses },
  { label: "Closing stock value", key: "closingStockValue", tooltip: TOOLTIPS.closingStock },
] as const;

// Quantity flows (post-launch addition, 2026-07-21) — a separate table
// from COMPARISON_ROWS since these are raw quantities, not money, and
// shouldn't run through money()/negative-highlight styling. Opening/
// closing stock are point-in-time balances (each item's earliest/latest
// row in the selected range); added stock/sent out are period sums — see
// the dashboard_stock_summary() comment in
// 20260721120000_dashboard_stock_quantity_columns.sql.
const QUANTITY_ROWS = [
  { label: "Opening stock (units)", key: "openingStock" },
  { label: "Added stock (units)", key: "addedStock" },
  { label: "Sent to canteen (units)", key: "sentOut" },
  { label: "Sold (units)", key: "quantitySold" },
  { label: "Closing stock (units)", key: "closingStock" },
] as const;

// Both wastage and staff meals are deductions worth calling out in the
// comparison table's negative-value styling — distinct rows, same visual
// treatment, since both reduce profit without being a normal operating
// expense (§3.5 — staff meals are never merged into wastageValue).
const NEGATIVE_HIGHLIGHT_KEYS: ReadonlySet<string> = new Set(["wastageValue", "staffMealValue"]);

function money(value: number): string {
  return `KES ${Math.round(value).toLocaleString("en-KE")}`;
}

function units(value: number): string {
  return value.toLocaleString("en-KE");
}

function formatUpdatedAt(date: Date): string {
  return date.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
}

export function DashboardClient() {
  const [period, setPeriod] = useState<Period>("today");
  // Custom date range (mirrors the Item Ledger's existing range picker,
  // app/(admin)/dashboard/ledger/LedgerClient.tsx) — overrides period when
  // set. Cleared whenever a Today/Week/Month toggle option is chosen.
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [rangeDraft, setRangeDraft] = useState({ from: "", to: "" });
  const [rangePickerOpen, setRangePickerOpen] = useState(false);
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const cancelledRef = useRef(false);

  const load = useCallback(async (opts: { isManualRefresh?: boolean } = {}) => {
    if (opts.isManualRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const params = new URLSearchParams({ period });
      if (customRange) {
        params.set("from", customRange.from);
        params.set("to", customRange.to);
      }
      const res = await fetch(`/api/dashboard/summary?${params.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to load dashboard");
      if (!cancelledRef.current) {
        setData(json as SummaryResponse);
        setLastUpdated(new Date());
      }
    } catch (err) {
      if (!cancelledRef.current) setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      if (!cancelledRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [period, customRange]);

  useEffect(() => {
    cancelledRef.current = false;
    async function run() {
      await load();
    }
    run();
    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, customRange]);

  function selectPeriod(value: Period) {
    setCustomRange(null);
    setPeriod(value);
  }

  function applyCustomRange() {
    if (!rangeDraft.from || !rangeDraft.to || rangeDraft.from > rangeDraft.to) return;
    setCustomRange({ from: rangeDraft.from, to: rangeDraft.to });
    setRangePickerOpen(false);
  }

  const restaurantLowItems = data?.lowStockItems.filter((i) => i.location === "restaurant") ?? [];
  const canteenLowItems = data?.lowStockItems.filter((i) => i.location === "canteen") ?? [];
  // Ingredients are restaurant-only (docs/01_DATA_MODEL.md §3.2) — folded
  // into the restaurant restock card, not a third card.
  const criticalCount =
    (data?.lowStockItems.length ?? 0) + (data?.lowStockIngredients.length ?? 0);

  // Manual refresh (post-launch fix): the dashboard only fetches on mount
  // and on period change, not continuously, so a staff sale logged while
  // the dashboard is already open doesn't appear until something re-fetches.
  // This is a deliberate no-polling design (no websocket/live layer in this
  // app), so a visible manual control is the fix rather than backgrounding
  // a poll interval.
  const refreshButton = (
    <button
      type="button"
      className={styles.refreshButton}
      onClick={() => load({ isManualRefresh: true })}
      disabled={loading || refreshing}
      aria-label="Refresh dashboard data"
    >
      <Icon name="refresh" size={16} className={refreshing ? styles.refreshIconSpinning : undefined} />
      <span>Refresh</span>
    </button>
  );

  // Mirrors the toggle into the desktop-only top bar (AdminShell) — see
  // its own comment for why the hero's copy below stays for mobile,
  // where there's no equivalent top bar to hold it.
  useAdminTopBarSlot(
    <div className={styles.topBarControls}>
      {lastUpdated && <span className={styles.lastUpdated}>Updated {formatUpdatedAt(lastUpdated)}</span>}
      {refreshButton}
      <PeriodToggle
        options={PERIOD_OPTIONS}
        value={customRange ? "" : period}
        onChange={(v) => selectPeriod(v as Period)}
      />
      <RangePicker
        customRange={customRange}
        rangeDraft={rangeDraft}
        setRangeDraft={setRangeDraft}
        open={rangePickerOpen}
        setOpen={setRangePickerOpen}
        onApply={applyCustomRange}
      />
    </div>
  );

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroTop}>
          <h1 className={styles.heroTitle}>Dashboard</h1>
          <div className={styles.heroPeriodToggleMobileOnly}>
            <PeriodToggle
              options={PERIOD_OPTIONS}
              value={customRange ? "" : period}
              onChange={(v) => selectPeriod(v as Period)}
              onDark
            />
            <RangePicker
              customRange={customRange}
              rangeDraft={rangeDraft}
              setRangeDraft={setRangeDraft}
              open={rangePickerOpen}
              setOpen={setRangePickerOpen}
              onApply={applyCustomRange}
              onDark
            />
          </div>
        </div>

        <div className={styles.heroRefreshRowMobileOnly}>
          {lastUpdated && (
            <span className={styles.lastUpdatedOnDark}>Updated {formatUpdatedAt(lastUpdated)}</span>
          )}
          <button
            type="button"
            className={styles.refreshButtonOnDark}
            onClick={() => load({ isManualRefresh: true })}
            disabled={loading || refreshing}
            aria-label="Refresh dashboard data"
          >
            <Icon name="refresh" size={16} className={refreshing ? styles.refreshIconSpinning : undefined} />
            <span>Refresh</span>
          </button>
        </div>

        {loading && !data ? (
          <p className={styles.heroLoading}>Loading…</p>
        ) : error ? (
          <p className={styles.heroError}>{error}</p>
        ) : data ? (
          <>
            <MetricCard
              label="Net profit"
              value={money(data.combined.netProfit)}
              onDark
              trend={data.combined.netProfit < 0 ? "down" : undefined}
              trendLabel={data.combined.netProfit < 0 ? "Operating at a loss this period" : undefined}
              tooltip={TOOLTIPS.netProfit}
            />

            <div className={styles.heroGrid}>
              <MetricCard
                label="Total sales"
                value={money(data.combined.salesValue)}
                onDark
                tooltip={TOOLTIPS.salesValue}
              />
              <MetricCard
                label="Total cost"
                value={money(data.combined.costValue)}
                onDark
                tooltip={TOOLTIPS.costValue}
              />
              <MetricCard
                label="Wastage cost"
                value={money(data.combined.wastageValue)}
                onDark
                tooltip={TOOLTIPS.wastageValue}
              />
              <MetricCard
                label="Staff meals"
                value={money(data.combined.staffMealValue)}
                onDark
                tooltip={TOOLTIPS.staffMealValue}
              />
              {/* Split (post-launch, 2026-07-21) rather than one combined
                  "Closing stock value" tile: restaurant menu-item stock
                  should trend toward 0 under the "cook it, send it, sell
                  it" model, while canteen genuinely carries a standing
                  shop-style balance — collapsing them into one number hid
                  that distinction. Ingredients (post-launch, 2026-07-21,
                  same session as the COGS formula change) get their own
                  third tile for the same reason — central-store stock is
                  a different pool of tied-up cash from either location's
                  menu-item stock. */}
              <MetricCard
                label="Closing stock (Restaurant)"
                value={money(data.byLocation.restaurant.closingStockValue)}
                onDark
                tooltip={TOOLTIPS.closingStockRestaurant}
              />
              <MetricCard
                label="Closing stock (Canteen)"
                value={money(data.byLocation.canteen.closingStockValue)}
                onDark
                tooltip={TOOLTIPS.closingStockCanteen}
              />
              <MetricCard
                label="Closing stock (Ingredients)"
                value={money(data.ingredients.closingStockValue)}
                onDark
                tooltip={TOOLTIPS.closingStockIngredients}
              />
              {data.combined.businessWideExpenses > 0 && (
                <MetricCard
                  label="Business-wide expenses"
                  value={money(data.combined.businessWideExpenses)}
                  onDark
                  tooltip={TOOLTIPS.businessWideExpenses}
                />
              )}
            </div>
          </>
        ) : null}
      </section>

      {data && (
        <>
          <section className={styles.attentionGrid}>
            <Card className={styles.actionRequiredCard}>
              {criticalCount > 0 ? (
                <>
                  <div className={styles.actionRequiredHeading}>
                    <Icon name="wastage" size={20} className={styles.actionRequiredIcon} />
                    <span>Action required</span>
                  </div>
                  <p className={styles.actionRequiredCount}>{criticalCount} critical items</p>
                  <p className={styles.actionRequiredBody}>
                    Inventory below threshold requires review.
                  </p>
                  <Button variant="secondary" className={styles.actionRequiredButton} fullWidth>
                    Review now →
                  </Button>
                </>
              ) : (
                <EmptyState
                  icon={<Icon name="check" size={40} />}
                  heading="All stocked up"
                  body="No items or ingredients are currently at or below their low-stock threshold."
                />
              )}
            </Card>

            <RestockCard
              title="Restaurant priority restock"
              icon="entry"
              items={restaurantLowItems}
              ingredients={data.lowStockIngredients}
            />
            <RestockCard title="Canteen priority restock" icon="store" items={canteenLowItems} />
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Location performance comparison</h2>
              <Link href="/dashboard/ledger" className={styles.ledgerLink}>
                View item ledger →
              </Link>
            </div>
            <Card className={styles.comparisonCard}>
              <table className={styles.comparisonTable}>
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th className={styles.comparisonNumeric}>Restaurant</th>
                    <th className={styles.comparisonNumeric}>Canteen</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_ROWS.map((row) => (
                    <tr key={row.key}>
                      <td className={styles.comparisonLabelCell}>
                        <span>{row.label}</span>
                        <InfoTooltip label={row.label} message={row.tooltip} />
                      </td>
                      <td
                        className={[
                          styles.comparisonNumeric,
                          NEGATIVE_HIGHLIGHT_KEYS.has(row.key) ? styles.comparisonNegative : "",
                        ].join(" ")}
                      >
                        {money(data.byLocation.restaurant[row.key])}
                      </td>
                      <td
                        className={[
                          styles.comparisonNumeric,
                          NEGATIVE_HIGHLIGHT_KEYS.has(row.key) ? styles.comparisonNegative : "",
                        ].join(" ")}
                      >
                        {money(data.byLocation.canteen[row.key])}
                      </td>
                    </tr>
                  ))}
                  <tr className={styles.comparisonTotalRow}>
                    <td className={styles.comparisonLabelCell}>
                      <span>Net profit</span>
                      <InfoTooltip label="Net profit" message={TOOLTIPS.netProfit} />
                    </td>
                    <td
                      className={[
                        styles.comparisonNumeric,
                        data.byLocation.restaurant.netProfit < 0 ? styles.comparisonNegative : "",
                      ].join(" ")}
                    >
                      {money(data.byLocation.restaurant.netProfit)}
                    </td>
                    <td
                      className={[
                        styles.comparisonNumeric,
                        data.byLocation.canteen.netProfit < 0 ? styles.comparisonNegative : "",
                      ].join(" ")}
                    >
                      {money(data.byLocation.canteen.netProfit)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </Card>

            {/* Quantity flows (post-launch addition, 2026-07-21) — raw
                units, not money, so a separate table from the figures
                above. "Sent to canteen" is restaurant-only: canteen never
                sends stock anywhere, its added_stock for canteen_supplied
                items is just a same-day mirror of this same number
                (§3.1) — shown as an explanatory note rather than a bare
                "—", so it reads as "doesn't apply here" rather than
                missing/broken data. "Sold" is quantity_sold, which
                already includes both till and order-driven sales (§3.4)
                — added so opening + added − sent − sold visibly accounts
                for closing stock instead of leaving an unexplained gap. */}
            <Card className={styles.comparisonCard}>
              <table className={styles.comparisonTable}>
                <thead>
                  <tr>
                    <th>Stock movement</th>
                    <th className={styles.comparisonNumeric}>Restaurant</th>
                    <th className={styles.comparisonNumeric}>Canteen</th>
                  </tr>
                </thead>
                <tbody>
                  {QUANTITY_ROWS.map((row) => (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      <td className={styles.comparisonNumeric}>{units(data.byLocation.restaurant[row.key])}</td>
                      {row.key === "sentOut" ? (
                        <td className={styles.comparisonNote}>N/A — mirrors restaurant</td>
                      ) : (
                        <td className={styles.comparisonNumeric}>{units(data.byLocation.canteen[row.key])}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            {/* Ingredients (raw materials, §3.2) — restaurant-only, no
                canteen counterpart, so a single-column card rather than
                forcing it into the two-location table above. Kept
                visually distinct from the restaurant's own menu-item
                figures per the client's request: ingredient stock-on-hand
                is a different pool of cash tied up than finished menu
                items sitting unsold. */}
            <Card className={styles.comparisonCard}>
              <table className={styles.comparisonTable}>
                <thead>
                  <tr>
                    <th>Ingredients (central store)</th>
                    <th className={styles.comparisonNumeric}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className={styles.comparisonLabelCell}>
                      <span>Closing stock value</span>
                      <InfoTooltip label="Closing stock value" message={TOOLTIPS.closingStockIngredients} />
                    </td>
                    <td className={styles.comparisonNumeric}>{money(data.ingredients.closingStockValue)}</td>
                  </tr>
                  <tr>
                    <td>Recorded wastage</td>
                    <td className={[styles.comparisonNumeric, styles.comparisonNegative].join(" ")}>
                      {money(data.ingredients.wastageValue)}
                    </td>
                  </tr>
                  <tr>
                    <td>Opening stock (units)</td>
                    <td className={styles.comparisonNumeric}>{units(data.ingredients.openingStock)}</td>
                  </tr>
                  <tr>
                    <td>Received (units)</td>
                    <td className={styles.comparisonNumeric}>{units(data.ingredients.received)}</td>
                  </tr>
                  <tr>
                    <td>Used (units)</td>
                    <td className={styles.comparisonNumeric}>{units(data.ingredients.quantityUsed)}</td>
                  </tr>
                  <tr>
                    <td>Closing stock (units)</td>
                    <td className={styles.comparisonNumeric}>{units(data.ingredients.closingStock)}</td>
                  </tr>
                </tbody>
              </table>
            </Card>
          </section>

          {data.trend.length > 1 && (
            <section className={styles.section}>
              <SalesTrendChart trend={data.trend} period={period} isCustomRange={customRange !== null} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Custom date-range picker (mirrors app/(admin)/dashboard/ledger's
 * identical control) — a button showing the active range that opens a
 * popover with From/To date inputs. `onDark` renders the mobile-hero
 * variant of the trigger button; the popover itself is always the
 * light-surface card regardless, since it sits above both contexts.
 */
function RangePicker({
  customRange,
  rangeDraft,
  setRangeDraft,
  open,
  setOpen,
  onApply,
  onDark,
}: {
  customRange: { from: string; to: string } | null;
  rangeDraft: { from: string; to: string };
  setRangeDraft: (draft: { from: string; to: string }) => void;
  open: boolean;
  setOpen: (updater: (open: boolean) => boolean) => void;
  onApply: () => void;
  onDark?: boolean;
}) {
  return (
    <div className={styles.rangePicker}>
      <button
        type="button"
        className={onDark ? styles.rangeButtonOnDark : styles.rangeButton}
        onClick={() => {
          setRangeDraft(customRange ?? { from: "", to: "" });
          setOpen((prev) => !prev);
        }}
      >
        <Icon name="summary" size={16} />
        {customRange ? `${customRange.from} → ${customRange.to}` : "Custom range"}
      </button>
      {open && (
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
          <button type="button" className={styles.rangeApply} onClick={onApply}>
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

function RestockCard({
  title,
  icon,
  items,
  ingredients,
}: {
  title: string;
  icon: "entry" | "store";
  items: LowStockItem[];
  ingredients?: LowStockIngredient[];
}) {
  const rows = [
    ...items.map((i) => ({ key: `item-${i.item_id}`, name: i.item_name, stock: i.closing_stock, unit: "" })),
    ...(ingredients ?? []).map((i) => ({
      key: `ing-${i.ingredient_id}`,
      name: i.ingredient_name,
      stock: i.closing_stock,
      unit: ` ${i.unit}`,
    })),
  ];

  return (
    <Card className={styles.restockCard}>
      <div className={styles.restockHeading}>
        <Icon name={icon} size={18} />
        <span>{title}</span>
      </div>
      {rows.length === 0 ? (
        <p className={styles.restockEmpty}>Nothing below threshold right now.</p>
      ) : (
        <ul className={styles.restockList}>
          {rows.slice(0, 4).map((row) => (
            <li key={row.key} className={styles.restockRow}>
              <span className={styles.restockName}>{row.name}</span>
              <span className={row.stock <= 0 ? styles.restockQtyCritical : styles.restockQtyLow}>
                {row.stock <= 0 ? "0 left" : `${row.stock}${row.unit} left`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Daily Sales trend, replacing the old single-point sparkline — Phase
 * 10's Google Stitch reference showed a "Profit Trend Analysis" bar
 * chart, but dashboard_daily_trend() only returns sales/cost/wastage per
 * day (no expenses — expenses aren't logged with day-level granularity),
 * so a genuine daily net-profit figure isn't available without a schema
 * change. Charting Sales here instead — real data, accurately labeled —
 * rather than fabricate a "net profit" number the source data can't
 * support. See Phase 10's context file.
 *
 * Bar spec per the dataviz skill: <=24px thick, 4px rounded top / square
 * baseline, 2px gap between bars, single series so no legend box (the
 * title names it), selective direct label only on the most recent bar.
 */
function SalesTrendChart({
  trend,
  period,
  isCustomRange,
}: {
  trend: TrendPoint[];
  period: Period;
  isCustomRange: boolean;
}) {
  const width = 900;
  const height = 220;
  const paddingLeft = 56;
  const paddingBottom = 28;
  const paddingTop = 16;

  const max = Math.max(...trend.map((t) => t.sales_value), 1);
  const niceMax = Math.ceil(max / 5000) * 5000 || 5000;
  const plotWidth = width - paddingLeft;
  const plotHeight = height - paddingTop - paddingBottom;
  const barSlot = plotWidth / trend.length;
  // Wide bars with a thin gap — matches the Phase 10 reference design's
  // chart treatment (bars filling most of their slot), a deliberate
  // deviation from the dataviz skill's general "<=24px" mark-spec
  // default, which assumes a denser multi-bar chart than this one.
  const barWidth = Math.max(barSlot - 12, 8);

  // A custom range can span many weeks/months, where "weekday: short"
  // (Mon/Tue/…) repeats and stops being a unique axis label — use a
  // "D MMM" date label instead whenever a custom range is active,
  // regardless of how many points it happens to produce.
  const dateLabel = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    if (isCustomRange) {
      return d.toLocaleDateString("en-KE", { day: "numeric", month: "short" });
    }
    return period === "today" ? "Today" : d.toLocaleDateString("en-KE", { weekday: "short" });
  };

  const ticks = [0, niceMax * 0.25, niceMax * 0.5, niceMax * 0.75, niceMax];

  return (
    <Card className={styles.trendCard}>
      <div className={styles.trendHeader}>
        <div>
          <h2 className={styles.trendTitle}>Sales trend</h2>
          <p className={styles.trendSubtitle}>
            Daily sales value for the selected {isCustomRange ? "date range" : "period"}
            {isCustomRange ? "" : ` (${PERIOD_OPTIONS.find((p) => p.value === period)?.label.toLowerCase()})`}.
          </p>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className={styles.trendChart} role="img" aria-label="Daily sales trend">
        {ticks.map((tick) => {
          const y = paddingTop + plotHeight - (tick / niceMax) * plotHeight;
          return (
            <g key={tick}>
              <line
                x1={paddingLeft}
                x2={width}
                y1={y}
                y2={y}
                className={styles.trendGridline}
              />
              <text x={paddingLeft - 8} y={y + 4} textAnchor="end" className={styles.trendAxisLabel}>
                {tick >= 1000 ? `${Math.round(tick / 1000)}k` : Math.round(tick)}
              </text>
            </g>
          );
        })}
        {trend.map((point, i) => {
          const barHeight = (point.sales_value / niceMax) * plotHeight;
          const x = paddingLeft + i * barSlot + (barSlot - barWidth) / 2;
          const y = paddingTop + plotHeight - barHeight;
          const isLast = i === trend.length - 1;
          return (
            <g key={point.entry_date}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(barHeight, 1)}
                rx={4}
                className={isLast ? styles.trendBarCurrent : styles.trendBar}
              />
              {isLast && (
                <text
                  x={x + barWidth / 2}
                  y={y - 8}
                  textAnchor="middle"
                  className={styles.trendBarValue}
                >
                  {money(point.sales_value)}
                </text>
              )}
              <text
                x={x + barWidth / 2}
                y={height - 6}
                textAnchor="middle"
                className={styles.trendAxisLabel}
              >
                {dateLabel(point.entry_date)}
              </text>
            </g>
          );
        })}
      </svg>
    </Card>
  );
}
