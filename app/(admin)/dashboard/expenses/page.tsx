import { requireAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AdminExpensesClient } from "./AdminExpensesClient";

/**
 * Admin expense logging — see docs/01_DATA_MODEL.md §2 `expenses` and
 * 20260721070000_admin_business_wide_expenses.sql. Same underlying table
 * and API route as staff's /expenses, but admin additionally picks a
 * location (Restaurant / Canteen / Business-wide) since costs like rent
 * and salaries aren't attributable to a single location the way staff's
 * own electricity/gas/charcoal entries are.
 */
export default async function AdminExpensesPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/login");

  return <AdminExpensesClient />;
}
