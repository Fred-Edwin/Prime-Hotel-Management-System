import { ReactNode } from "react";
import { Button } from "../Button";
import styles from "./EmptyState.module.css";

export interface EmptyStateProps {
  icon: ReactNode;
  heading: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, heading, body, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className={styles.container}>
      <div className={styles.icon} aria-hidden="true">
        {icon}
      </div>
      <h3 className={styles.heading}>{heading}</h3>
      <p className={styles.body}>{body}</p>
      {actionLabel && onAction && (
        <Button variant="primary" onClick={onAction} className={styles.action}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
