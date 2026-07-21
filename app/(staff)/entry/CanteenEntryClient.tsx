"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatusStrip, type StatusStripState } from "@/components/StatusStrip";
import { SearchBar } from "@/components/SearchBar";
import { CategoryChips } from "@/components/CategoryChips";
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

const AUTOSAVE_DEBOUNCE_MS = 700;

type CanteenFieldKey = "quantitySold" | "addedStock";

interface LineState {
  tillQuantitySold: number;
  addedStock: number;
}

function emptyLine(): LineState {
  return { tillQuantitySold: 0, addedStock: 0 };
}

function todayISO(): string {
  return nairobiToday();
}

/**
 * Canteen's daily entry screen — still structurally distinct from
 * EntryClient (restaurant), but only in one respect now: no sent_out
 * field, and added_stock is read-only (pulled from
 * canteen_supplied_total(), a same-day figure) for canteen_supplied
 * items and a typed numeric input for canteen_independent items. As of
 * the daily-cadence conversion (docs/01_DATA_MODEL.md §3.1), the header
 * is the same plain pattern EntryClient uses — no more sunken-band
 * "Weekly reconciliation" treatment.
 *
 * Post-launch redesign (same session as the restaurant store-manager/
 * cashier autosave rework): one person (Anne) owns both quantity_sold
 * (every item) and added_stock (canteen_independent items only) on this
 * single screen — not a role split like the restaurant's — so both
 * fields autosave independently per item via PUT /api/stock-entries'
 * canteen branch (putCanteenField()), replacing the batch Save button.
 * See docs/01_DATA_MODEL.md §3.4's canteen autosave writer.
 */
