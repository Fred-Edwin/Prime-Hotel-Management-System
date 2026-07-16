import { InfoTooltip } from "../InfoTooltip";
import styles from "./PlaceholderStat.module.css";

export interface PlaceholderStatProps {
  label: string;
  value?: string;
  reason: string;
}

/**
 * A single, consistent "shipped in the UI ahead of its backend" treatment
 * — introduced Phase 10 for the handful of elements the admin redesign's
 * reference designs included but this product doesn't have data for yet
 * (Dashboard's "Add Entry"/notifications, Ledger's staff-on-shift column,
 * Staff's Attendance/Last Shift). Dashed border + muted tone + an
 * InfoTooltip explaining what's coming keeps these from reading as
 * broken or as real, wired functionality — see
 * docs/design/01_COMPONENTS.md §4.19 and Phase 10's context file for the
 * full list of what's parked here and why.
 */
export function PlaceholderStat({ label, value, reason }: PlaceholderStatProps) {
  return (
    <span className={styles.stat}>
      <span className={styles.label}>{label}</span>
      {value && <span className={styles.value}>{value}</span>}
      <InfoTooltip label={label} message={reason} />
    </span>
  );
}
