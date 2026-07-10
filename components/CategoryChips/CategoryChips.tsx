"use client";

import styles from "./CategoryChips.module.css";

/**
 * Placeholder per 04_PHASE_PLAN.md Phase 1 scope. 01_COMPONENTS.md does not
 * give CategoryChips its own spec section — this implementation borrows the
 * PeriodToggle's chip/pill visual language (neutral-100 track, aubergine
 * active fill) as the closest documented analog. Flagged as a design-system
 * gap in docs/phases/phase1_context.md; revisit if a real spec is added.
 */
export interface CategoryChipOption {
  value: string;
  label: string;
}

export interface CategoryChipsProps {
  options: CategoryChipOption[];
  value: string;
  onChange: (value: string) => void;
}

export function CategoryChips({ options, value, onChange }: CategoryChipsProps) {
  return (
    <div className={styles.chips} role="tablist">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={[styles.chip, active ? styles.active : ""].filter(Boolean).join(" ")}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
