"use client";

import { useEffect, useMemo, useState } from "react";
import { TillStrip } from "@/components/TillStrip";
import { CategoryChips } from "@/components/CategoryChips";
import { SearchBar } from "@/components/SearchBar";
import { Toast } from "@/components/Toast";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { ItemEntryCard, type ItemEntryField } from "@/components/ItemEntryCard";
import { useTillStripSlot } from "@/app/(staff)/TillStripSlot";
import { nairobiToday } from "@/lib/calculations";
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
  stationery: "Stationery",
  dawa: "Dawa",
  sweets: "Sweets",
  biscuits: "Biscuits",
  packing_supplies: "Packing Supplies",
  others: "Others",
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
  return nairobiToday();
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

    try {
      const res = await fetch("/api/stock-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();

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
    } catch {
      setToast({ message: "Couldn't reach the server — check your connection and try again.", status: "error" });
    } finally {
      setSaving(false);
    }
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
        icon={<Icon name="entry" size={48} />}
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
          const isLow = !isStoreManager && remaining <= LOW_STOCK_THRESHOLD;

          const fields: ItemEntryField[] = isStoreManager
            ? [
                {
                  key: "addedStock",
                  label: "Added stock",
                  tooltip: "Stock added today",
                  stepper: { value: line.addedStock, onChange: (next) => updateLine(item.id, { addedStock: next }) },
                },
                {
                  key: "sentOut",
                  label: "Sent to canteen",
                  tooltip: "Stock sent to the canteen today. The canteen sees it automatically.",
                  stepper: {
                    value: line.sentOut,
                    onChange: (next) => updateLine(item.id, { sentOut: next }),
                    max: opening + line.addedStock - line.tillQuantitySold - line.wastage,
                    limitMessage: `Only ${remaining} left`,
                  },
                },
              ]
            : [
                {
                  key: "quantitySold",
                  label: "quantity sold",
                  stepper: {
                    value: line.tillQuantitySold,
                    onChange: (next) => updateLine(item.id, { tillQuantitySold: next }),
                    max: opening + line.addedStock - line.sentOut - line.wastage,
                    limitMessage: `Only ${remaining} left`,
                  },
                },
              ];

          return (
            <ItemEntryCard
              key={item.id}
              name={item.name}
              priceLabel={`KES ${item.selling_price.toFixed(2)}`}
              openingLabel={isStoreManager ? `Opening: ${opening}` : undefined}
              openingTooltip={isStoreManager ? "Yesterday's leftover stock. You don't type this in." : undefined}
              availableLabel={isStoreManager ? undefined : `Available: ${remaining}`}
              isLow={isLow}
              fields={fields}
              wastageValue={line.wastage}
              onWastageChange={(next) => updateLine(item.id, { wastage: next })}
              wastageMax={opening + line.addedStock - line.tillQuantitySold - line.sentOut}
              wastageNote={line.wastageNote}
              onWastageNoteChange={(next) => updateLine(item.id, { wastageNote: next })}
              wastageTooltip="Stock spoiled, broken, or lost — not sold."
            />
          );
        })}
      </ul>

      {toast && <Toast message={toast.message} status={toast.status} onDismiss={() => setToast(null)} />}
    </div>
  );
}
