"use client";

import styles from "./StatusStrip.module.css";

export type StatusStripState = "idle" | "saving" | "saved" | "error";

export interface StatusStripProps {
  state: StatusStripState;
  totalValueLabel: string;
  errorMessage?: string;
}

/**
 * Replaces TillStrip on /store (Phase 10 redesign) — /store autosaves
 * per field, so there's no Save action left to anchor a button-based
 * strip. This is a pure status readout mounted in the same
 * TillStripSlot/StaffShell docking mechanism: "Saving…" / "All changes
 * saved" / an error message, plus the running cooking-cost total.
 * /entry keeps TillStrip unchanged — this is /store-specific, not a
 * replacement of the shared component.
 */
export function StatusStrip({ state, totalValueLabel, errorMessage }: StatusStripProps) {
  return (
    <div className={styles.strip}>
      <span className={[styles.status, styles[state]].join(" ")}>
        {state === "saving" && "Saving…"}
        {state === "saved" && "All changes saved"}
        {state === "error" && (errorMessage ?? "Couldn't save — check your connection")}
        {state === "idle" && "No changes yet"}
      </span>
      <span className={styles.totalValue}>{totalValueLabel}</span>
    </div>
  );
}
