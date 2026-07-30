import { requireAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import { CashReconciliationClient } from "./CashReconciliationClient";

/**
 * Admin cash reconciliation screen (post-launch feature, 2026-07-30 —
 * see docs/01_DATA_MODEL.md's cash_reconciliations section). Lets
 * WaPrecious record the actual cash she received from each location's
 * staff for a given day, and see the variance against what the system's
 * own stock_entries sales_value says she should have received — for any
 * past date, not just today. Admin-only, no staff equivalent.
 */
export default async function CashReconciliationPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/login");

  return <CashReconciliationClient />;
}
