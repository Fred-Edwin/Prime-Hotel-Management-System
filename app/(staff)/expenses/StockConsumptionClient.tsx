"use client";

import { useMemo, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { CategoryChips } from "@/components/CategoryChips";
import { SearchBar } from "@/components/SearchBar";
import { Stepper } from "@/components/Stepper";
import { Input } from "@/components/Input";
import { Toast } from "@/components/Toast";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { nairobiToday } from "@/lib/calculations";
import type { Database } from "@/lib/supabase/types";
import styles from "./expenses.module.css";

type ItemCategory = Database["public"]["Enums"]["item_category"];

interface ConsumptionItem {
  id: string;
  name: string;
  category: ItemCategory;
  buying_price: number;
}

interface ConsumptionClaim {
  id: string;
  quantity: number;
  value: number;
  note: string | null;
  created_at: string;
  items: { name: string } | null;
  users: { name: string } | null;
}

const CATEGORY_LABELS: Record<ItemCategory, string> = {
  beverages: "Beverages",
  snacks: "Snacks",
  meals: "Meals",
  fruits: "Fruits",
  cyber: "Cyber",
  retail: "Retail",
  ingredients: "Ingredients",
  stationery: "Stationery",
  dawa: "Dawa",
  sweets: "Sweets",
  biscuits: "Biscuits",
  packing_supplies: "Packing Supplies",
  others: "Others",
};

function todayISO(): string {
  return nairobiToday();
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-KE", { hour: "numeric", minute: "2-digit" });
}

interface StockConsumptionClientProps {
  /** API route base, e.g. "/api/staff-meals" — GET ?date=, POST body {item_id, quantity, note}. */
  apiPath: string;
  /** Log button / toast label, e.g. "Log meal", "Meal logged". */
  submitLabel: string;
  submittedLabel: string;
  /** "Today's staff meals" / "Today's complimentary meals" / "Today's stock adjustments". */
  listTitle: string;
  /** Empty-state copy for the running list. */
  emptyListBody: string;
  /** Placeholder text for the optional note field. */
  notePlaceholder: string;
  /**
   * Stock Adjustments only (docs/backlog/05_stock_consumption.md, signed
   * follow-up, 2026-07-22) — client feedback that physical recounts
   * sometimes find MORE stock than the system shows, not just less.
   * When true, a "Remove" / "Add" toggle appears above the quantity
   * stepper (relabeled from "Missing stock" / "Found extra", 2026-07-22,
   * client request for simpler wording). "Remove" behaves exactly like
   * the other two categories (capped at available stock, sent to the
   * server as a positive quantity — a shortfall). "Add" has NO upper cap
   * (you can't oversell by finding more stock) and is sent as a negative
   * quantity — the server's sign convention (positive = shortfall,
   * negative = surplus) is set once here, not re-derived per caller.
   */
  signed?: boolean;
}

/**
 * Generic "claim an item + quantity against stock, self-attributed"
 * screen — shared by the Staff meals / Complimentary meals / Stock
 * adjustments tabs on /expenses (docs/backlog/05_stock_consumption.md).
 * Originally StaffMealsClient.tsx (docs/01_DATA_MODEL.md §3.5); factored
 * into this parameterized form once a second and third category needed
 * the exact same picker/stepper/list pattern rather than duplicating
 * ~400 lines twice more — the three categories share their full item
 * picker, availability-cap, and running-list behavior, differing only in
 * copy and which API route they hit.
 *
 * Item picker: search + category filter + tap-to-select (not a native
 * <select> — a real restaurant location has ~70 sellable items, unusable
 * as a dropdown on mobile). Stepper capped at each item's current
 * available stock via `${apiPath}`'s own `*_available_stock()` RPC
 * (mirrors staff_meal_available_stock()'s "unknown vs. confirmed-empty"
 * distinction — undefined/null means don't cap, don't show an Available
 * label, since a brand-new item or one nobody's touched yet today has no
 * known stock figure). The server's real oversell check in each
 * create_*_entry() function remains the actual enforcement either way —
 * this is a UX cap on top of it, not a replacement.
 */
type AdjustmentDirection = "shortfall" | "surplus";

export function StockConsumptionClient({
  apiPath,
  submitLabel,
  submittedLabel,
  listTitle,
  emptyListBody,
  notePlaceholder,
  signed = false,
}: StockConsumptionClientProps) {
  const today = todayISO();
  const [items, setItems] = useState<ConsumptionItem[]>([]);
  const [claims, setClaims] = useState<ConsumptionClaim[]>([]);
  const [availableStock, setAvailableStock] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);

  const [itemId, setItemId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [quantity, setQuantity] = useState(1);
  const [direction, setDirection] = useState<AdjustmentDirection>("shortfall");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; status: "success" | "error" } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const res = await fetch(`${apiPath}?date=${today}`);
      const body = await res.json();
      if (cancelled) return;

      if (!res.ok) {
        setToast({ message: body.error ?? "Couldn't load this screen", status: "error" });
        setLoading(false);
        return;
      }

      setItems(body.items ?? []);
      setClaims(body.claims ?? []);
      setAvailableStock(
        Object.fromEntries(
          (body.availableStock ?? []).map((row: { item_id: string; available: number | null }) => [
            row.item_id,
            row.available,
          ]),
        ),
      );
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [apiPath, today]);

  const canSave = !submitting && itemId.length > 0 && quantity > 0;
  const selectedItem = items.find((item) => item.id === itemId) ?? null;

  function remainingStockFor(id: string): number | undefined {
    const value = availableStock[id];
    return value === null || value === undefined ? undefined : value;
  }

  const categoryOptions = useMemo(() => {
    const present = new Set(items.map((item) => item.category));
    return [
      { value: "all", label: "All" },
      ...Object.entries(CATEGORY_LABELS)
        .filter(([value]) => present.has(value as ItemCategory))
        .map(([value, label]) => ({ value, label })),
    ];
  }, [items]);

  const visibleItems = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return items.filter((item) => {
      if (categoryFilter !== "all" && item.category !== categoryFilter) return false;
      if (term && !item.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [items, searchTerm, categoryFilter]);

  function resetForm() {
    setItemId("");
    setSearchTerm("");
    setCategoryFilter("all");
    setQuantity(1);
    setDirection("shortfall");
    setNote("");
  }

  // Surplus has no upper cap — you can't oversell by finding more stock
  // than the system shows. Only shortfall (and every other, unsigned,
  // consumption category) is capped at available stock.
  const stepperMax = signed && direction === "surplus" ? undefined : remainingStockFor(itemId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;

    // Sign convention set once here (docs/backlog/05_stock_consumption.md):
    // positive quantity = shortfall, negative = surplus. Every other
    // caller of this component (staff meals, complimentary meals) never
    // sets `signed`, so this is always a no-op positive quantity there.
    const signedQuantity = signed && direction === "surplus" ? -quantity : quantity;

    setSubmitting(true);
    try {
      const res = await fetch(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_id: itemId,
          quantity: signedQuantity,
          note: note.trim() ? note.trim() : null,
        }),
      });
      const body = await res.json();

      if (!res.ok) {
        setToast({ message: body.error ?? "Couldn't save this entry", status: "error" });
        return;
      }

      const claimedItem = items.find((item) => item.id === itemId);
      setClaims((prev) => [
        {
          id: body.claim.id,
          quantity: body.claim.quantity,
          value: body.claim.value,
          note: body.claim.note,
          created_at: body.claim.created_at,
          items: claimedItem ? { name: claimedItem.name } : null,
          users: null,
        },
        ...prev,
      ]);
      // A shortfall reduces available stock; a surplus increases it —
      // mirror the server's own sign convention so the local optimistic
      // update matches what a refetch would show.
      setAvailableStock((prev) => ({ ...prev, [itemId]: (prev[itemId] ?? 0) - signedQuantity }));
      setToast({ message: submittedLabel, status: "success" });
      resetForm();
    } catch {
      setToast({ message: "Couldn't reach the server — check your connection and try again.", status: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  const todayTotal = claims.reduce((sum, claim) => sum + claim.value, 0);

  if (loading) {
    return <p className={styles.loading}>Loading…</p>;
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="expenses" size={48} />}
        heading="No items yet"
        body="Ask an admin to add sellable items before you can log an entry."
      />
    );
  }

  return (
    <div className={styles.page}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Item</span>
          {selectedItem ? (
            <div className={styles.selectedItemRow}>
              <div>
                <span className={styles.selectedItemName}>{selectedItem.name}</span>
                <span className={styles.selectedItemMeta}>
                  Cost: KES {selectedItem.buying_price.toFixed(2)}
                </span>
              </div>
              <button
                type="button"
                className={styles.changeItemButton}
                onClick={() => {
                  setItemId("");
                  setSearchTerm("");
                }}
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <CategoryChips options={categoryOptions} value={categoryFilter} onChange={setCategoryFilter} />
              <SearchBar value={searchTerm} onChange={setSearchTerm} placeholder="Search items…" />
              {visibleItems.length === 0 ? (
                <p className={styles.noResults}>No items match &ldquo;{searchTerm}&rdquo;.</p>
              ) : (
                <ul className={styles.pickerList}>
                  {visibleItems.map((item) => {
                    const remaining = remainingStockFor(item.id);
                    // In signed mode, an item at 0 (or unknown) available
                    // stock is still a valid pick — that's exactly when an
                    // "Add" (surplus) adjustment makes sense.
                    const disablePick = !signed && remaining !== undefined && remaining <= 0;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={styles.pickerRow}
                          onClick={() => setItemId(item.id)}
                          disabled={disablePick}
                        >
                          <span className={styles.pickerRowName}>{item.name}</span>
                          <span className={styles.pickerRowMeta}>
                            Cost: KES {item.buying_price.toFixed(2)}
                            {remaining !== undefined && ` · Available: ${remaining}`}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>

        {selectedItem && (
          <>
            {signed && (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>What happened?</span>
                <CategoryChips
                  options={[
                    { value: "shortfall", label: "Remove" },
                    { value: "surplus", label: "Add" },
                  ]}
                  value={direction}
                  onChange={(value) => setDirection(value as AdjustmentDirection)}
                />
              </div>
            )}

            <div className={styles.field}>
              <span className={styles.fieldLabel}>Quantity</span>
              <Stepper
                value={quantity}
                onChange={setQuantity}
                min={1}
                max={stepperMax}
                limitMessage={stepperMax !== undefined ? `Only ${stepperMax} left` : undefined}
                aria-label="Quantity"
              />
            </div>

            <Input
              label="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={notePlaceholder}
            />

            <Button type="submit" variant="primary" fullWidth disabled={!canSave}>
              {submitting ? "Saving…" : submitLabel}
            </Button>
          </>
        )}
      </form>

      <div className={styles.listSection}>
        <div className={styles.listHeader}>
          <h2 className={styles.listTitle}>{listTitle}</h2>
          {claims.length > 0 && (
            <span className={styles.listTotal}>
              {todayTotal < 0 ? "+" : ""}KES {Math.abs(todayTotal).toFixed(2)}
            </span>
          )}
        </div>

        {claims.length === 0 ? (
          <EmptyState icon={<Icon name="expenses" size={48} />} heading="Nothing logged yet" body={emptyListBody} />
        ) : (
          <ul className={styles.expenseList}>
            {claims.map((claim) => {
              // Signed mode (Stock Adjustments): a negative quantity is a
              // surplus (stock found, added back) — show it distinctly
              // from a shortfall rather than as a bare, easy-to-misread
              // number (docs/backlog/05_stock_consumption.md).
              const isSurplus = signed && claim.quantity < 0;
              return (
                <li key={claim.id} className={styles.expenseRow}>
                  <div>
                    <p className={styles.expenseCategory}>
                      {signed
                        ? `${isSurplus ? "+" : "−"}${Math.abs(claim.quantity)} × ${claim.items?.name ?? "Item"}`
                        : `${claim.quantity} × ${claim.items?.name ?? "Item"}`}
                      {signed && (
                        <span className={styles.expenseNote}> {isSurplus ? "(Added)" : "(Removed)"}</span>
                      )}
                    </p>
                    <p className={styles.expenseNote}>
                      {formatTime(claim.created_at)} · {claim.users?.name ?? "You"}
                      {claim.note ? ` · ${claim.note}` : ""}
                    </p>
                  </div>
                  <span className={styles.expenseAmount}>
                    {isSurplus ? "+" : ""}KES {Math.abs(claim.value).toFixed(2)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {toast && <Toast message={toast.message} status={toast.status} onDismiss={() => setToast(null)} />}
    </div>
  );
}
