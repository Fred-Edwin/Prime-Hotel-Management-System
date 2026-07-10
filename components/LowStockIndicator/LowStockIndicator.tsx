import styles from "./LowStockIndicator.module.css";

export interface LowStockIndicatorProps {
  variant?: "dot" | "pill";
  label?: string;
}

export function LowStockIndicator({ variant = "pill", label = "Low stock" }: LowStockIndicatorProps) {
  if (variant === "dot") {
    return <span className={styles.dot} role="img" aria-label={label} />;
  }

  return <span className={styles.pill}>{label}</span>;
}
