"use client";

import { useEffect, useMemo, useState } from "react";
import { Stepper } from "@/components/Stepper";
import { TillStrip } from "@/components/TillStrip";
import { CategoryChips } from "@/components/CategoryChips";
import { LowStockIndicator } from "@/components/LowStockIndicator";
import { Input } from "@/components/Input";
import { SearchBar } from "@/components/SearchBar";
import { Toast } from "@/components/Toast";
import { EmptyState } from "@/components/EmptyState";
import { useTillStripSlot } from "@/app/(staff)/TillStripSlot";
import type { Database } from "@/lib/supabase/types";
import styles from "./entry.module.css";

type Item = Database["public"]["Tables"]["items"]["Row"];
type StockEntryRow = Database["public"]["Tables"]["stock_entries"]["Row"];
type ItemCategory = Database["public"]["Enums"]["item_category"];

const CATEGORY_LABELS: Record<ItemCategory, string> = {
  beverages: "Beverages",
  snacks: "Snacks",
  meals: "Meals",
  fruits: "Fruits",
  cyber: "Cyber",
  retail: "Retail",
  ingredients: "Ingredients",
};

const LOW_STOCK_THRESHOLD = 5;

interface LineState {
  tillQuantitySold: number;
  addedStock: number;
  sentOut: number;
  wastage: number;
  wastageNote: string;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyLine(): LineState {
  return { tillQuantitySold: 0, addedStock: 0, sentOut: 0, wastage: 0, wastageNote: "" };
}

export function EntryClient({ isStoreManager }: { isStoreManager: boolean }) {
  const entryDate = useMemo(() => todayISO(), []);
  const [items, setItems] = useState<Item[]>([]);
  const [savedEntries, setSavedEntries] = useState<Record<string, StockEntryRow>>({});
  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; status: "success" | "error" } | null>(null);
  const [wastageOpenFor, setWastageOpenFor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const res = await fetch(`/api/stock-entries?date=${entryDate}`);
      const body = await res.json();
      if (cancelled) return;

      if (!res.ok) {
        setToast({ message: body.error ?? "Couldn't load today's items", status: "error" });
        setLoading(false);
        return;
      }

      const fetchedItems: Item[] = body.items ?? [];
      const fetchedEntries: StockEntryRow[] = body.entries ?? [];
      const entriesByItemId: Record<string, StockEntryRow> = {};
      const nextLines: Record<string, LineState> = {};

      for (const item of fetchedItems) {
        const entry = fetchedEntries.find((e) => e.item_id === item.id);
        if (entry) entriesByItemId[item.id] = entry;
        nextLines[item.id] = entry
          ? {
              tillQuantitySold: entry.till_quantity_sold,
              addedStock: entry.added_stock,
              sentOut: entry.sent_out,
              wastage: entry.wastage,
              wastageNote: entry.wastage_note ?? "",
            }
          : emptyLine();
      }

      setItems(fetchedItems);
      setSavedEntries(entriesByItemId);
      setLines(nextLines);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [entryDate]);

  const categories = useMemo(() => {
    const present = new Set(items.map((item) => item.category));
    return Array.from(present).map((c) => ({ value: c, label: CATEGORY_LABELS[c] }));
  }, [items]);

  const visibleItems = useMemo(() => {
    const byCategory =
      activeCategory === "all" ? items : items.filter((item) => item.category === activeCategory);
    const term = searchTerm.trim().toLowerCase();
    if (!term) return byCategory;
    return byCategory.filter((item) => item.name.toLowerCase().includes(term));
  }, [items, activeCategory, searchTerm]);

  function openingStockFor(itemId: string): number {
    return savedEntries[itemId]?.opening_stock ?? 0;
  }

  function remainingStockFor(itemId: string): number {
    const line = lines[itemId] ?? emptyLine();
    const opening = openingStockFor(itemId);
    const total = opening + line.addedStock;
    // How much more (sold + sent + wasted) can still be taken from total_stock.
    return total - line.tillQuantitySold - line.sentOut - line.wastage;
  }

  function updateLine(itemId: string, patch: Partial<LineState>) {
    setLines((prev) => ({ ...prev, [itemId]: { ...(prev[itemId] ?? emptyLine()), ...patch } }));
  }

  const itemCount = useMemo(
    () => Object.values(lines).reduce((sum, line) => sum + line.tillQuantitySold, 0),
    [lines],
  );

  const totalValue = useMemo(() => {
    return items.reduce((sum, item) => {
      const line = lines[item.id];
      if (!line) return sum;
      return sum + line.tillQuantitySold * item.selling_price;
    }, 0);
  }, [items, lines]);

