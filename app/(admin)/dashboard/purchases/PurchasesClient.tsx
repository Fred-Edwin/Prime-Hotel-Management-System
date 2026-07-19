"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { PeriodToggle } from "@/components/PeriodToggle";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { LowStockIndicator } from "@/components/LowStockIndicator";
import { PurchaseModal, type PurchaseModalIngredient } from "@/components/PurchaseModal";
import { Toast } from "@/components/Toast";
import catalogStyles from "../../catalog.module.css";
import styles from "./purchases.module.css";

type Period = "today" | "week" | "month";

interface PurchaseRow {
  id: string;
  ingredient_id: string;
  purchase_date: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  supplier_note: string | null;
  created_at: string;
  ingredients: { name: string; unit: string } | null;
  users: { name: string } | null;
}

interface StockOnHandRow {
  ingredient_id: string;
  name: string;
  unit: string;
  quantity: number;
  average_cost: number;
  value: number;
}

interface PurchasesResponse {
  period: Period;
  from: string;
  to: string;
  purchases: PurchaseRow[];
  stockOnHand: StockOnHandRow[];
}

const PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

function money(value: number): string {
  return `KES ${Math.round(value).toLocaleString("en-KE")}`;
}

function qty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Admin ingredient purchases screen — see docs/01_DATA_MODEL.md §3.2's
 * purchases section. Two sections: a purchase-history log (who bought
 * what, when, at what price — both admin's own entries here and the
 * store manager's from /store show up together) and a stock-on-hand
 * summary (current quantity + running weighted-average cost per
 * ingredient). Reporting/records-browsing lens, same as /dashboard/orders
 * (Phase 9) — these are individual transactional records to scan, not
 * aggregate metrics needing a chart.
 */
export function PurchasesClient() {
  const [period, setPeriod] = useState<Period>("today");
  const [data, setData] = useState<PurchasesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ingredient-purchases?period=${period}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to load purchases");
      setData(json as PurchasesResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load purchases");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const ingredientOptions: PurchaseModalIngredient[] = (data?.stockOnHand ?? []).map((row) => ({
    id: row.ingredient_id,
    name: row.name,
    unit: row.unit,
    buying_price: row.average_cost,
  }));

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={catalogStyles.title}>Purchases</h1>
          <Link href="/dashboard" className={styles.backLink}>
            ← Back to dashboard
          </Link>
        </div>
        <div className={styles.controls}>
          <PeriodToggle options={PERIOD_OPTIONS} value={period} onChange={(v) => setPeriod(v as Period)} />
          <Button variant="primary" onClick={() => setPurchaseModalOpen(true)}>
            <Icon name="add" size={16} />
            Log purchase
          </Button>
        </div>
      </div>

      {error && <p className={catalogStyles.formError}>{error}</p>}

      {/* Stock on hand — current quantity + running weighted-average cost
          per ingredient, independent of the period toggle above (it's a
          point-in-time snapshot, not a period-bounded log). */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Stock on hand</h2>
          <LowStockIndicator variant="pill" label="Restaurant only" />
        </div>
        {!loading && data && data.stockOnHand.length === 0 ? (
          <EmptyState
            icon={<Icon name="ingredients" size={48} />}
            heading="No ingredients yet"
            body="Add ingredients on the Ingredients screen before logging purchases."
          />
        ) : (
          <>
            <Card className={`${catalogStyles.tableCard} ${catalogStyles.desktopOnly}`}>
              <table className={catalogStyles.table}>
                <thead>
                  <tr>
                    <th>Ingredient</th>
                    <th className={catalogStyles.numeric}>On hand</th>
                    <th className={catalogStyles.numeric}>Avg. cost</th>
                    <th className={catalogStyles.numeric}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.stockOnHand ?? []).map((row) => (
                    <tr key={row.ingredient_id}>
                      <td>{row.name}</td>
                      <td className={catalogStyles.numeric}>
                        {qty(row.quantity)} {row.unit}
                      </td>
                      <td className={catalogStyles.numeric}>{money(row.average_cost)}</td>
                      <td className={catalogStyles.numeric}>{money(row.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <ul className={`${catalogStyles.cardList} ${catalogStyles.mobileOnly}`}>
              {(data?.stockOnHand ?? []).map((row) => (
                <li key={row.ingredient_id} className={catalogStyles.itemCard}>
                  <div className={catalogStyles.itemCardRow}>
                    <span className={catalogStyles.itemCardIdentity}>
                      <span className={catalogStyles.itemCardName}>{row.name}</span>
                      <span className={catalogStyles.itemCardCategory}>
                        Avg. cost {money(row.average_cost)}
                      </span>
                    </span>
                    <span className={catalogStyles.itemCardMetrics}>
                      <span className={catalogStyles.itemCardPrice}>{money(row.value)}</span>
                      <span className={styles.stockBadge}>
                        {qty(row.quantity)} {row.unit}
                      </span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* Purchase history — period-bounded log of individual buying events. */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Purchase history</h2>
        </div>
        {loading && !data ? (
          <p>Loading…</p>
        ) : data && data.purchases.length === 0 ? (
          <EmptyState
            icon={<Icon name="ingredients" size={48} />}
            heading="No purchases this period"
            body="Purchases logged here or by the store manager on /store will show up in this list."
          />
        ) : (
          <>
            <Card className={`${catalogStyles.tableCard} ${catalogStyles.desktopOnly}`}>
              <table className={catalogStyles.table}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Ingredient</th>
                    <th className={catalogStyles.numeric}>Quantity</th>
                    <th className={catalogStyles.numeric}>Unit cost</th>
                    <th className={catalogStyles.numeric}>Total</th>
                    <th>Logged by</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.purchases ?? []).map((purchase) => (
                    <tr key={purchase.id}>
                      <td>{purchase.purchase_date}</td>
                      <td>{purchase.ingredients?.name ?? "Unknown ingredient"}</td>
                      <td className={catalogStyles.numeric}>
                        {qty(purchase.quantity)} {purchase.ingredients?.unit ?? ""}
                      </td>
                      <td className={catalogStyles.numeric}>{money(purchase.unit_cost)}</td>
                      <td className={catalogStyles.numeric}>{money(purchase.total_cost)}</td>
                      <td>{purchase.users?.name ?? "Unknown"}</td>
                      <td>{purchase.supplier_note ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <ul className={`${catalogStyles.cardList} ${catalogStyles.mobileOnly}`}>
              {(data?.purchases ?? []).map((purchase) => (
                <li key={purchase.id} className={catalogStyles.itemCard}>
                  <div className={catalogStyles.itemCardRow}>
                    <span className={catalogStyles.itemCardIdentity}>
                      <span className={catalogStyles.itemCardName}>
                        {purchase.ingredients?.name ?? "Unknown ingredient"}
                      </span>
                      <span className={catalogStyles.itemCardCategory}>
                        {purchase.purchase_date} · {purchase.users?.name ?? "Unknown"}
                      </span>
                    </span>
                    <span className={catalogStyles.itemCardMetrics}>
                      <span className={catalogStyles.itemCardPrice}>{money(purchase.total_cost)}</span>
                      <span className={styles.stockBadge}>
                        {qty(purchase.quantity)} {purchase.ingredients?.unit ?? ""}
                      </span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <PurchaseModal
        open={purchaseModalOpen}
        onClose={() => setPurchaseModalOpen(false)}
        ingredients={ingredientOptions}
        onSaved={() => {
          setToast("Purchase logged");
          load();
        }}
      />

      {toast && <Toast message={toast} status="success" onDismiss={() => setToast(null)} />}
    </div>
  );
}
