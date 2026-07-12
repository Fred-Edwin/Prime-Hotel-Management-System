"use client";

import { useId, useState } from "react";
import { Stepper, type StepperProps } from "@/components/Stepper";
import { Input } from "@/components/Input";
import { Icon } from "@/components/Icon";
import { LowStockIndicator } from "@/components/LowStockIndicator";
import styles from "./ItemEntryCard.module.css";

export interface ItemEntryField {
  key: string;
  label: string;
  /** Present for an editable field. Omit and set `readOnlyValue` for a read-only figure (e.g. canteen's supplied-total row). */
  stepper?: Omit<StepperProps, "aria-label">;
  readOnlyValue?: number;
}

export interface ItemEntryCardProps {
  name: string;
  priceLabel: string;
  openingLabel?: string;
  availableLabel?: string;
  isLow?: boolean;
  fields: ItemEntryField[];
  wastageValue: number;
  onWastageChange: (next: number) => void;
  wastageMax?: number;
  wastageNote: string;
  onWastageNoteChange: (next: string) => void;
}

export function ItemEntryCard({
  name,
  priceLabel,
  openingLabel,
  availableLabel,
  isLow = false,
  fields,
  wastageValue,
  onWastageChange,
  wastageMax,
  wastageNote,
  onWastageNoteChange,
}: ItemEntryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const wastageOpen = expanded || wastageValue > 0;
  const notePanelId = useId();

  const primaryField = fields[0];
  const secondaryFields = fields.slice(1);

  return (
    <li className={styles.card}>
      <div className={styles.primaryRow}>
        <div className={styles.identity}>
          <p className={styles.name}>
            {isLow && <LowStockIndicator variant="dot" />}
            {name}
          </p>
          <p className={styles.meta}>
            {priceLabel}
            {openingLabel && <> · {openingLabel}</>}
            {availableLabel && <> · {availableLabel}</>}
          </p>
        </div>

        {primaryField && (
          <div className={styles.primaryControl}>
            {primaryField.readOnlyValue !== undefined ? (
              <span className={styles.readOnlyValue} aria-label={`${name} ${primaryField.label}, read only`}>
                {primaryField.readOnlyValue}
              </span>
            ) : (
              primaryField.stepper && (
                <Stepper {...primaryField.stepper} aria-label={`${name} ${primaryField.label}`} />
              )
            )}
          </div>
        )}
      </div>

      {secondaryFields.length > 0 && (
        <div className={styles.secondaryFields}>
          {secondaryFields.map((field) => (
            <div key={field.key} className={styles.secondaryField}>
              <span className={styles.fieldLabel}>{field.label}</span>
              {field.readOnlyValue !== undefined ? (
                <span className={styles.readOnlyValue} aria-label={`${name} ${field.label}, read only`}>
                  {field.readOnlyValue}
                </span>
              ) : (
                field.stepper && <Stepper {...field.stepper} aria-label={`${name} ${field.label}`} />
              )}
            </div>
          ))}
        </div>
      )}

      <div className={styles.footer}>
        <button
          type="button"
          className={[styles.wastageButton, wastageOpen ? styles.wastageButtonActive : ""].join(" ")}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={wastageOpen}
          aria-controls={notePanelId}
        >
          <Icon name="wastage" size={16} />
          {wastageValue > 0 ? `Wastage: ${wastageValue}` : "Log wastage"}
        </button>
      </div>

      {wastageOpen && (
        <div className={styles.wastagePanel} id={notePanelId}>
          <div className={styles.secondaryField}>
            <span className={styles.fieldLabel}>Wastage</span>
            <Stepper
              value={wastageValue}
              onChange={onWastageChange}
              max={wastageMax}
              limitMessage="Limit reached"
              aria-label={`${name} wastage`}
            />
          </div>
          <Input
            label="Note (optional)"
            value={wastageNote}
            onChange={(e) => onWastageNoteChange(e.target.value)}
            placeholder="e.g. left out overnight"
          />
        </div>
      )}
    </li>
  );
}
