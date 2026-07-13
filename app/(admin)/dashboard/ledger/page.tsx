import { requireAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import { LedgerClient } from "./LedgerClient";

/**
 * Item Ledger (04_PHASE_PLAN.md Phase 7, docs/SCREENS.md "/dashboard/ledger")
 * — detailed per-item, per-period table of every stock_entries column,
 * plus a separate restaurant-only ingredient ledger section. Standard
 * light table surface, not the dashboard's dark hero band (Components
 * §4.11, Patterns §5).
 */
export default async function LedgerPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/login");

  return <LedgerClient />;
}
