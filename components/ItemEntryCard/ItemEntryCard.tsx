"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { Stepper, type StepperProps } from "@/components/Stepper";
import { Input } from "@/components/Input";
import { Icon } from "@/components/Icon";
import { LowStockIndicator } from "@/components/LowStockIndicator";
import { InfoTooltip } from "@/components/InfoTooltip";
import styles from "./ItemEntryCard.module.css";

export type ItemEntryFieldSaveState = "idle" | "saving" | "saved" | "error";

export interface ItemEntryNumericInputProps {
  value: number;
  onChange: (next: number) => void;
  max?: number;
  limitMessage?: string;
  saveState?: ItemEntryFieldSaveState;
}

export interface ItemEntryField {
  key: string;
  label: string;
  /** Present for an editable field. Omit and set `readOnlyValue` for a read-only figure (e.g. canteen's supplied-total row). */
  stepper?: Omit<StepperProps, "aria-label">;
  /** Typed numeric text input instead of a stepper — for quantities too large/decimal-prone for tap-to-increment (store-manager fields on /entry). */
  numericInput?: ItemEntryNumericInputProps;
  readOnlyValue?: number;
  /** Short plain-language explanation shown via a "?" affordance next to the label, for fields whose purpose isn't obvious from the label alone. */
  tooltip?: string;
  /** Show this field's label above the primary control. Only meaningful for the first field in `fields` — secondary fields always show their label. Off by default: a lone unlabeled stepper (e.g. regular staff's single "quantity sold" field) reads fine from context (price/opening/available already on the row) without one. */
  showLabel?: boolean;
}

export interface ItemEntryWastageProps {
  value: number;
  onChange: (next: number) => void;
  max?: number;
  note: string;
  onNoteChange: (next: string) => void;
  tooltip?: string;
}

export interface ItemEntryCardProps {
  name: string;
  priceLabel: string;
  openingLabel?: string;
  openingTooltip?: string;
  availableLabel?: string;
  isLow?: boolean;
  fields: ItemEntryField[];
  /** Omit entirely to render no wastage affordance on this card (see docs/01_DATA_MODEL.md §3.3's Phase 10 correction for /entry). */
  wastage?: ItemEntryWastageProps;
}

export function ItemEntryCard({
  name,
  priceLabel,
  openingLabel,
  openingTooltip,
  availableLabel,
  isLow = false,
  fields,
  wastage,
}: ItemEntryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const wastageOpen = expanded || (wastage?.value ?? 0) > 0;
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
          <div className={styles.metaRow}>
            <p className={styles.meta}>
              {priceLabel}
              {openingLabel && <> · {openingLabel}</>}
              {availableLabel && <> · {availableLabel}</>}
            </p>
            {openingTooltip && <InfoTooltip label="Opening stock" message={openingTooltip} />}
          </div>
        </div>

        {primaryField && (
          <div className={styles.primaryControl}>
            {primaryField.showLabel && (
              <span className={styles.primaryFieldLabel}>
                {primaryField.label}
                {primaryField.tooltip && <InfoTooltip label={primaryField.label} message={primaryField.tooltip} />}
              </span>
            )}
            {primaryField.readOnlyValue !== undefined ? (
              <span className={styles.readOnlyValue} aria-label={`${name} ${primaryField.label}, read only`}>
                {primaryField.readOnlyValue}
              </span>
            ) : primaryField.numericInput ? (
              <NumericInput {...primaryField.numericInput} ariaLabel={`${name} ${primaryField.label}`} />
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
              <span className={styles.fieldLabel}>
                {field.label}
                {field.tooltip && <InfoTooltip label={field.label} message={field.tooltip} />}
              </span>
              {field.readOnlyValue !== undefined ? (
                <span className={styles.readOnlyValue} aria-label={`${name} ${field.label}, read only`}>
                  {field.readOnlyValue}
                </span>
              ) : field.numericInput ? (
                <NumericInput {...field.numericInput} ariaLabel={`${name} ${field.label}`} />
              ) : (
                field.stepper && <Stepper {...field.stepper} aria-label={`${name} ${field.label}`} />
              )}
            </div>
          ))}
        </div>
      )}

      {wastage && (
        <>
          <div className={styles.footer}>
            <button
              type="button"
              className={[styles.wastageButton, wastageOpen ? styles.wastageButtonActive : ""].join(" ")}
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={wastageOpen}
              aria-controls={notePanelId}
            >
              <Icon name="wastage" size={16} />
              {wastage.value > 0 ? `Wastage: ${wastage.value}` : "Log wastage"}
            </button>
          </div>

          {wastageOpen && (
            <div className={styles.wastagePanel} id={notePanelId}>
              <div className={styles.secondaryField}>
                <span className={styles.fieldLabel}>
                  Wastage
                  {wastage.tooltip && <InfoTooltip label="Wastage" message={wastage.tooltip} />}
                </span>
                <Stepper
                  value={wastage.value}
                  onChange={wastage.onChange}
                  max={wastage.max}
                  limitMessage="Limit reached"
                  aria-label={`${name} wastage`}
                />
              </div>
              <Input
                label="Note (optional)"
                value={wastage.note}
                onChange={(e) => wastage.onNoteChange(e.target.value)}
                placeholder="e.g. left out overnight"
              />
            </div>
          )}
        </>
      )}
    </li>
  );
}

function NumericInput({
  value,
  onChange,
  max,
  limitMessage = "Limit reached",
  saveState = "idle",
  ariaLabel,
}: ItemEntryNumericInputProps & { ariaLabel: string }) {
  const [showLimitMessage, setShowLimitMessage] = useState(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, []);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const next = raw === "" ? 0 : Number(raw);
    if (Number.isNaN(next)) return;

    if (max !== undefined && next > max) {
      setShowLimitMessage(true);
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      dismissTimer.current = setTimeout(() => setShowLimitMessage(false), 2500);
      onChange(max);
      return;
    }

    onChange(next);
  }

  return (
    <div className={styles.numericInputWrap}>
      <div className={styles.numericInputRow}>
        <input
          className={styles.numericInput}
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={value === 0 ? "" : value}
          placeholder="0"
          onChange={handleChange}
          aria-label={ariaLabel}
        />
        {saveState === "saving" && (
          <span className={styles.numericInputIndicatorSaving} aria-label="Saving">
            …
          </span>
        )}
        {saveState === "saved" && (
          <span className={styles.numericInputIndicatorSaved} aria-label="Saved">
            ✓
          </span>
        )}
        {saveState === "error" && (
          <span className={styles.numericInputIndicatorError} role="alert">
            !
          </span>
        )}
      </div>
      {showLimitMessage && <p className={styles.numericInputLimitMessage}>{limitMessage}</p>}
    </div>
  );
}
