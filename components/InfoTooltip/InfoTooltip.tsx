"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import styles from "./InfoTooltip.module.css";

export interface InfoTooltipProps {
  label: string;
  message: string;
}

/**
 * Small "?" affordance for a field whose purpose isn't obvious from its
 * label alone. Not in the original component library (01_COMPONENTS.md) —
 * added as the minimal addition consistent with existing primitives: reuses
 * Dropdown's popover surface (elevation-2, radius-md) rather than inventing
 * a new visual language.
 */
export function InfoTooltip({ label, message }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="info" size={16} />
      </button>
      {open && (
        <span role="tooltip" id={panelId} className={styles.panel}>
          {message}
        </span>
      )}
    </span>
  );
}
