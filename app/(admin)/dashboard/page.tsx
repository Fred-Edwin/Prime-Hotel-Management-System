import { EmptyState } from "@/components/EmptyState";
import styles from "../catalog.module.css";

// Placeholder — the real profit dashboard is Phase 7 scope
// (04_PHASE_PLAN.md). This page exists only so admin login has a
// landing destination (middleware.ts redirects admin → /dashboard),
// per the Phase 3 human decision recorded in docs/phases/phase3_context.md.
export default function DashboardPage() {
  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Dashboard</h1>
      </div>
      <EmptyState
        icon={<span aria-hidden>~</span>}
        heading="Dashboard coming soon"
        body="Profit and stock reporting land here in a later phase. Use the nav below to manage items, ingredients, delivery locations, and staff."
      />
    </div>
  );
}
