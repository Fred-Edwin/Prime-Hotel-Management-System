"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "../Button";
import styles from "./TillStrip.module.css";

export interface TillStripProps {
  itemCount: number;
  totalValueLabel: string;
  onSave: () => void;
  saveLabel?: string;
  saving?: boolean;
}

export function TillStrip({
  itemCount,
  totalValueLabel,
  onSave,
  saveLabel = "Save",
  saving = false,
}: TillStripProps) {
  const [flash, setFlash] = useState(false);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setFlash(true);
    const timeout = setTimeout(() => setFlash(false), 150);
    return () => clearTimeout(timeout);
  }, [itemCount, totalValueLabel]);

  return (
    <div className={[styles.strip, flash ? styles.flash : ""].filter(Boolean).join(" ")}>
      <div className={styles.totals}>
        <span className={styles.itemCount}>
          {itemCount} {itemCount === 1 ? "item" : "items"}
        </span>
        <span className={styles.totalValue}>{totalValueLabel}</span>
      </div>
      <Button variant="primary" onClick={onSave} disabled={saving}>
        {saving ? "Saving…" : saveLabel}
      </Button>
    </div>
  );
}
