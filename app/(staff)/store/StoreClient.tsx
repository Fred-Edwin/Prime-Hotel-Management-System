"use client";

import { useEffect, useMemo, useState } from "react";
import { Stepper } from "@/components/Stepper";
import { TillStrip } from "@/components/TillStrip";
import { Input } from "@/components/Input";
import { Toast } from "@/components/Toast";
import { EmptyState } from "@/components/EmptyState";
import type { Database } from "@/lib/supabase/types";
import styles from "../entry/entry.module.css";

type Ingredient = Database["public"]["Tables"]["ingredients"]["Row"];
type IngredientEntryRow = Database["public"]["Tables"]["ingredient_entries"]["Row"];

interface LineState {
  received: number;
  quantityUsed: number;
  wastage: number;
  wastageNote: string;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyLine(): LineState {
  return { received: 0, quantityUsed: 0, wastage: 0, wastageNote: "" };
}

export function StoreClient() {
  const entryDate = useMemo(() => todayISO(), []);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [savedEntries, setSavedEntries] = useState<Record<string, IngredientEntryRow>>({});
  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; status: "success" | "error" } | null>(null);
  const [wastageOpenFor, setWastageOpenFor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const res = await fetch(`/api/ingredient-entries?date=${entryDate}`);
      const body = await res.json();
      if (cancelled) return;

      if (!res.ok) {
        setToast({ message: body.error ?? "Couldn't load today's ingredients", status: "error" });
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
          ? {
              received: entry.received,
              quantityUsed: entry.quantity_used,
              wastage: entry.wastage,
              wastageNote: entry.wastage_note ?? "",
            }
          : emptyLine();
      }

      setIngredients(fetchedIngredients);
      setSavedEntries(entriesById);
      setLines(nextLines);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [entryDate]);

  function openingStockFor(ingredientId: string): number {
    return savedEntries[ingredientId]?.opening_stock ?? 0;
  }

  function remainingFor(ingredientId: string): number {
    const line = lines[ingredientId] ?? emptyLine();
    const opening = openingStockFor(ingredientId);
    return opening + line.received - line.quantityUsed - line.wastage;
  }

  function updateLine(ingredientId: string, patch: Partial<LineState>) {
    setLines((prev) => ({ ...prev, [ingredientId]: { ...(prev[ingredientId] ?? emptyLine()), ...patch } }));
  }

  const itemCount = useMemo(
    () => Object.values(lines).reduce((sum, line) => sum + line.received, 0),
    [lines],
  );

  const totalValue = useMemo(() => {
    return ingredients.reduce((sum, ingredient) => {
      const line = lines[ingredient.id];
      if (!line) return sum;
      return sum + line.quantityUsed * ingredient.buying_price;
    }, 0);
  }, [ingredients, lines]);

  async function handleSave() {
    setSaving(true);
    const payload = {
      entry_date: entryDate,
      lines: ingredients.map((ingredient) => {
        const line = lines[ingredient.id] ?? emptyLine();
        return {
          ingredient_id: ingredient.id,
          received: line.received,
          quantity_used: line.quantityUsed,
          wastage: line.wastage,
          wastage_note: line.wastageNote.trim() ? line.wastageNote.trim() : null,
        };
      }),
    };

    const res = await fetch("/api/ingredient-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();

    setSaving(false);

    if (!res.ok) {
      setToast({ message: body.error ?? "Couldn't save today's ingredients", status: "error" });
      return;
    }

    const nextSaved: Record<string, IngredientEntryRow> = {};
    for (const entry of body.entries as IngredientEntryRow[]) {
      nextSaved[entry.ingredient_id] = entry;
    }
    setSavedEntries(nextSaved);
    setToast({ message: "Today's ingredient entries saved", status: "success" });
  }

  if (loading) {
    return <p className={styles.loading}>Loading today&apos;s ingredients…</p>;
  }

  if (ingredients.length === 0) {
    return (
      <EmptyState
        icon={<span aria-hidden>—</span>}
        heading="No ingredients yet"
        body="Ask an admin to add ingredients before you can log today's receiving/usage."
      />
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Store — Ingredients</h1>
        <p className={styles.dateLabel}>{entryDate}</p>
      </div>

      <ul className={styles.itemList}>
        {ingredients.map((ingredient) => {
          const line = lines[ingredient.id] ?? emptyLine();
          const opening = openingStockFor(ingredient.id);
          const remaining = remainingFor(ingredient.id);
          const wastageOpen = wastageOpenFor === ingredient.id || line.wastage > 0;

          return (
            <li key={ingredient.id} className={styles.itemRow}>
              <div className={styles.itemHeader}>
                <div>
                  <p className={styles.itemName}>{ingredient.name}</p>
                  <p className={styles.itemMeta}>
                    {ingredient.unit} · Opening: {opening}
                  </p>
                </div>
              </div>

              <div className={styles.storeManagerFields}>
                <div className={styles.primaryField}>
                  <span className={styles.fieldLabel}>Received</span>
                  <Stepper
                    value={line.received}
                    onChange={(next) => updateLine(ingredient.id, { received: next })}
                    aria-label={`${ingredient.name} received`}
                  />
                </div>
                <div className={styles.primaryField}>
                  <span className={styles.fieldLabel}>Used in cooking</span>
                  <Stepper
                    value={line.quantityUsed}
                    onChange={(next) => updateLine(ingredient.id, { quantityUsed: next })}
                    max={opening + line.received - line.wastage}
                    limitMessage={`Only ${remaining} left`}
                    aria-label={`${ingredient.name} used`}
                  />
                </div>
              </div>

              <button
                type="button"
                className={styles.wastageToggle}
                onClick={() => setWastageOpenFor(wastageOpenFor === ingredient.id ? null : ingredient.id)}
              >
                {wastageOpen ? "Hide wastage" : "Log wastage"}
              </button>

              {wastageOpen && (
                <div className={styles.wastageFields}>
                  <div className={styles.wastageStepper}>
                    <span className={styles.fieldLabel}>Wastage</span>
                    <Stepper
                      value={line.wastage}
                      onChange={(next) => updateLine(ingredient.id, { wastage: next })}
                      max={opening + line.received - line.quantityUsed}
                      limitMessage={`Only ${remaining} left`}
                      aria-label={`${ingredient.name} wastage`}
                    />
                  </div>
                  <Input
                    label="Note (optional)"
                    value={line.wastageNote}
                    onChange={(e) => updateLine(ingredient.id, { wastageNote: e.target.value })}
                    placeholder="e.g. vegetables spoiled"
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <TillStrip
        itemCount={itemCount}
        totalValueLabel={`KES ${totalValue.toFixed(2)} used`}
        onSave={handleSave}
        saving={saving}
      />

      {toast && <Toast message={toast.message} status={toast.status} onDismiss={() => setToast(null)} />}
    </div>
  );
}
