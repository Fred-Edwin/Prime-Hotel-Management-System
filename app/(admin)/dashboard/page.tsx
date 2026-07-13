import { requireAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DashboardClient } from "./DashboardClient";

/**
 * Admin dashboard (04_PHASE_PLAN.md Phase 7) — profit visibility for
 * WaPrecious. All data fetching happens client-side against
 * /api/dashboard/summary (period-toggled), so this server component's
 * only job is the admin gate — the route itself already double-checks
 * via requireAdmin(), same defense-in-depth pattern as every other admin
 * route in this codebase.
 */
export default async function DashboardPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/login");

  return <DashboardClient />;
}
