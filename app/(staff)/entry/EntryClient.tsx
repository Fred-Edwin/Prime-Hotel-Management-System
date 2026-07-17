"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
type CashierFieldKey = "quantitySold";
type AutosaveFieldKey = StoreManagerFieldKey | CashierFieldKey;

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
  const [toast, setToast] = useState<{ message: string; status: "success" | "error" } | null>(null);

  // Per-field autosave state, shared by both roles: store manager owns
  // addedStock/sentOut (PUT, store-manager branch), cashier owns
  // quantitySold (PUT, cashier branch) — see app/api/stock-entries/route.ts's
  // putStoreManagerField()/putCashierField() split.
  const [fieldStates, setFieldStates] = useState<
    Record<string, Partial<Record<AutosaveFieldKey, ItemEntryFieldSaveState>>>
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

  function setFieldState(itemId: string, field: AutosaveFieldKey, state: ItemEntryFieldSaveState) {
    setFieldStates((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], [field]: state },
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

  const saveCashierField = useCallback(
    async (itemId: string, line: LineState) => {
      setFieldState(itemId, "quantitySold", "saving");
      setPendingSaves((n) => n + 1);

      try {
        const res = await fetch("/api/stock-entries", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entry_date: entryDate,
            item_id: itemId,
            till_quantity_sold: line.tillQuantitySold,
          }),
        });
        const body = await res.json();

        if (!res.ok) {
          setFieldState(itemId, "quantitySold", "error");
          setLastAutosaveError(body.error ?? "Couldn't save — please try again.");
          return;
        }

        setSavedEntries((prev) => ({ ...prev, [itemId]: body.entry }));
        setFieldState(itemId, "quantitySold", "saved");
        setLastAutosaveError(null);
      } catch {
        setFieldState(itemId, "quantitySold", "error");
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

  function updateCashierField(itemId: string, value: number) {
    const nextLine: LineState = { ...(lines[itemId] ?? emptyLine()), tillQuantitySold: value };
    setLines((prev) => ({ ...prev, [itemId]: nextLine }));

    const timerKey = `${itemId}:quantitySold`;
    if (debounceTimers.current[timerKey]) {
      clearTimeout(debounceTimers.current[timerKey]);
    }
    debounceTimers.current[timerKey] = setTimeout(() => {
      saveCashierField(itemId, nextLine);
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  useEffect(() => {
    const timers = debounceTimers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const totalValue = useMemo(() => {
    return items.reduce((sum, item) => {
      const line = lines[item.id];
      if (!line) return sum;
      return sum + line.tillQuantitySold * item.selling_price;
    }, 0);
  }, [items, lines]);

  const autosaveStripState: StatusStripState = lastAutosaveError
    ? "error"
    : pendingSaves > 0
      ? "saving"
      : Object.keys(savedEntries).length > 0
        ? "saved"
        : "idle";

  useTillStripSlot(
    loading || items.length === 0 ? null : (
      <StatusStrip
        state={autosaveStripState}
        totalValueLabel={`KES ${totalValue.toFixed(2)} sold today`}
        errorMessage={lastAutosaveError ?? undefined}
      />
    ),
    `${loading}:${items.length}:${autosaveStripState}:${totalValue}`,
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
          const states = fieldStates[item.id] ?? {};

          const fields: ItemEntryField[] = isStoreManager
            ? [
                {
                  key: "addedStock",
                  label: "Added stock",
                  showLabel: true,
                  numericInput: {
                    value: line.addedStock,
                    onChange: (next) => updateStoreManagerField(item.id, "addedStock", next),
                    saveState: states.addedStock ?? "idle",
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
                    saveState: states.sentOut ?? "idle",
                  },
                },
              ]
            : [
                {
                  key: "quantitySold",
                  label: "Quantity sold",
                  showLabel: true,
                  numericInput: {
                    value: line.tillQuantitySold,
                    onChange: (next) => updateCashierField(item.id, next),
                    saveState: states.quantitySold ?? "idle",
                  },
                },
              ];

          return (
            <ItemEntryCard
              key={item.id}
              name={item.name}
              priceLabel={`KES ${item.selling_price.toFixed(2)}`}
              openingLabel={isStoreManager ? `Opening: ${opening}` : undefined}
              availableLabel={`Available: ${remaining}`}
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
