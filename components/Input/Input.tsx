"use client";

import { InputHTMLAttributes, forwardRef, ReactNode, useId } from "react";
import styles from "./Input.module.css";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  /** Optional node rendered inline after the label — e.g. an InfoTooltip for a field whose purpose isn't obvious from the label alone. */
  labelExtra?: ReactNode;
  error?: string;
  numeric?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, labelExtra, error, numeric = false, className, id, ...rest }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;

    return (
      <div className={styles.field}>
        {label && (
          <label className={styles.label} htmlFor={inputId}>
            {label}
            {labelExtra}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={[styles.input, numeric ? styles.numeric : "", error ? styles.inputError : "", className ?? ""]
            .filter(Boolean)
            .join(" ")}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${inputId}-error` : undefined}
          {...rest}
        />
        {error && (
          <p id={`${inputId}-error`} className={styles.error}>
            {error}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";
