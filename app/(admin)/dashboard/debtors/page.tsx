import { requireAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DebtorsClient } from "./DebtorsClient";

/**
 * Admin debtors screen (Phase 11 — docs/01_DATA_MODEL.md §6's "Credit
 * sales and customer payments" subsection). Read/write: lists every
 * customer with an outstanding balance across both locations, drills
 * into their unpaid/partially-paid orders, and lets the admin record a
 * payment. Same reporting/records-browsing lens and light table surface
 * as /dashboard/orders (Phase 9) — a debtor list is individual
 * transactional records to scan and drill into, not an aggregate
 * metric, so it follows that established pattern rather than inventing
 * a new layout.
 */
export default async function DebtorsPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/login");

  return <DebtorsClient />;
}
