"use client";

import { useEffect } from "react";
import styles from "./Toast.module.css";

export type ToastStatus = "success" | "warning" | "error" | "info";

export interface ToastProps {
  message: string;
  status?: ToastStatus;
  onDismiss: () => void;
  durationMs?: number;
}

export function Toast({ message, status = "info", onDismiss, durationMs = 4000 }: ToastProps) {
  useEffect(() => {
    const timeout = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timeout);
  }, [onDismiss, durationMs]);

  return (
    <div className={[styles.toast, styles[status]].join(" ")} role="status">
      <p className={styles.message}>{message}</p>
    </div>
  );
}
