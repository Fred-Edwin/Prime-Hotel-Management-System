"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PeriodToggle } from "@/components/PeriodToggle";
import { MetricCard } from "@/components/MetricCard";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { LowStockIndicator } from "@/components/LowStockIndicator";
import styles from "./dashboard.module.css";

type Period = "today" | "week" | "month";

interface LocationFigures {
  salesValue: number;
  costValue: number;
  wastageValue: number;
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

  const lowStockCount = (data?.lowStockItems.length ?? 0) + (data?.lowStockIngredients.length ?? 0);

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
          />
        </div>

        {loading && !data ? (
          <p className={styles.heroLoading}>Loading…</p>
        ) : error ? (
          <p className={styles.heroError}>{error}</p>
        ) : data ? (
          <>
            <div className={styles.heroHeadline}>
              <MetricCard
                label="Net profit"
                value={money(data.combined.netProfit)}
                onDark
                trend={data.combined.netProfit < 0 ? "down" : undefined}
                trendLabel={data.combined.netProfit < 0 ? "Operating at a loss this period" : undefined}
              />
              {data.trend.length > 1 && (
                <TrendSparkline trend={data.trend} />
              )}
            </div>

            <div className={styles.heroGrid}>
              <MetricCard label="Total sales" value={money(data.combined.salesValue)} onDark />
              <MetricCard label="Total cost" value={money(data.combined.costValue)} onDark />
              <MetricCard label="Wastage cost" value={money(data.combined.wastageValue)} onDark />
              <MetricCard label="Closing stock value" value={money(data.combined.closingStockValue)} onDark />
            </div>
          </>
        ) : null}
      </section>

