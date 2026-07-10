import styles from "./RoleLocationBadge.module.css";

export interface RoleLocationBadgeProps {
  label: string;
  variant?: "location" | "admin";
}

export function RoleLocationBadge({ label, variant = "location" }: RoleLocationBadgeProps) {
  return (
    <span className={[styles.badge, styles[variant]].join(" ")}>{label}</span>
  );
}