  async function handleSave() {
    setSaving(true);
    const payload = {
      entry_date: entryDate,
      lines: items.map((item) => {
        const line = lines[item.id] ?? emptyLine();
        return {
          item_id: item.id,
          till_quantity_sold: line.tillQuantitySold,
          added_stock: line.addedStock,
          sent_out: line.sentOut,
          wastage: line.wastage,
          wastage_note: line.wastageNote.trim() ? line.wastageNote.trim() : null,
        };
      }),
    };

    const res = await fetch("/api/stock-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();

    setSaving(false);

    if (!res.ok) {
      setToast({ message: body.error ?? "Couldn't save today's entries", status: "error" });
      return;
    }

    const nextSaved: Record<string, StockEntryRow> = {};
    for (const entry of body.entries as StockEntryRow[]) {
      nextSaved[entry.item_id] = entry;
    }
    setSavedEntries(nextSaved);
    setToast({ message: "Today's entries saved", status: "success" });
  }

  useTillStripSlot(
    !loading && items.length > 0 ? (
      <TillStrip
        itemCount={itemCount}
        totalValueLabel={`KES ${totalValue.toFixed(2)}`}
        onSave={handleSave}
        saving={saving}
      />
    ) : null,
    `${loading}:${items.length}:${itemCount}:${totalValue}:${saving}`,
  );

  if (loading) {
    return <p className={styles.loading}>Loading today&apos;s items…</p>;
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<span aria-hidden>—</span>}
        heading="No items yet"
        body="Ask an admin to add sellable items before you can log today's entry."
      />
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Today&apos;s Entry</h1>
        <p className={styles.dateLabel}>{entryDate}</p>
      </div>

      <SearchBar value={searchTerm} onChange={setSearchTerm} placeholder="Search items…" />

      {categories.length > 1 && (
        <div className={styles.chipsRow}>
          <CategoryChips
            options={[{ value: "all", label: "All" }, ...categories]}
            value={activeCategory}
            onChange={setActiveCategory}
          />
        </div>
      )}

      {visibleItems.length === 0 && (
        <p className={styles.noResults}>No items match &ldquo;{searchTerm}&rdquo;.</p>
      )}

      <ul className={styles.itemList}>
        {visibleItems.map((item) => {
          const line = lines[item.id] ?? emptyLine();
          const opening = openingStockFor(item.id);
          const remaining = remainingStockFor(item.id);
          const isLow = remaining <= LOW_STOCK_THRESHOLD;
          const wastageOpen = wastageOpenFor === item.id || line.wastage > 0;

          return (
            <li key={item.id} className={styles.itemRow}>
              <div className={styles.itemHeader}>
                <div>
                  <p className={styles.itemName}>{item.name}</p>
                  <p className={styles.itemMeta}>
                    KES {item.selling_price.toFixed(2)} · Opening: {opening}
                    {!isStoreManager && ` · Available: ${remaining}`}
                    {isLow && <LowStockIndicator variant="dot" />}
                  </p>
                </div>
              </div>

              {isStoreManager ? (
                <div className={styles.storeManagerFields}>
                  <div className={styles.primaryField}>
                    <span className={styles.fieldLabel}>Added stock</span>
                    <Stepper
                      value={line.addedStock}
                      onChange={(next) => updateLine(item.id, { addedStock: next })}
                      aria-label={`${item.name} added stock`}
                    />
                  </div>
                  <div className={styles.primaryField}>
                    <span className={styles.fieldLabel}>Sent to canteen</span>
                    <Stepper
                      value={line.sentOut}
                      onChange={(next) => updateLine(item.id, { sentOut: next })}
                      max={opening + line.addedStock - line.tillQuantitySold - line.wastage}
                      limitMessage={`Only ${remaining} left`}
                      aria-label={`${item.name} sent to canteen`}
                    />
                  </div>
                  <div className={styles.secondaryField}>
                    <span className={styles.fieldLabel}>Quantity sold</span>
                    <Stepper
                      value={line.tillQuantitySold}
                      onChange={(next) => updateLine(item.id, { tillQuantitySold: next })}
                      max={opening + line.addedStock - line.sentOut - line.wastage}
                      limitMessage={`Only ${remaining} left`}
                      aria-label={`${item.name} quantity sold`}
                    />
                  </div>
                </div>
              ) : (
                <div className={styles.stepperRow}>
                  <Stepper
                    value={line.tillQuantitySold}
                    onChange={(next) => updateLine(item.id, { tillQuantitySold: next })}
                    max={opening + line.addedStock - line.sentOut - line.wastage}
                    limitMessage={`Only ${remaining} left`}
                    aria-label={`${item.name} quantity sold`}
                  />
                </div>
              )}

              <button
                type="button"
                className={styles.wastageToggle}
                onClick={() => setWastageOpenFor(wastageOpenFor === item.id ? null : item.id)}
              >
                {wastageOpen ? "Hide wastage" : "Log wastage"}
              </button>

              {wastageOpen && (
                <div className={styles.wastageFields}>
                  <div className={styles.wastageStepper}>
                    <span className={styles.fieldLabel}>Wastage</span>
                    <Stepper
                      value={line.wastage}
                      onChange={(next) => updateLine(item.id, { wastage: next })}
                      aria-label={`${item.name} wastage`}
                    />
                  </div>
                  <Input
                    label="Note (optional)"
                    value={line.wastageNote}
                    onChange={(e) => updateLine(item.id, { wastageNote: e.target.value })}
                    placeholder="e.g. left out overnight"
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {toast && <Toast message={toast.message} status={toast.status} onDismiss={() => setToast(null)} />}
    </div>
  );
}
