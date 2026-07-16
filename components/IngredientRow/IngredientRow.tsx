"use client";

import { useId } from "react";
import { Card } from "@/components/Card";
import styles from "./IngredientRow.module.css";

export type IngredientFieldSaveState = "idle" | "saving" | "saved" | "error";

export interface IngredientRowProps {
  name: string;
  unit: string;
  openingStock: number;
  received: number;
  onReceivedChange: (next: number) => void;
  receivedSaveState: IngredientFieldSaveState;
  quantityUsed: number;
  onQuantityUsedChange: (next: number) => void;
  quantityUsedSaveState: IngredientFieldSaveState;
}

/**
 * Single-ingredient entry row — replaces ItemEntryCard for /store
 * (Phase 10 redesign). Wrapped in the shared Card component for clear
 * visual separation between ingredients. No InfoTooltip, no wastage UI
 * (moved to admin), no stepper: quantities are typed directly since a
 * delivery amount can be a large or decimal number, and tapping a
 * stepper 40 times for a 40kg sack is a bad interaction. Each field
 * autosaves independently (see StoreClient's debounced save wiring) and
 * shows its own saved/saving/error state rather than one shared
 * page-level Save button.
 */
export function IngredientRow({
  name,
  unit,
  openingStock,
  received,
  onReceivedChange,
  receivedSaveState,
  quantityUsed,
  onQuantityUsedChange,
  quantityUsedSaveState,
}: IngredientRowProps) {
  const receivedId = useId();
  const usedId = useId();

  return (
    <li>
      <Card className={styles.row}>
        <div className={styles.identity}>
          <span className={styles.name}>{name}</span>
          <span className={styles.meta}>{unit}</span>
        </div>
        <span className={styles.opening}>Opening: {openingStock}</span>

        <div className={styles.fields}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor={receivedId}>
              Received
            </label>
            <div className={styles.inputWrap}>
              <input
                id={receivedId}
                className={styles.input}
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={received === 0 ? "" : received}
                placeholder="0"
                onChange={(e) => onReceivedChange(e.target.value === "" ? 0 : Number(e.target.value))}
              />
              <SaveIndicator state={receivedSaveState} />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor={usedId}>
              Used in cooking
            </label>
            <div className={styles.inputWrap}>
              <input
                id={usedId}
                className={styles.input}
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={quantityUsed === 0 ? "" : quantityUsed}
                placeholder="0"
                onChange={(e) =>
                  onQuantityUsedChange(e.target.value === "" ? 0 : Number(e.target.value))
                }
              />
              <SaveIndicator state={quantityUsedSaveState} />
            </div>
          </div>
        </div>
      </Card>
    </li>
  );
}

function SaveIndicator({ state }: { state: IngredientFieldSaveState }) {
  if (state === "idle") return null;

  if (state === "saving") {
    return (
      <span className={styles.indicatorSaving} aria-label="Saving">
        …
      </span>
    );
  }

  if (state === "error") {
    return (
      <span className={styles.indicatorError} role="alert">
        !
      </span>
    );
  }

  return (
    <span className={styles.indicatorSaved} aria-label="Saved">
      ✓
    </span>
  );
}
