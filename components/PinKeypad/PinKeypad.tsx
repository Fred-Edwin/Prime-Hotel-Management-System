"use client";

import styles from "./PinKeypad.module.css";

export interface PinKeypadProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  onComplete?: (value: string) => void;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "backspace"] as const;

/**
 * On-screen numeric keypad, login screen only — see
 * docs/design/01_COMPONENTS.md §4.19 and 00_FOUNDATIONS.md §1.3's
 * scoped exception. No device keyboard involved; every digit is a tap
 * on this component's own keys.
 */
export function PinKeypad({ length = 4, value, onChange, error, onComplete }: PinKeypadProps) {
  function pressDigit(digit: string) {
    if (value.length >= length) return;
    const next = value + digit;
    onChange(next);
    if (next.length === length) onComplete?.(next);
  }

  function pressBackspace() {
    onChange(value.slice(0, -1));
  }

  const dots = Array.from({ length }, (_, i) => (
    <span
      key={i}
      className={[styles.dot, i < value.length ? styles.dotFilled : "", error ? styles.dotError : ""]
        .filter(Boolean)
        .join(" ")}
    />
  ));

  return (
    <div className={styles.field}>
      <div className={styles.display} role="status" aria-label={`PIN, ${value.length} of ${length} digits entered`}>
        {dots}
      </div>
      {error && <p className={styles.errorMessage}>{error}</p>}

      <div className={styles.grid}>
        {KEYS.map((key, i) => {
          if (key === "") return <div key={i} className={styles.keySpacer} aria-hidden="true" />;

          if (key === "backspace") {
            return (
              <button
                key={i}
                type="button"
                className={styles.key}
                onClick={pressBackspace}
                disabled={value.length === 0}
                aria-label="Delete last digit"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Z" />
                  <path d="M15 9l-6 6M9 9l6 6" />
                </svg>
              </button>
            );
          }

          return (
            <button
              key={i}
              type="button"
              className={styles.key}
              onClick={() => pressDigit(key)}
              disabled={value.length >= length}
              aria-label={`Digit ${key}`}
            >
              {key}
            </button>
          );
        })}
      </div>
    </div>
  );
}
