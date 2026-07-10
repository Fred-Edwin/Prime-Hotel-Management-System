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
}

export function PeriodToggle({ options, value, onChange }: PeriodToggleProps) {
  return (
    <div className={styles.toggle} role="tablist">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={[styles.segment, active ? styles.active : ""].filter(Boolean).join(" ")}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
