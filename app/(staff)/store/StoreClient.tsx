"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatusStrip, type StatusStripState } from "@/components/StatusStrip";
import { SearchBar } from "@/components/SearchBar";
import { Toast } from "@/components/Toast";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/Button";
import { IngredientRow, type IngredientFieldSaveState } from "@/components/IngredientRow";
import { PurchaseModal } from "@/components/PurchaseModal";
import { useTillStripSlot } from "@/app/(staff)/TillStripSlot";
import { nairobiToday } from "@/lib/calculations";
import type { Database } from "@/lib/supabase/types";
import styles from "../entry/entry.module.css";
import storeStyles from "./store.module.css";

type Ingredient = Database["public"]["Tables"]["ingredients"]["Row"];
type IngredientEntryRow = Database["public"]["Tables"]["ingredient_entries"]["Row"];

interface LineState {
  received: number;
  quantityUsed: number;
}

type FieldKey = "quantityUsed";

const AUTOSAVE_DEBOUNCE_MS = 700;

function todayISO(): string {
  return nairobiToday();
}

function emptyLine(): LineState {
  return { received: 0, quantityUsed: 0 };
}

export function StoreClient() {
  const entryDate = useMemo(() => todayISO(), []);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [savedEntries, setSavedEntries] = useState<Record<string, IngredientEntryRow>>({});
  const [openingStock, setOpeningStock] = useState<Record<string, number>>({});
  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [fieldStates, setFieldStates] = useState<Record<string, Record<FieldKey, IngredientFieldSaveState>>>(
    {},
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingSaves, setPendingSaves] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [purchaseTarget, setPurchaseTarget] = useState<Ingredient | null>(null);
  // Opens PurchaseModal straight into its "brand new ingredient" form
  // (forceNew) — distinct from purchaseTarget above, which opens it for
  // a specific existing ingredient's row. Post-launch, 2026-07-21.
  const [addingNew, setAddingNew] = useState(false);

  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/ingredient-entries?date=${entryDate}`);
    const body = await res.json();

    if (!res.ok) {
      setLoadError(body.error ?? "Couldn't load today's ingredients");
      setLoading(false);
      return;
    }

    const fetchedIngredients: Ingredient[] = body.ingredients ?? [];
    const fetchedEntries: IngredientEntryRow[] = body.entries ?? [];
    const entriesById: Record<string, IngredientEntryRow> = {};
    const nextLines: Record<string, LineState> = {};

    for (const ingredient of fetchedIngredients) {
      const entry = fetchedEntries.find((e) => e.ingredient_id === ingredient.id);
      if (entry) entriesById[ingredient.id] = entry;
      nextLines[ingredient.id] = entry
        ? { received: entry.received, quantityUsed: entry.quantity_used }
        : emptyLine();
    }

    setIngredients(fetchedIngredients);
    setSavedEntries(entriesById);
    setOpeningStock(body.opening_stock ?? {});
    setLines(nextLines);
    setLoading(false);
  }, [entryDate]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  // A saved row's own opening_stock is authoritative once it exists;
  // before that, fall back to the carry-forward figure the GET route
  // computed from yesterday's closing_stock (see route's doc comment) —
  // never a bare 0, which would misrepresent real stock on a fresh day.
  function openingStockFor(ingredientId: string): number {
    return savedEntries[ingredientId]?.opening_stock ?? openingStock[ingredientId] ?? 0;
  }

  function setFieldState(ingredientId: string, field: FieldKey, state: IngredientFieldSaveState) {
    setFieldStates((prev) => ({
      ...prev,
      [ingredientId]: { ...(prev[ingredientId] ?? { quantityUsed: "idle" }), [field]: state },
    }));
  }

  const saveLine = useCallback(
    async (ingredientId: string, field: FieldKey, line: LineState) => {
      setFieldState(ingredientId, field, "saving");
      setPendingSaves((n) => n + 1);

      try {
        // received is always resent as whatever the server last reported
        // (savedEntries), never the client's own possibly-stale `line.received`
        // — a purchase logged elsewhere (or by admin) can change it between
        // loads, and this PUT must not clobber that back down.
        const currentReceived = savedEntries[ingredientId]?.received ?? 0;
        const res = await fetch("/api/ingredient-entries", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entry_date: entryDate,
            ingredient_id: ingredientId,
            received: currentReceived,
            quantity_used: line.quantityUsed,
          }),
        });
        const body = await res.json();

        if (!res.ok) {
          setFieldState(ingredientId, field, "error");
          setLastError(body.error ?? "Couldn't save — please try again.");
          return;
        }

        setSavedEntries((prev) => ({ ...prev, [ingredientId]: body.entry }));
        setFieldState(ingredientId, field, "saved");
        setLastError(null);
      } catch {
        setFieldState(ingredientId, field, "error");
        setLastError("Couldn't reach the server — check your connection and try again.");
      } finally {
        setPendingSaves((n) => n - 1);
      }
    },
    [entryDate, savedEntries],
  );

  function updateField(ingredientId: string, field: FieldKey, value: number) {
    const nextLine: LineState = { ...(lines[ingredientId] ?? emptyLine()), [field]: value };
    setLines((prev) => ({ ...prev, [ingredientId]: nextLine }));

    const timerKey = `${ingredientId}:${field}`;
    if (debounceTimers.current[timerKey]) {
      clearTimeout(debounceTimers.current[timerKey]);
    }
    debounceTimers.current[timerKey] = setTimeout(() => {
      saveLine(ingredientId, field, nextLine);
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  useEffect(() => {
    const timers = debounceTimers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const visibleIngredients = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return ingredients;
    return ingredients.filter((ingredient) => ingredient.name.toLowerCase().includes(term));
  }, [ingredients, searchTerm]);

  const totalUsedValue = useMemo(() => {
    return ingredients.reduce((sum, ingredient) => {
      const line = lines[ingredient.id];
      if (!line) return sum;
      return sum + line.quantityUsed * ingredient.buying_price;
    }, 0);
  }, [ingredients, lines]);

  const stripState: StatusStripState = lastError
    ? "error"
    : pendingSaves > 0
      ? "saving"
      : Object.keys(savedEntries).length > 0
        ? "saved"
        : "idle";

  useTillStripSlot(
    !loading && ingredients.length > 0 ? (
      <StatusStrip
        state={stripState}
        totalValueLabel={`KES ${totalUsedValue.toFixed(2)} used today`}
        errorMessage={lastError ?? undefined}
      />
    ) : null,
    `${loading}:${ingredients.length}:${stripState}:${totalUsedValue}`,
  );

  if (loading) {
    return <p className={styles.loading}>Loading today&apos;s ingredients…</p>;
  }

  if (ingredients.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="store" size={48} />}
        heading="No ingredients yet"
        body="Ask an admin to add ingredients before you can log today's receiving/usage."
      />
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Store — Ingredients</h1>
        <div className={storeStyles.headerRight}>
          <p className={styles.dateLabel}>{entryDate}</p>
          <Button variant="secondary" onClick={() => setAddingNew(true)}>
            <Icon name="add" size={16} /> Add new ingredient
          </Button>
        </div>
      </div>

      <SearchBar value={searchTerm} onChange={setSearchTerm} placeholder="Search ingredients…" />

      {visibleIngredients.length === 0 && (
        <p className={styles.noResults}>No ingredients match &ldquo;{searchTerm}&rdquo;.</p>
      )}

      <ul className={storeStyles.rowList}>
        {visibleIngredients.map((ingredient) => {
          const line = lines[ingredient.id] ?? emptyLine();
          const opening = openingStockFor(ingredient.id);
          const states = fieldStates[ingredient.id] ?? { quantityUsed: "idle" };

          return (
            <IngredientRow
              key={ingredient.id}
              name={ingredient.name}
              unit={ingredient.unit}
              openingStock={opening}
              received={line.received}
              onLogPurchase={() => setPurchaseTarget(ingredient)}
              quantityUsed={line.quantityUsed}
              onQuantityUsedChange={(next) => updateField(ingredient.id, "quantityUsed", next)}
              quantityUsedSaveState={states.quantityUsed}
            />
          );
        })}
      </ul>

      <PurchaseModal
        open={purchaseTarget !== null || addingNew}
        onClose={() => {
          setPurchaseTarget(null);
          setAddingNew(false);
        }}
        fixedIngredient={
          purchaseTarget
            ? {
                id: purchaseTarget.id,
                name: purchaseTarget.name,
                unit: purchaseTarget.unit,
                buying_price: purchaseTarget.buying_price,
              }
            : undefined
        }
        forceNew={addingNew}
        onSaved={load}
      />

      {loadError && <Toast message={loadError} status="error" onDismiss={() => setLoadError(null)} />}
    </div>
  );
}
