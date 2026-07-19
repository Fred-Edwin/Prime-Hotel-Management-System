import { requireAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PurchasesClient } from "./PurchasesClient";

/**
 * Admin ingredient purchases view — see docs/01_DATA_MODEL.md §3.2's
 * purchases section. Lists purchase events across the selected period
 * (either logged by admin here, or by the store manager on /store),
 * shows current stock-on-hand valued at the running weighted-average
 * cost, and lets admin log a purchase herself. Same
 * reporting/records-browsing pattern as /dashboard/orders (Phase 9).
 */
export default async function AdminPurchasesPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/login");

  return <PurchasesClient />;
}
