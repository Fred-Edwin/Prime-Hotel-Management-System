import { Card } from "../Card";
import styles from "./MetricCard.module.css";

export type MetricTrend = "up" | "down" | "neutral";

export interface MetricCardProps {
  label: string;
  value: string;
  trend?: MetricTrend;
  trendLabel?: string;
  onDark?: boolean;
}

const trendClassName: Record<MetricTrend, string> = {
  up: "trendUp",
  down: "trendDown",
  neutral: "trendNeutral",
};

// Dark-surface tints (Phase 7) — the plain trend colors fail WCAG text
// contrast on --color-surface-dark, see globals.css's
// --color-status-success-on-dark/--color-status-error-on-dark note.
const trendClassNameOnDark: Record<MetricTrend, string> = {
  up: "trendUpOnDark",
  down: "trendDownOnDark",
  neutral: "trendNeutralOnDark",
};

export function MetricCard({ label, value, trend, trendLabel, onDark = false }: MetricCardProps) {
  const body = (
    <>
      <p className={[styles.label, onDark ? styles.labelOnDark : ""].filter(Boolean).join(" ")}>
        {label}
      </p>
      <p className={[styles.value, onDark ? styles.valueOnDark : ""].filter(Boolean).join(" ")}>
        {value}
      </p>
      {trend && trendLabel && (
        <p
          className={[
            styles.trend,
            styles[onDark ? trendClassNameOnDark[trend] : trendClassName[trend]],
          ].join(" ")}
        >
          {trendLabel}
        </p>
      )}
    </>
  );

  if (onDark) {
    return <div className={styles.cardOnDark}>{body}</div>;
  }

  return <Card className={styles.card}>{body}</Card>;
}
