"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PeriodToggle } from "@/components/PeriodToggle";
import { MetricCard } from "@/components/MetricCard";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { useAdminTopBarSlot } from "../AdminTopBarSlot";
import styles from "./dashboard.module.css";

type Period = "today" | "week" | "month";

interface LocationFigures {
  salesValue: number;
  costValue: number;
  wastageValue: number;
  staffMealValue: number;
  closingStockValue: number;
  expenses: number;
  netProfit: number;
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
  combined: LocationFigures;
  byLocation: { restaurant: LocationFigures; canteen: LocationFigures };
  trend: TrendPoint[];
  lowStockItems: LowStockItem[];
  lowStockIngredients: LowStockIngredient[];
}

const PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

const COMPARISON_ROWS = [
  { label: "Gross sales", key: "salesValue" },
  { label: "Cost of goods", key: "costValue" },
  { label: "Recorded wastage", key: "wastageValue" },
  { label: "Staff meals", key: "staffMealValue" },
  { label: "Operating expenses", key: "expenses" },
] as const;

// Both wastage and staff meals are deductions worth calling out in the
// comparison table's negative-value styling — distinct rows, same visual
// treatment, since both reduce profit without being a normal operating
// expense (§3.5 — staff meals are never merged into wastageValue).
const NEGATIVE_HIGHLIGHT_KEYS: ReadonlySet<string> = new Set(["wastageValue", "staffMealValue"]);

function money(value: number): string {
  return `KES ${Math.round(value).toLocaleString("en-KE")}`;
}

export function DashboardClient() {
  const [period, setPeriod] = useState<Period>("today");
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/dashboard/summary?period=${period}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Failed to load dashboard");
        if (!cancelled) setData(json as SummaryResponse);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load dashboard");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [period]);

  const restaurantLowItems = data?.lowStockItems.filter((i) => i.location === "restaurant") ?? [];
  const canteenLowItems = data?.lowStockItems.filter((i) => i.location === "canteen") ?? [];
  // Ingredients are restaurant-only (docs/01_DATA_MODEL.md §3.2) — folded
  // into the restaurant restock card, not a third card.
  const criticalCount =
    (data?.lowStockItems.length ?? 0) + (data?.lowStockIngredients.length ?? 0);

  // Mirrors the toggle into the desktop-only top bar (AdminShell) — see
  // its own comment for why the hero's copy below stays for mobile,
  // where there's no equivalent top bar to hold it.
  useAdminTopBarSlot(
    <PeriodToggle options={PERIOD_OPTIONS} value={period} onChange={(v) => setPeriod(v as Period)} />
  );

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroTop}>
          <h1 className={styles.heroTitle}>Dashboard</h1>
          <PeriodToggle
            options={PERIOD_OPTIONS}
            value={period}
            onChange={(v) => setPeriod(v as Period)}
            onDark
            className={styles.heroPeriodToggleMobileOnly}
          />
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
            />

            <div className={styles.heroGrid}>
              <MetricCard label="Total sales" value={money(data.combined.salesValue)} onDark />
              <MetricCard label="Total cost" value={money(data.combined.costValue)} onDark />
              <MetricCard label="Wastage cost" value={money(data.combined.wastageValue)} onDark />
              <MetricCard label="Staff meals" value={money(data.combined.staffMealValue)} onDark />
              <MetricCard label="Closing stock value" value={money(data.combined.closingStockValue)} onDark />
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
                      <td>{row.label}</td>
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
                    <td>Net profit</td>
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
          </section>

          {data.trend.length > 1 && (
            <section className={styles.section}>
              <SalesTrendChart trend={data.trend} period={period} />
            </section>
          )}
        </>
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
function SalesTrendChart({ trend, period }: { trend: TrendPoint[]; period: Period }) {
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

  const dateLabel = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    return period === "today"
      ? "Today"
      : d.toLocaleDateString("en-KE", { weekday: "short" });
  };

  const ticks = [0, niceMax * 0.25, niceMax * 0.5, niceMax * 0.75, niceMax];

  return (
    <Card className={styles.trendCard}>
      <div className={styles.trendHeader}>
        <div>
          <h2 className={styles.trendTitle}>Sales trend</h2>
          <p className={styles.trendSubtitle}>
            Daily sales value for the selected period ({PERIOD_OPTIONS.find((p) => p.value === period)?.label.toLowerCase()}).
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
