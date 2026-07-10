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
        <p className={[styles.trend, styles[trendClassName[trend]]].join(" ")}>{trendLabel}</p>
      )}
    </>
  );

  if (onDark) {
    return <div className={styles.cardOnDark}>{body}</div>;
  }

  return <Card className={styles.card}>{body}</Card>;
}
