"use client";

import styles from "./PeriodToggle.module.css";

export interface PeriodOption {
  value: string;
  label: string;
}

export interface PeriodToggleProps {
  options: PeriodOption[];
  value: string;
  onChange: (value: string) => void;
  /** Dark-surface variant — see admin dashboard's hero band (Components §4.8). */
  onDark?: boolean;
}

export function PeriodToggle({ options, value, onChange, onDark = false }: PeriodToggleProps) {
  return (
    <div
      className={[styles.toggle, onDark ? styles.toggleOnDark : ""].filter(Boolean).join(" ")}
      role="tablist"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={[
              styles.segment,
              onDark ? styles.segmentOnDark : "",
              active ? (onDark ? styles.activeOnDark : styles.active) : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
