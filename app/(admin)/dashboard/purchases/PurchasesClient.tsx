"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { PeriodToggle } from "@/components/PeriodToggle";
import { SearchBar } from "@/components/SearchBar";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { LowStockIndicator } from "@/components/LowStockIndicator";
import { PurchaseModal, type PurchaseModalIngredient } from "@/components/PurchaseModal";
import { CanteenPurchaseModal, type CanteenPurchaseModalItem } from "@/components/CanteenPurchaseModal";
import { Toast } from "@/components/Toast";
import { ActionMenu } from "@/components/ActionMenu";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import catalogStyles from "../../catalog.module.css";
import styles from "./purchases.module.css";

type Period = "today" | "week" | "month";
type Source = "ingredients" | "canteen";

interface IngredientPurchaseRow {
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

interface IngredientStockOnHandRow {
  ingredient_id: string;
  name: string;
  unit: string;
  quantity: number;
  average_cost: number;
  value: number;
}

interface IngredientPurchasesResponse {
  period: Period;
  from: string;
  to: string;
  purchases: IngredientPurchaseRow[];
  stockOnHand: IngredientStockOnHandRow[];
}

interface CanteenPurchaseRow {
  id: string;
  item_id: string;
  purchase_date: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  supplier_note: string | null;
  created_at: string;
  items: { name: string } | null;
  users: { name: string } | null;
}

interface CanteenStockOnHandRow {
  item_id: string;
  name: string;
  quantity: number;
  average_cost: number;
  value: number;
}

interface CanteenPurchasesResponse {
  period: Period;
  from: string;
  to: string;
  purchases: CanteenPurchaseRow[];
  stockOnHand: CanteenStockOnHandRow[];
}

const PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

const SOURCE_OPTIONS = [
  { value: "ingredients", label: "Ingredients" },
  { value: "canteen", label: "Canteen Stock" },
];

function money(value: number): string {
  return `KES ${Math.round(value).toLocaleString("en-KE")}`;
}

function qty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Admin purchases screen — one screen for both purchase logs, switched
 * by a "Ingredients" / "Canteen Stock" source tab rather than two
 * separate nav entries + routes. The two datasets are structurally
 * identical (stock-on-hand + purchase-history + a "log a purchase"
 * modal) but semantically disjoint — an ingredient purchase and a
 * canteen_independent item purchase never need to appear in the same
 * row, so a merged table would force awkward column reconciliation
 * (ingredients have a `unit`, items don't) for no real benefit. The tab
 * removes the "which purchases screen do I want" decision instead,
 * consolidating to one sidebar entry ("Purchases").
 *
 * Ingredients: docs/01_DATA_MODEL.md §3.2's "Purchases: who buys, who
 * receives, and how the cost is derived" — both admin and the store
 * manager can log a purchase; folds into ingredient_entries.received.
 * Canteen: §3.2's "Canteen's own stock purchases" subsection —
 * admin-only (canteen has no store-manager-equivalent role), scoped to
 * canteen_independent items only, folds into stock_entries.added_stock.
 * Reporting/records-browsing lens, same as /dashboard/orders (Phase 9)
 * — individual transactional records to scan, not aggregate metrics.
 */
export function PurchasesClient() {
  const [source, setSource] = useState<Source>("ingredients");
  const [period, setPeriod] = useState<Period>("today");
  const [search, setSearch] = useState("");

  const [ingredientData, setIngredientData] = useState<IngredientPurchasesResponse | null>(null);
  const [canteenData, setCanteenData] = useState<CanteenPurchasesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [ingredientPurchaseTarget, setIngredientPurchaseTarget] = useState<PurchaseModalIngredient | null>(
    null,
  );
  const [canteenPurchaseTarget, setCanteenPurchaseTarget] = useState<CanteenPurchaseModalItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<
    | { source: "ingredients"; purchase: IngredientPurchaseRow }
    | { source: "canteen"; purchase: CanteenPurchaseRow }
    | null
  >(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const url =
        deleteTarget.source === "ingredients"
          ? `/api/ingredient-purchases/${deleteTarget.purchase.id}`
          : `/api/canteen-purchases/${deleteTarget.purchase.id}`;
      const res = await fetch(url, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to delete purchase");
      setDeleteTarget(null);
      setToast("Purchase deleted");
      await load();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete purchase");
    } finally {
      setDeleting(false);
    }
  }

  const loadIngredients = useCallback(async () => {
    const res = await fetch(`/api/ingredient-purchases?period=${period}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "Failed to load purchases");
    setIngredientData(json as IngredientPurchasesResponse);
  }, [period]);

  const loadCanteen = useCallback(async () => {
    const res = await fetch(`/api/canteen-purchases?period=${period}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "Failed to load purchases");
    setCanteenData(json as CanteenPurchasesResponse);
  }, [period]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (source === "ingredients") await loadIngredients();
      else await loadCanteen();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load purchases");
    } finally {
      setLoading(false);
    }
  }, [source, loadIngredients, loadCanteen]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  function openIngredientPurchase(row: IngredientStockOnHandRow) {
    setIngredientPurchaseTarget({
      id: row.ingredient_id,
      name: row.name,
      unit: row.unit,
      buying_price: row.average_cost,
    });
  }

  function openCanteenPurchase(row: CanteenStockOnHandRow) {
    setCanteenPurchaseTarget({
      id: row.item_id,
      name: row.name,
      buying_price: row.average_cost,
    });
  }

  const isIngredients = source === "ingredients";
  const searchTerm = search.trim().toLowerCase();
  const filteredIngredientStock = (ingredientData?.stockOnHand ?? []).filter((row) =>
    row.name.toLowerCase().includes(searchTerm),
  );
  const filteredCanteenStock = (canteenData?.stockOnHand ?? []).filter((row) =>
    row.name.toLowerCase().includes(searchTerm),
  );
  const stockOnHandEmpty = isIngredients
    ? !loading && ingredientData && ingredientData.stockOnHand.length === 0
    : !loading && canteenData && canteenData.stockOnHand.length === 0;
  const stockOnHandNoMatches = isIngredients
    ? !stockOnHandEmpty && searchTerm !== "" && filteredIngredientStock.length === 0
    : !stockOnHandEmpty && searchTerm !== "" && filteredCanteenStock.length === 0;
  const purchasesEmpty = isIngredients
    ? ingredientData && ingredientData.purchases.length === 0
    : canteenData && canteenData.purchases.length === 0;

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
          <PeriodToggle options={SOURCE_OPTIONS} value={source} onChange={(v) => setSource(v as Source)} />
          <PeriodToggle options={PERIOD_OPTIONS} value={period} onChange={(v) => setPeriod(v as Period)} />
        </div>
      </div>

      {error && <p className={catalogStyles.formError}>{error}</p>}

      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder={isIngredients ? "Search ingredients…" : "Search items…"}
      />

      {/* Stock on hand — current quantity + running weighted-average cost,
          independent of the period toggle above (it's a point-in-time
          snapshot, not a period-bounded log). Each row is itself the
          "log a purchase for this ingredient/item" entry point — click
          anywhere on the row, or the per-row icon button — rather than a
          single global button opening a picker modal. Removes an extra
          find-it-again step, since the row the admin is already looking
          at IS the thing they want to buy; matches the Ledger's existing
          per-row edit pattern (LedgerClient.tsx's editableRow/editButton). */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Stock on hand</h2>
          <LowStockIndicator
            variant="pill"
            label={isIngredients ? "Restaurant only" : "Canteen-independent items only"}
          />
        </div>
        {stockOnHandEmpty ? (
          <EmptyState
            icon={<Icon name={isIngredients ? "ingredients" : "store"} size={48} />}
            heading={isIngredients ? "No ingredients yet" : "No canteen-independent items yet"}
            body={
              isIngredients
                ? "Add ingredients on the Ingredients screen — they'll appear here to log a purchase against."
                : "Mark an item as 'Canteen independent' on the Items screen — it'll appear here to log a purchase against."
            }
          />
        ) : stockOnHandNoMatches ? (
          <p className={styles.noResults}>No {isIngredients ? "ingredients" : "items"} match &ldquo;{search}&rdquo;.</p>
        ) : isIngredients ? (
          <>
            <Card className={`${catalogStyles.tableCard} ${catalogStyles.desktopOnly}`}>
              <table className={catalogStyles.table}>
                <thead>
                  <tr>
                    <th>Ingredient</th>
                    <th className={catalogStyles.numeric}>On hand</th>
                    <th className={catalogStyles.numeric}>Avg. cost</th>
                    <th className={catalogStyles.numeric}>Value</th>
                    <th aria-label="Log purchase" />
                  </tr>
                </thead>
                <tbody>
                  {filteredIngredientStock.map((row) => (
                    <tr key={row.ingredient_id} className={styles.purchaseRow} onClick={() => openIngredientPurchase(row)}>
                      <td>{row.name}</td>
                      <td className={catalogStyles.numeric}>
                        {qty(row.quantity)} {row.unit}
                      </td>
                      <td className={catalogStyles.numeric}>{money(row.average_cost)}</td>
                      <td className={catalogStyles.numeric}>{money(row.value)}</td>
                      <td>
                        <button
                          type="button"
                          className={styles.purchaseButton}
                          onClick={(e) => {
                            e.stopPropagation();
                            openIngredientPurchase(row);
                          }}
                          aria-label={`Log purchase — ${row.name}`}
                        >
                          <Icon name="add" size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <ul className={`${catalogStyles.cardList} ${catalogStyles.mobileOnly}`}>
              {filteredIngredientStock.map((row) => (
                <li
                  key={row.ingredient_id}
                  className={`${catalogStyles.itemCard} ${styles.purchaseCard}`}
                  onClick={() => openIngredientPurchase(row)}
                >
                  <div className={catalogStyles.itemCardRow}>
                    <span className={catalogStyles.itemCardIdentity}>
                      <span className={catalogStyles.itemCardName}>{row.name}</span>
                      <span className={catalogStyles.itemCardCategory}>Avg. cost {money(row.average_cost)}</span>
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
        ) : (
          <>
            <Card className={`${catalogStyles.tableCard} ${catalogStyles.desktopOnly}`}>
              <table className={catalogStyles.table}>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className={catalogStyles.numeric}>On hand</th>
                    <th className={catalogStyles.numeric}>Avg. cost</th>
                    <th className={catalogStyles.numeric}>Value</th>
                    <th aria-label="Log purchase" />
                  </tr>
                </thead>
                <tbody>
                  {filteredCanteenStock.map((row) => (
                    <tr key={row.item_id} className={styles.purchaseRow} onClick={() => openCanteenPurchase(row)}>
                      <td>{row.name}</td>
                      <td className={catalogStyles.numeric}>{qty(row.quantity)}</td>
                      <td className={catalogStyles.numeric}>{money(row.average_cost)}</td>
                      <td className={catalogStyles.numeric}>{money(row.value)}</td>
                      <td>
                        <button
                          type="button"
                          className={styles.purchaseButton}
                          onClick={(e) => {
                            e.stopPropagation();
                            openCanteenPurchase(row);
                          }}
                          aria-label={`Log purchase — ${row.name}`}
                        >
                          <Icon name="add" size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <ul className={`${catalogStyles.cardList} ${catalogStyles.mobileOnly}`}>
              {filteredCanteenStock.map((row) => (
                <li
                  key={row.item_id}
                  className={`${catalogStyles.itemCard} ${styles.purchaseCard}`}
                  onClick={() => openCanteenPurchase(row)}
                >
                  <div className={catalogStyles.itemCardRow}>
                    <span className={catalogStyles.itemCardIdentity}>
                      <span className={catalogStyles.itemCardName}>{row.name}</span>
                      <span className={catalogStyles.itemCardCategory}>Avg. cost {money(row.average_cost)}</span>
                    </span>
                    <span className={catalogStyles.itemCardMetrics}>
                      <span className={catalogStyles.itemCardPrice}>{money(row.value)}</span>
                      <span className={styles.stockBadge}>{qty(row.quantity)}</span>
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
        {loading && !ingredientData && !canteenData ? (
          <p>Loading…</p>
        ) : purchasesEmpty ? (
          <EmptyState
            icon={<Icon name={isIngredients ? "ingredients" : "store"} size={48} />}
            heading="No purchases this period"
            body={
              isIngredients
                ? "Purchases logged here or by the store manager on /store will show up in this list."
                : "Purchases logged here will show up in this list."
            }
          />
        ) : isIngredients ? (
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
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {(ingredientData?.purchases ?? []).map((purchase) => (
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
                      <td>
                        <ActionMenu
                          aria-label={`Actions for purchase — ${purchase.ingredients?.name ?? "Unknown ingredient"}`}
                          items={[
                            {
                              label: "Delete",
                              destructive: true,
                              onClick: () => setDeleteTarget({ source: "ingredients", purchase }),
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <ul className={`${catalogStyles.cardList} ${catalogStyles.mobileOnly}`}>
              {(ingredientData?.purchases ?? []).map((purchase) => (
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
                  <div className={styles.itemCardActionRow}>
                    <button
                      type="button"
                      className={`${catalogStyles.itemCardEditBtn} ${styles.itemCardDeleteBtn}`}
                      onClick={() => setDeleteTarget({ source: "ingredients", purchase })}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <Card className={`${catalogStyles.tableCard} ${catalogStyles.desktopOnly}`}>
              <table className={catalogStyles.table}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Item</th>
                    <th className={catalogStyles.numeric}>Quantity</th>
                    <th className={catalogStyles.numeric}>Unit cost</th>
                    <th className={catalogStyles.numeric}>Total</th>
                    <th>Logged by</th>
                    <th>Note</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {(canteenData?.purchases ?? []).map((purchase) => (
                    <tr key={purchase.id}>
                      <td>{purchase.purchase_date}</td>
                      <td>{purchase.items?.name ?? "Unknown item"}</td>
                      <td className={catalogStyles.numeric}>{qty(purchase.quantity)}</td>
                      <td className={catalogStyles.numeric}>{money(purchase.unit_cost)}</td>
                      <td className={catalogStyles.numeric}>{money(purchase.total_cost)}</td>
                      <td>{purchase.users?.name ?? "Unknown"}</td>
                      <td>{purchase.supplier_note ?? "—"}</td>
                      <td>
                        <ActionMenu
                          aria-label={`Actions for purchase — ${purchase.items?.name ?? "Unknown item"}`}
                          items={[
                            {
                              label: "Delete",
                              destructive: true,
                              onClick: () => setDeleteTarget({ source: "canteen", purchase }),
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <ul className={`${catalogStyles.cardList} ${catalogStyles.mobileOnly}`}>
              {(canteenData?.purchases ?? []).map((purchase) => (
                <li key={purchase.id} className={catalogStyles.itemCard}>
                  <div className={catalogStyles.itemCardRow}>
                    <span className={catalogStyles.itemCardIdentity}>
                      <span className={catalogStyles.itemCardName}>{purchase.items?.name ?? "Unknown item"}</span>
                      <span className={catalogStyles.itemCardCategory}>
                        {purchase.purchase_date} · {purchase.users?.name ?? "Unknown"}
                      </span>
                    </span>
                    <span className={catalogStyles.itemCardMetrics}>
                      <span className={catalogStyles.itemCardPrice}>{money(purchase.total_cost)}</span>
                      <span className={styles.stockBadge}>{qty(purchase.quantity)}</span>
                    </span>
                  </div>
                  <div className={styles.itemCardActionRow}>
                    <button
                      type="button"
                      className={`${catalogStyles.itemCardEditBtn} ${styles.itemCardDeleteBtn}`}
                      onClick={() => setDeleteTarget({ source: "canteen", purchase })}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <PurchaseModal
        open={ingredientPurchaseTarget !== null}
        onClose={() => setIngredientPurchaseTarget(null)}
        fixedIngredient={ingredientPurchaseTarget ?? undefined}
        onSaved={() => {
          setToast("Purchase logged");
          load();
        }}
      />

      <CanteenPurchaseModal
        open={canteenPurchaseTarget !== null}
        onClose={() => setCanteenPurchaseTarget(null)}
        fixedItem={canteenPurchaseTarget ?? undefined}
        onSaved={() => {
          setToast("Purchase logged");
          load();
        }}
      />

      {/* Delete — reverses both side effects a purchase caused at insert
          time (weighted-average buying_price, that period's added_stock/
          received) server-side via delete_ingredient_purchase()/
          delete_canteen_stock_purchase(); see
          supabase/migrations/20260721060000_purchase_delete.sql. Purchases
          are otherwise an append-only log by design — this is a narrow,
          purpose-built correction path, not a general edit. */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        title="Delete this purchase?"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setDeleteTarget(null);
                setDeleteError(null);
              }}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete purchase"}
            </Button>
          </>
        }
      >
        <div className={catalogStyles.form}>
          <p className={styles.deleteWarning}>
            This removes{" "}
            <strong>
              {deleteTarget?.source === "ingredients"
                ? deleteTarget.purchase.ingredients?.name ?? "this purchase"
                : deleteTarget?.source === "canteen"
                  ? deleteTarget.purchase.items?.name ?? "this purchase"
                  : ""}
            </strong>
            {deleteTarget ? ` — ${qty(deleteTarget.purchase.quantity)} on ${deleteTarget.purchase.purchase_date}` : ""}
            , recalculates the average cost from the remaining purchases, and removes this quantity from that
            period&rsquo;s stock. This can&rsquo;t be undone.
          </p>
          {deleteError && <p className={catalogStyles.formError}>{deleteError}</p>}
        </div>
      </Modal>

      {toast && <Toast message={toast} status="success" onDismiss={() => setToast(null)} />}
    </div>
  );
}
