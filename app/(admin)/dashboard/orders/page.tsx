import { requireAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import { OrdersClient } from "./OrdersClient";

/**
 * Admin order detail view (Phase 9 — see docs/phases/phase9_context.md).
 * Read-only: lists delivery/pickup orders across both locations for the
 * selected period, with drill-in to see an individual order's line items.
 * Standard light table surface, same pattern as /dashboard/ledger.
 */
export default async function AdminOrdersPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/login");

  return <OrdersClient />;
}
