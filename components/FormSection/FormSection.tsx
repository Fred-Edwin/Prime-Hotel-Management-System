import { ReactNode } from "react";
import styles from "./FormSection.module.css";

export interface FormSectionProps {
  label: string;
  children: ReactNode;
}

/**
 * Groups related fields inside a Drawer form (e.g. Items' "Identity" /
 * "Pricing" / "Stock Behavior" / "Status" groups) behind an overline
 * label and a divider — see docs/design/01_COMPONENTS.md §4.19. Not a
 * standalone card; always a child of Drawer's body.
 */
export function FormSection({ label, children }: FormSectionProps) {
  return (
    <section className={styles.section}>
      <h3 className={styles.label}>{label}</h3>
      <div className={styles.fields}>{children}</div>
    </section>
  );
}
