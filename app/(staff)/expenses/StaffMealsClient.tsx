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

interface StaffMealItem {
  id: string;
  name: string;
  category: ItemCategory;
  buying_price: number;
}

interface StaffMealClaim {
  id: string;
  quantity: number;
  value: number;
  note: string | null;
  created_at: string;
  items: { name: string } | null;
  users: { name: string } | null;
}

// Same label set as app/(admin)/items/ItemsClient.tsx's CATEGORY_LABELS —
// duplicated rather than imported since that file is admin-only screen
// code, not a shared module; keep in sync if the enum's labels ever change.
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

/**
 * Staff meal claim tab (docs/01_DATA_MODEL.md §3.5, docs/backlog/02_staff_meals.md)
 * — a second tab alongside ExpensesClient on the same /expenses screen,
 * not a new standalone route (confirmed design). Item + quantity, like a
 * single-line lightweight order — never a free-text cash amount, so the
 * value is always derived server-side from the item's real buying price.
 * Single submit + running list, same cadence as ExpensesClient (a claim
 * happens sporadically, one at a time).
 *
 * Item picker: search + category filter + tap-to-select, mirroring
 * OrdersClient.tsx's SearchBar + filtered-list pattern — NOT a native
 * <select> dropdown. A dropdown was the first implementation, but a real
 * restaurant location has ~70 sellable items; a 70-option native <select>
 * is slow to scroll and impossible to search on mobile (this is a
 * mobile-first app), the exact problem Orders' own item picker already
 * solves this way. Once an item is picked, the list collapses to a
 * compact "selected item" summary (with a "Change" affordance) so the
 * quantity/note/submit controls have room, rather than a
 * stepper-per-visible-row like Orders (this screen only ever claims one
 * item per submission, not a multi-item cart).
 *
 * UX audit follow-ups applied (post-launch, same session as the
 * dropdown->search redesign):
 *  - Stepper is capped at remaining stock, sourced from
 *    public.staff_meal_available_stock() (§3.5) — an inline
 *    "Available: X" label backs the cap. This is a direct fix for
 *    docs/design/02_PATTERNS_AND_CHECKLIST.md §6's "oversell visually
 *    prevented before it's attempted" requirement. The FIRST version of
 *    this fix used OrdersClient.tsx's remainingStockFor pattern (reading
 *    today's stock_entries row directly), but that only shows a number
 *    once today's row already exists — the common case is no row exists
 *    yet (nobody's logged a till sale today), so the cap silently
 *    vanished and a real oversell rejection ("That's more than the
 *    available stock available") still slipped through server-side.
 *    staff_meal_available_stock() fixes this by reusing
 *    create_staff_meal_entry()'s own opening-stock-carry-forward logic
 *    (most recent stock_entries row's closing_stock, which is already
 *    net of every same-day claim) instead of re-deriving a second,
 *    incomplete version of that math client-side.
 *  - Each picker row shows the item's cost (buying price) for context.
 *  - A CategoryChips row above search lets staff narrow by category
 *    (e.g. "Beverages") before typing a name — cuts scanning effort for
 *    someone who doesn't remember an item's exact name.
 *  - "Today's staff meals" rows show a time-of-day, not just item/value,
 *    so two claims by the same person on the same day are distinguishable.
 */
export function StaffMealsClient() {
  const today = todayISO();
  const [items, setItems] = useState<StaffMealItem[]>([]);
  const [claims, setClaims] = useState<StaffMealClaim[]>([]);
  // null = no stock_entries row exists yet for this item (this or any
  // prior period) — "unknown," not "confirmed empty." See
  // staff_meal_available_stock()'s own header comment for why this
  // distinction matters: collapsing it to 0 would make every item
  // unclaimable until its first till sale of the day.
  const [availableStock, setAvailableStock] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);

  const [itemId, setItemId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; status: "success" | "error" } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const res = await fetch(`/api/staff-meals?date=${today}`);
      const body = await res.json();
      if (cancelled) return;

      if (!res.ok) {
        setToast({ message: body.error ?? "Couldn't load staff meals", status: "error" });
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
  }, [today]);

  const canSave = !submitting && itemId.length > 0 && quantity > 0;
  const selectedItem = items.find((item) => item.id === itemId) ?? null;

  /**
   * Remaining stock for an item right now, from
   * public.staff_meal_available_stock() (§3.5). Returns undefined when
   * that item has no stock_entries row at all yet — "unknown," not
   * "confirmed empty" (see that function's header comment) — in which
   * case the picker doesn't cap or show an Available label, same
   * fallback OrdersClient.tsx already uses for its own "no row yet"
   * case. The server's oversell re-check in create_staff_meal_entry()
   * remains the actual enforcement either way — this is a UX cap on top
   * of it, not a replacement, so a stale/unrefreshed figure can never
   * let an oversell actually persist.
   */
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
    setNote("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/staff-meals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_id: itemId,
          quantity,
          note: note.trim() ? note.trim() : null,
        }),
      });
      const body = await res.json();

      if (!res.ok) {
        setToast({ message: body.error ?? "Couldn't save the meal claim", status: "error" });
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
          users: null, // it's always the current user's own claim in this list — name shown via "You" below
        },
        ...prev,
      ]);
      // The just-claimed quantity is no longer available — reflect it
      // locally so a second claim on the same item in the same visit
      // sees the reduced ceiling without waiting on a refetch.
      setAvailableStock((prev) => ({ ...prev, [itemId]: (prev[itemId] ?? 0) - quantity }));
      setToast({ message: "Meal logged", status: "success" });
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
        body="Ask an admin to add sellable items before you can log a staff meal."
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
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={styles.pickerRow}
                          onClick={() => setItemId(item.id)}
                          disabled={remaining !== undefined && remaining <= 0}
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
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Quantity</span>
              <Stepper
                value={quantity}
                onChange={setQuantity}
                min={1}
                max={remainingStockFor(selectedItem.id)}
                limitMessage={
                  remainingStockFor(selectedItem.id) !== undefined
                    ? `Only ${remainingStockFor(selectedItem.id)} left`
                    : undefined
                }
                aria-label="Quantity"
              />
            </div>

            <Input
              label="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. lunch"
            />

            <Button type="submit" variant="primary" fullWidth disabled={!canSave}>
              {submitting ? "Saving…" : "Log meal"}
            </Button>
          </>
        )}
      </form>

      <div className={styles.listSection}>
        <div className={styles.listHeader}>
          <h2 className={styles.listTitle}>Today&apos;s staff meals</h2>
          {claims.length > 0 && (
            <span className={styles.listTotal}>KES {todayTotal.toFixed(2)}</span>
          )}
        </div>

        {claims.length === 0 ? (
          <EmptyState
            icon={<Icon name="expenses" size={48} />}
            heading="No staff meals logged yet"
            body="Meals staff eat from stock today, without paying, will show up here."
          />
        ) : (
          <ul className={styles.expenseList}>
            {claims.map((claim) => (
              <li key={claim.id} className={styles.expenseRow}>
                <div>
                  <p className={styles.expenseCategory}>
                    {claim.quantity} × {claim.items?.name ?? "Item"}
                  </p>
                  <p className={styles.expenseNote}>
                    {formatTime(claim.created_at)} · {claim.users?.name ?? "You"}
                    {claim.note ? ` · ${claim.note}` : ""}
                  </p>
                </div>
                <span className={styles.expenseAmount}>KES {claim.value.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {toast && <Toast message={toast.message} status={toast.status} onDismiss={() => setToast(null)} />}
    </div>
  );
}
