import { requireAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AuditLogClient } from "./AuditLogClient";

/**
 * Admin audit trail (docs/backlog/03_audit_log.md). First-pass scope
 * covers Staff edit/deactivate/PIN-reset only (see lib/audit.ts callers).
 * Read-only, admin-only — RLS (audit_log_select_admin_only) is the real
 * boundary, this route check is defense in depth. Reached from the Staff
 * screen rather than added as an 8th top-level sidebar item, same
 * placement pattern as /dashboard/orders and /dashboard/ledger.
 */
export default async function AuditLogPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/login");

  return <AuditLogClient />;
}
