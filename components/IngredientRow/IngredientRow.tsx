"use client";

import { useId } from "react";
import { Card } from "@/components/Card";
import { Icon } from "@/components/Icon";
import styles from "./IngredientRow.module.css";

export type IngredientFieldSaveState = "idle" | "saving" | "saved" | "error";

export interface IngredientRowProps {
  name: string;
  unit: string;
  openingStock: number;
  /** Sum of today's logged purchases for this ingredient — read-only, see "Log purchase" below. */
  received: number;
  onLogPurchase: () => void;
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
 * stepper 40 times for a 40kg sack is a bad interaction.
 *
 * "Received" is no longer a typed autosave field (post-launch purchases
 * redesign, docs/01_DATA_MODEL.md §3.2) — a purchase now needs a unit
 * cost alongside the quantity, captured via the shared PurchaseModal.
 * This row shows the read-only sum of today's logged purchases and a
 * "Log purchase" button that opens that modal; "Used in cooking" is
 * unaffected and keeps its own per-field autosave.
 */
export function IngredientRow({
  name,
  unit,
  openingStock,
  received,
  onLogPurchase,
  quantityUsed,
  onQuantityUsedChange,
  quantityUsedSaveState,
}: IngredientRowProps) {
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
            <span className={styles.fieldLabel}>Received today</span>
            <div className={styles.inputWrap}>
              <span className={styles.receivedValue}>
                {received} {unit}
              </span>
            </div>
            <button type="button" className={styles.logPurchaseButton} onClick={onLogPurchase}>
              <Icon name="add" size={14} />
              Log purchase
            </button>
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
