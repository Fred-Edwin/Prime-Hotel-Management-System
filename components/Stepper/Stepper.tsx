"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./Stepper.module.css";

export interface StepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  limitMessage?: string;
  "aria-label"?: string;
}

export function Stepper({
  value,
  onChange,
  min = 0,
  max,
  limitMessage = "Limit reached",
  "aria-label": ariaLabel,
}: StepperProps) {
  const [shake, setShake] = useState(false);
  const [showLimitMessage, setShowLimitMessage] = useState(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, []);

  const atMin = value <= min;
  const atMax = max !== undefined && value >= max;

  function triggerLimitFeedback() {
    setShake(true);
    setShowLimitMessage(true);
    setTimeout(() => setShake(false), 300);
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => setShowLimitMessage(false), 2500);
  }

  function decrement() {
    if (atMin) {
      return;
    }
    onChange(value - 1);
  }

  function increment() {
    if (atMax) {
      triggerLimitFeedback();
      return;
    }
    onChange(value + 1);
  }

  return (
    <div className={styles.wrapper}>
      <div className={[styles.stepper, shake ? styles.shake : ""].filter(Boolean).join(" ")}>
        <button
          type="button"
          className={styles.button}
          onClick={decrement}
          disabled={atMin}
          aria-label={ariaLabel ? `Decrease ${ariaLabel}` : "Decrease"}
        >
          &minus;
        </button>
        <span className={styles.count} aria-live="polite">
          {value}
        </span>
        <button
          type="button"
          className={styles.button}
          onClick={increment}
          disabled={atMax}
          aria-label={ariaLabel ? `Increase ${ariaLabel}` : "Increase"}
        >
          +
        </button>
      </div>
      {showLimitMessage && <p className={styles.limitMessage}>{limitMessage}</p>}
    </div>
  );
}