      {data && (
        <>
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Per location</h2>
              <Link href="/dashboard/ledger" className={styles.ledgerLink}>
                View item ledger →
              </Link>
            </div>
            <Card className={styles.locationCard}>
              <LocationSplitChart
                restaurant={data.byLocation.restaurant.netProfit}
                canteen={data.byLocation.canteen.netProfit}
              />
              <div className={styles.locationTable}>
                <div className={styles.locationRow}>
                  <span className={styles.locationRowLabel} />
                  <span className={styles.locationRowHeading}>Restaurant</span>
                  <span className={styles.locationRowHeading}>Canteen</span>
                </div>
                {(
                  [
                    ["Sales", "salesValue"],
                    ["Cost", "costValue"],
                    ["Wastage", "wastageValue"],
                    ["Expenses", "expenses"],
                    ["Net profit", "netProfit"],
                  ] as const
                ).map(([label, key]) => (
                  <div className={styles.locationRow} key={key}>
                    <span className={styles.locationRowLabel}>{label}</span>
                    <span className={styles.locationRowValue}>
                      {money(data.byLocation.restaurant[key])}
                    </span>
                    <span className={styles.locationRowValue}>
                      {money(data.byLocation.canteen[key])}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Needs attention</h2>
              {lowStockCount > 0 && <span className={styles.attentionCount}>{lowStockCount}</span>}
            </div>
            {lowStockCount === 0 ? (
              <EmptyState
                icon={<span aria-hidden>✓</span>}
                heading="All stocked up"
                body="No items or ingredients are currently at or below their low-stock threshold."
              />
            ) : (
              <Card className={styles.attentionCard}>
                {data.lowStockItems.map((item) => (
                  <div className={styles.attentionRow} key={`item-${item.item_id}`}>
                    <div className={styles.attentionInfo}>
                      <span className={styles.attentionName}>{item.item_name}</span>
                      <span className={styles.attentionLocation}>
                        {item.location === "restaurant" ? "Restaurant" : "Canteen"}
                      </span>
                    </div>
                    <div className={styles.attentionStock}>
                      <span className={styles.attentionQty}>{item.closing_stock}</span>
                      <LowStockIndicator variant="dot" label="Low stock" />
                    </div>
                  </div>
                ))}
                {data.lowStockIngredients.map((ing) => (
                  <div className={styles.attentionRow} key={`ing-${ing.ingredient_id}`}>
                    <div className={styles.attentionInfo}>
                      <span className={styles.attentionName}>{ing.ingredient_name}</span>
                      <span className={styles.attentionLocation}>Central store</span>
                    </div>
                    <div className={styles.attentionStock}>
                      <span className={styles.attentionQty}>
                        {ing.closing_stock} {ing.unit}
                      </span>
                      <LowStockIndicator variant="dot" label="Low stock" />
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/**
 * Single-series net-profit-driver trend line inside the dark hero band —
 * see docs/design/02_PATTERNS_AND_CHECKLIST.md §5's "Admin dashboard"
 * chart note. Gold (--color-chart-primary-dark), no legend (one series,
 * the surrounding card names it), direct value labels on the first/last
 * points only (dataviz skill's "selective direct labels" rule) since
 * every point isn't legible at this size.
 */
function TrendSparkline({ trend }: { trend: TrendPoint[] }) {
  const width = 320;
  const height = 64;
  const padding = 6;

  const values = trend.map((t) => t.sales_value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  const points = trend.map((t, i) => {
    const x = padding + (i / (trend.length - 1)) * (width - padding * 2);
    const y = height - padding - ((t.sales_value - min) / range) * (height - padding * 2);
    return { x, y, value: t.sales_value };
  });

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div className={styles.sparklineWrap}>
      <span className={styles.sparklineCaption}>Sales trend</span>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={styles.sparkline}
        role="img"
        aria-label={`Sales trend from ${money(first.value)} to ${money(last.value)}`}
      >
        <path d={path} fill="none" stroke="var(--color-chart-primary-dark)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={last.x} cy={last.y} r="3" fill="var(--color-chart-primary-dark)" />
        <text x={first.x} y={height - 1} className={styles.sparklineLabel} textAnchor="start">
          {money(first.value)}
        </text>
        <text x={last.x} y={height - 1} className={styles.sparklineLabel} textAnchor="end">
          {money(last.value)}
        </text>
      </svg>
    </div>
  );
}

/**
 * Two-bar Restaurant vs. Canteen comparison — see the same design-system
 * note. Direct value labels on both bars are mandatory here (not
 * optional styling) because both chart colors carry a contrast WARN
 * against their surface per the dataviz palette validator, which is only
 * legal paired with visible labels.
 */
function LocationSplitChart({ restaurant, canteen }: { restaurant: number; canteen: number }) {
  const max = Math.max(Math.abs(restaurant), Math.abs(canteen), 1);
  const restaurantPct = (Math.abs(restaurant) / max) * 100;
  const canteenPct = (Math.abs(canteen) / max) * 100;

  return (
    <div className={styles.splitChart}>
      <div className={styles.splitBarRow}>
        <span className={styles.splitBarLabel}>Restaurant</span>
        <div className={styles.splitBarTrack}>
          <div
            className={[styles.splitBarFillPrimary, restaurant < 0 ? styles.splitBarFillNegative : ""]
              .filter(Boolean)
              .join(" ")}
            style={{ width: `${restaurantPct}%` }}
          />
        </div>
        <span className={[styles.splitBarValue, restaurant < 0 ? styles.splitBarValueNegative : ""].filter(Boolean).join(" ")}>
          {money(restaurant)}
        </span>
      </div>
      <div className={styles.splitBarRow}>
        <span className={styles.splitBarLabel}>Canteen</span>
        <div className={styles.splitBarTrack}>
          <div
            className={[styles.splitBarFillSecondary, canteen < 0 ? styles.splitBarFillNegative : ""]
              .filter(Boolean)
              .join(" ")}
            style={{ width: `${canteenPct}%` }}
          />
        </div>
        <span className={[styles.splitBarValue, canteen < 0 ? styles.splitBarValueNegative : ""].filter(Boolean).join(" ")}>
          {money(canteen)}
        </span>
      </div>
      <p className={styles.splitChartCaption}>Net profit by location</p>
    </div>
  );
}
