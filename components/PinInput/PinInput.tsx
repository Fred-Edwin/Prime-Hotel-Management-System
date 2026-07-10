"use client";

import { useEffect, useRef } from "react";
import styles from "./PinInput.module.css";

export interface PinInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  autoFocus?: boolean;
  onComplete?: (value: string) => void;
}

/**
 * Boxed digit entry, login screen only — see docs/design/01_COMPONENTS.md
 * §4.16. A single visually-hidden numeric input receives all real
 * keyboard/paste/autofill behavior; the boxes are a pure reflection of
 * its value, not N separately-focusable fields.
 */
export function PinInput({
  length = 4,
  value,
  onChange,
  error,
  autoFocus = false,
  onComplete,
}: PinInputProps) {
  const hiddenInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) hiddenInputRef.current?.focus();
  }, [autoFocus]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, "").slice(0, length);
    onChange(digits);
    if (digits.length === length) onComplete?.(digits);
  }

  const boxes = Array.from({ length }, (_, i) => {
    const filled = i < value.length;
    const active = i === value.length;
    return (
      <div
        key={i}
        className={[
          styles.box,
          filled ? styles.filled : "",
          active && !error ? styles.active : "",
          error ? styles.error : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {filled && <span className={styles.dot} />}
      </div>
    );
  });

  return (
    <div className={styles.field}>
      <div
        className={styles.boxes}
        onClick={() => hiddenInputRef.current?.focus()}
        role="presentation"
      >
        {boxes}
      </div>
      <input
        ref={hiddenInputRef}
        className={styles.hiddenInput}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        maxLength={length}
        value={value}
        onChange={handleChange}
        aria-label="PIN"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "pin-error" : undefined}
      />
      {error && (
        <p id="pin-error" className={styles.errorMessage}>
          {error}
        </p>
      )}
    </div>
  );
}
