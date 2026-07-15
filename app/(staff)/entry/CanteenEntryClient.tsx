"use client";

import { useEffect, useMemo, useState } from "react";
import { TillStrip } from "@/components/TillStrip";
import { SearchBar } from "@/components/SearchBar";
import { CategoryChips } from "@/components/CategoryChips";
import { Toast } from "@/components/Toast";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { ItemEntryCard, type ItemEntryField } from "@/components/ItemEntryCard";
import { useTillStripSlot } from "@/app/(staff)/TillStripSlot";
import { nairobiNow, nairobiToday, weekStartMonday } from "@/lib/calculations";
import type { Database } from "@/lib/supabase/types";
import styles from "./entry.module.css";

type Item = Database["public"]["Tables"]["items"]["Row"];
type StockEntryRow = Database["public"]["Tables"]["stock_entries"]["Row"];

interface LineState {
  tillQuantitySold: number;
  addedStock: number;
  wastage: number;
  wastageNote: string;
}

function emptyLine(): LineState {
  return { tillQuantitySold: 0, addedStock: 0, wastage: 0, wastageNote: "" };
}

function todayISO(): string {
  return nairobiToday();
}

function formatWeekLabel(weekStart: string, weekEnd: string): string {
  const start = new Date(`${weekStart}T00:00:00Z`);
  const end = new Date(`${weekEnd}T00:00:00Z`);
  const startLabel = start.toLocaleDateString("en-GB", { month: "short", day: "numeric", timeZone: "UTC" });
  const endLabel = end.toLocaleDateString("en-GB", { month: "short", day: "numeric", timeZone: "UTC" });
  return `Week of ${startLabel}–${endLabel}`;
}

/**
 * Canteen's weekly reconciliation screen — a genuinely different shape
 * from EntryClient (restaurant, daily), not a cadence variant of it: no
 * sent_out field, added_stock is read-only (pulled from
 * canteen_supplied_total()) for canteen_supplied items and a normal
 * editable stepper for canteen_independent items, and the header uses
 * the "Weekly reconciliation" pattern (docs/design/02_PATTERNS_AND_CHECKLIST.md
 * §5: sunken band, date-range label) instead of the daily screen's plain
 * header. See docs/phases/phase4_context.md's "Instructions for the next
 * phase" for why this is a separate component rather than a `cadence`
 * prop on EntryClient.
 */
export function CanteenEntryClient() {
  const requestedDate = useMemo(() => todayISO(), []);
  const [items, setItems] = useState<Item[]>([]);
  const [savedEntries, setSavedEntries] = useState<Record<string, StockEntryRow>>({});
  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [suppliedTotals, setSuppliedTotals] = useState<Record<string, number>>({});
  const [weekStart, setWeekStart] = useState<string>(() => weekStartMonday(nairobiNow()));
  const [weekEnd, setWeekEnd] = useState<string>(weekStart);
  const [searchTerm, setSearchTerm] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "canteen_supplied" | "canteen_independent">("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; status: "success" | "error" } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const res = await fetch(`/api/stock-entries?date=${requestedDate}`);
      const body = await res.json();
      if (cancelled) return;

      if (!res.ok) {
        setToast({ message: body.error ?? "Couldn't load this week's items", status: "error" });
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
              wastage: entry.wastage,
              wastageNote: entry.wastage_note ?? "",
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
      setWeekStart(body.entry_date ?? requestedDate);
      setWeekEnd(body.week_end ?? body.entry_date ?? requestedDate);
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
    return opening + addedStock - line.tillQuantitySold - line.wastage;
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
      entry_date: weekStart,
      lines: items.map((item) => {
        const line = lines[item.id] ?? emptyLine();
        return {
          item_id: item.id,
          till_quantity_sold: line.tillQuantitySold,
          added_stock: line.addedStock,
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
        setToast({ message: body.error ?? "Couldn't save this week's entries", status: "error" });
        return;
      }

      const nextSaved: Record<string, StockEntryRow> = {};
      for (const entry of body.entries as StockEntryRow[]) {
        nextSaved[entry.item_id] = entry;
      }
      setSavedEntries(nextSaved);
      setToast({ message: "This week's entries saved", status: "success" });
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
    return <p className={styles.loading}>Loading this week&apos;s items…</p>;
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="entry" size={48} />}
        heading="No items yet"
        body="Ask an admin to add sellable items before you can log this week's entry."
      />
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.weeklyHeader}>
        <p className={styles.weeklyOverline}>Weekly reconciliation</p>
        <h1 className={styles.title}>Canteen Entry</h1>
        <p className={styles.weekRangeLabel}>{formatWeekLabel(weekStart, weekEnd)}</p>
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

          const fields: ItemEntryField[] = [
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
                  stepper: { value: line.addedStock, onChange: (next) => updateLine(item.id, { addedStock: next }) },
                },
            {
              key: "quantitySold",
              label: "Quantity sold",
              stepper: {
                value: line.tillQuantitySold,
                onChange: (next) => updateLine(item.id, { tillQuantitySold: next }),
                max: opening + addedStock - line.wastage,
                limitMessage: `Only ${remaining} left`,
              },
            },
          ];

          return (
            <ItemEntryCard
              key={item.id}
              name={item.name}
              priceLabel={`KES ${item.selling_price.toFixed(2)}`}
              openingLabel={`Opening: ${opening}`}
              openingTooltip="Last week's leftover stock. You don't type this in."
              fields={fields}
              wastageValue={line.wastage}
              onWastageChange={(next) => updateLine(item.id, { wastage: next })}
              wastageTooltip="Stock spoiled, broken, or lost — not sold."
              wastageMax={opening + addedStock - line.tillQuantitySold}
              wastageNote={line.wastageNote}
              onWastageNoteChange={(next) => updateLine(item.id, { wastageNote: next })}
            />
          );
        })}
      </ul>

      {toast && <Toast message={toast.message} status={toast.status} onDismiss={() => setToast(null)} />}
    </div>
  );
}
