"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TillStrip } from "@/components/TillStrip";
import { StatusStrip, type StatusStripState } from "@/components/StatusStrip";
import { CategoryChips } from "@/components/CategoryChips";
import { SearchBar } from "@/components/SearchBar";
import { Toast } from "@/components/Toast";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { ItemEntryCard, type ItemEntryField, type ItemEntryFieldSaveState } from "@/components/ItemEntryCard";
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
const AUTOSAVE_DEBOUNCE_MS = 700;

type StoreManagerFieldKey = "addedStock" | "sentOut";

interface LineState {
  tillQuantitySold: number;
  addedStock: number;
  sentOut: number;
}

function todayISO(): string {
  return nairobiToday();
}

function emptyLine(): LineState {
  return { tillQuantitySold: 0, addedStock: 0, sentOut: 0 };
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

  // Store-manager-only autosave state (addedStock/sentOut) — regular
  // staff's quantitySold field keeps the batch TillStrip Save flow below
  // untouched, so none of this applies to them.
  const [fieldStates, setFieldStates] = useState<
    Record<string, Record<StoreManagerFieldKey, ItemEntryFieldSaveState>>
  >({});
  const [pendingSaves, setPendingSaves] = useState(0);
  const [lastAutosaveError, setLastAutosaveError] = useState<string | null>(null);
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

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
    // How much more (sold + sent) can still be taken from total_stock.
    return total - line.tillQuantitySold - line.sentOut;
  }

  function updateLine(itemId: string, patch: Partial<LineState>) {
    setLines((prev) => ({ ...prev, [itemId]: { ...(prev[itemId] ?? emptyLine()), ...patch } }));
  }

  function setFieldState(itemId: string, field: StoreManagerFieldKey, state: ItemEntryFieldSaveState) {
    setFieldStates((prev) => ({
      ...prev,
      [itemId]: { ...(prev[itemId] ?? { addedStock: "idle", sentOut: "idle" }), [field]: state },
    }));
  }

  const saveStoreManagerField = useCallback(
    async (itemId: string, field: StoreManagerFieldKey, line: LineState) => {
      setFieldState(itemId, field, "saving");
      setPendingSaves((n) => n + 1);

      try {
        const res = await fetch("/api/stock-entries", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entry_date: entryDate,
            item_id: itemId,
            added_stock: line.addedStock,
            sent_out: line.sentOut,
          }),
        });
        const body = await res.json();

        if (!res.ok) {
          setFieldState(itemId, field, "error");
          setLastAutosaveError(body.error ?? "Couldn't save — please try again.");
          return;
        }

        setSavedEntries((prev) => ({ ...prev, [itemId]: body.entry }));
        setFieldState(itemId, field, "saved");
        setLastAutosaveError(null);
      } catch {
        setFieldState(itemId, field, "error");
        setLastAutosaveError("Couldn't reach the server — check your connection and try again.");
      } finally {
        setPendingSaves((n) => n - 1);
      }
    },
    [entryDate],
  );

  function updateStoreManagerField(itemId: string, field: StoreManagerFieldKey, value: number) {
    const nextLine: LineState = { ...(lines[itemId] ?? emptyLine()), [field]: value };
    setLines((prev) => ({ ...prev, [itemId]: nextLine }));

    const timerKey = `${itemId}:${field}`;
    if (debounceTimers.current[timerKey]) {
      clearTimeout(debounceTimers.current[timerKey]);
    }
    debounceTimers.current[timerKey] = setTimeout(() => {
      saveStoreManagerField(itemId, field, nextLine);
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  useEffect(() => {
    const timers = debounceTimers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

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

  const autosaveStripState: StatusStripState = lastAutosaveError
    ? "error"
    : pendingSaves > 0
      ? "saving"
      : Object.keys(savedEntries).length > 0
        ? "saved"
        : "idle";

  useTillStripSlot(
    loading || items.length === 0
      ? null
      : isStoreManager ? (
          <StatusStrip
            state={autosaveStripState}
            totalValueLabel={`KES ${totalValue.toFixed(2)} sold today`}
            errorMessage={lastAutosaveError ?? undefined}
          />
        ) : (
          <TillStrip
            itemCount={itemCount}
            totalValueLabel={`KES ${totalValue.toFixed(2)}`}
            onSave={handleSave}
            saving={saving}
          />
        ),
    isStoreManager
      ? `${loading}:${items.length}:${autosaveStripState}:${totalValue}`
      : `${loading}:${items.length}:${itemCount}:${totalValue}:${saving}`,
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
          const isLow = remaining <= LOW_STOCK_THRESHOLD;
          const states = fieldStates[item.id] ?? { addedStock: "idle", sentOut: "idle" };

          const fields: ItemEntryField[] = isStoreManager
            ? [
                {
                  key: "addedStock",
                  label: "Added stock",
                  showLabel: true,
                  numericInput: {
                    value: line.addedStock,
                    onChange: (next) => updateStoreManagerField(item.id, "addedStock", next),
                    saveState: states.addedStock,
                  },
                },
                {
                  key: "sentOut",
                  label: "Sent to canteen",
                  numericInput: {
                    value: line.sentOut,
                    onChange: (next) => updateStoreManagerField(item.id, "sentOut", next),
                    max: opening + line.addedStock - line.tillQuantitySold,
                    limitMessage: `Only ${remaining} left`,
                    saveState: states.sentOut,
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
                    max: opening + line.addedStock - line.sentOut,
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
              availableLabel={isStoreManager ? undefined : `Available: ${remaining}`}
              isLow={isLow}
              fields={fields}
            />
          );
        })}
      </ul>

      {toast && <Toast message={toast.message} status={toast.status} onDismiss={() => setToast(null)} />}
    </div>
  );
}