export function CanteenEntryClient() {
  const requestedDate = useMemo(() => todayISO(), []);
  const [items, setItems] = useState<Item[]>([]);
  const [savedEntries, setSavedEntries] = useState<Record<string, StockEntryRow>>({});
  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [suppliedTotals, setSuppliedTotals] = useState<Record<string, number>>({});
  const [entryDate, setEntryDate] = useState<string>(() => todayISO());
  const [searchTerm, setSearchTerm] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "canteen_supplied" | "canteen_independent">("all");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; status: "success" | "error" } | null>(null);

  // Per-field autosave state: quantitySold (every item) and addedStock
  // (canteen_independent items only) each autosave independently, both
  // through the same PUT /api/stock-entries canteen branch — see
  // app/api/stock-entries/route.ts's putCanteenField().
  const [fieldStates, setFieldStates] = useState<
    Record<string, Partial<Record<CanteenFieldKey, ItemEntryFieldSaveState>>>
  >({});
  const [pendingSaves, setPendingSaves] = useState(0);
  const [lastAutosaveError, setLastAutosaveError] = useState<string | null>(null);
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const res = await fetch(`/api/stock-entries?date=${requestedDate}`);
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
        const suppliedTotal = body.supplied_totals?.[item.id];
        nextLines[item.id] = entry
          ? {
              tillQuantitySold: entry.till_quantity_sold,
              addedStock: entry.added_stock,
            }
          : {
              ...emptyLine(),
              addedStock: item.supply_type === "canteen_supplied" ? (suppliedTotal ?? 0) : 0,
            };
      }

      setItems(fetchedItems);
      setSavedEntries(entriesByItemId);
      setLines(nextLines);
      setSuppliedTotals(body.supplied_totals ?? {});
      setEntryDate(body.entry_date ?? requestedDate);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [requestedDate]);

  const visibleItems = useMemo(() => {
    const bySource = sourceFilter === "all" ? items : items.filter((item) => item.supply_type === sourceFilter);
    const term = searchTerm.trim().toLowerCase();
    if (!term) return bySource;
    return bySource.filter((item) => item.name.toLowerCase().includes(term));
  }, [items, sourceFilter, searchTerm]);

  const hasBothSources = useMemo(
    () =>
      items.some((item) => item.supply_type === "canteen_supplied") &&
      items.some((item) => item.supply_type === "canteen_independent"),
    [items],
  );

  function openingStockFor(itemId: string): number {
    return savedEntries[itemId]?.opening_stock ?? 0;
  }

  function remainingStockFor(item: Item): number {
    const line = lines[item.id] ?? emptyLine();
    const opening = openingStockFor(item.id);
    const addedStock = item.supply_type === "canteen_supplied" ? (suppliedTotals[item.id] ?? 0) : line.addedStock;
    return opening + addedStock - line.tillQuantitySold;
  }

  function setFieldState(itemId: string, field: CanteenFieldKey, state: ItemEntryFieldSaveState) {
    setFieldStates((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], [field]: state },
    }));
  }

  const saveCanteenField = useCallback(
    async (itemId: string, field: CanteenFieldKey, line: LineState) => {
      setFieldState(itemId, field, "saving");
      setPendingSaves((n) => n + 1);

      const payload: Record<string, unknown> = {
        entry_date: entryDate,
        item_id: itemId,
      };
      if (field === "quantitySold") {
        payload.till_quantity_sold = line.tillQuantitySold;
      } else {
        payload.added_stock = line.addedStock;
      }

      try {
        const res = await fetch("/api/stock-entries", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
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

  function updateField(itemId: string, field: CanteenFieldKey, value: number) {
    const patch: Partial<LineState> = field === "quantitySold" ? { tillQuantitySold: value } : { addedStock: value };
    const nextLine: LineState = { ...(lines[itemId] ?? emptyLine()), ...patch };
    setLines((prev) => ({ ...prev, [itemId]: nextLine }));

    const timerKey = `${itemId}:${field}`;
    if (debounceTimers.current[timerKey]) {
      clearTimeout(debounceTimers.current[timerKey]);
    }
    debounceTimers.current[timerKey] = setTimeout(() => {
      saveCanteenField(itemId, field, nextLine);
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
        <h1 className={styles.title}>Canteen Entry</h1>
        <p className={styles.dateLabel}>{entryDate}</p>
      </div>

      <SearchBar value={searchTerm} onChange={setSearchTerm} placeholder="Search items…" />

      {hasBothSources && (
        <div className={styles.chipsRow}>
          <CategoryChips
            options={[
              { value: "all", label: "All" },
              { value: "canteen_supplied", label: "From Restaurant" },
              { value: "canteen_independent", label: "Own Stock" },
            ]}
            value={sourceFilter}
            onChange={(value) => setSourceFilter(value as typeof sourceFilter)}
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
          const isSupplied = item.supply_type === "canteen_supplied";
          const addedStock = isSupplied ? (suppliedTotals[item.id] ?? 0) : line.addedStock;
          const remaining = remainingStockFor(item);
          const states = fieldStates[item.id] ?? {};

          const fields: ItemEntryField[] = [
            {
              key: "quantitySold",
              label: "Quantity sold",
              showLabel: true,
              numericInput: {
                value: line.tillQuantitySold,
                onChange: (next) => updateField(item.id, "quantitySold", next),
                saveState: states.quantitySold ?? "idle",
              },
            },
            isSupplied
              ? {
                  key: "addedStock",
                  label: "Added stock (from restaurant)",
                  readOnlyValue: addedStock,
                  tooltip: "Sent by the restaurant. Added automatically — you don't type this in.",
                }
              : {
                  key: "addedStock",
                  label: "Added stock",
                  numericInput: {
                    value: line.addedStock,
                    onChange: (next) => updateField(item.id, "addedStock", next),
                    saveState: states.addedStock ?? "idle",
                  },
                },
          ];

          return (
            <ItemEntryCard
              key={item.id}
              name={item.name}
              priceLabel={`KES ${item.selling_price.toFixed(2)}`}
              openingLabel={`Opening: ${opening}`}
              openingTooltip="Yesterday's leftover stock. You don't type this in."
              availableLabel={`Available: ${remaining}`}
              fields={fields}
            />
          );
        })}
      </ul>

      {toast && <Toast message={toast.message} status={toast.status} onDismiss={() => setToast(null)} />}
    </div>
  );
}
