"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { FilterBar } from "@/components/FilterBar";
import { Icon } from "@/components/Icon";
import catalogStyles from "../../catalog.module.css";
import styles from "./audit-log.module.css";

interface AuditLogEntry {
  id: string;
  actor_id: string;
  actor_name: string;
  action: string;
  target_table: string;
  target_id: string;
  changes: Record<string, unknown> | null;
  created_at: string;
}

const ACTION_LABELS: Record<string, string> = {
  "staff.edit": "Edited staff",
  "staff.deactivate": "Deactivated staff",
  "staff.reactivate": "Reactivated staff",
  "staff.pin_reset": "Reset PIN",
  "stock_entry.admin_edit": "Edited stock entry",
  "ingredient_entry.admin_edit": "Edited ingredient entry",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function AuditLogClient() {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/audit-log");
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Failed to load audit log");
        if (!cancelled) setEntries(json.entries as AuditLogEntry[]);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load audit log");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const actionOptions = useMemo(() => {
    const known = Object.keys(ACTION_LABELS).map((value) => ({
      value,
      label: ACTION_LABELS[value],
    }));
    return [{ value: "", label: "All actions" }, ...known];
  }, []);

  const filtered = (entries ?? []).filter((entry) => {
    if (actionFilter && entry.action !== actionFilter) return false;
    if (search && !entry.actor_name.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={catalogStyles.title}>Audit Log</h1>
          <Link href="/dashboard" className={styles.backLink}>
            ← Back to dashboard
          </Link>
        </div>
      </div>

      <p className={styles.scopeNote}>
        Records admin actions on staff accounts (edit, deactivate/reactivate, PIN reset) and admin
        edits to stock/ingredient ledger entries. Other actions aren&apos;t tracked yet.
      </p>

      {error && <p className={catalogStyles.formError}>{error}</p>}

      {loading && !entries ? (
        <p>Loading…</p>
      ) : (
        <>
          <div className={styles.toolbarRow}>
            <FilterBar
              searchValue={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search by admin name…"
              filters={[
                {
                  value: actionFilter,
                  onChange: setActionFilter,
                  "aria-label": "Filter by action",
                  options: actionOptions,
                },
              ]}
            />
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={<Icon name="summary" size={48} />}
              heading={entries && entries.length > 0 ? "No matching entries" : "No audit entries yet"}
              body={
                entries && entries.length > 0
                  ? "Try a different search term or action filter."
                  : "Staff edits, deactivations, reactivations, PIN resets, and ledger corrections will show up here."
              }
            />
          ) : (
            <Card className={catalogStyles.tableCard}>
              <table className={catalogStyles.table}>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Admin</th>
                    <th>Action</th>
                    <th>Target</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((entry) => (
                    <tr key={entry.id}>
                      <td>{formatDateTime(entry.created_at)}</td>
                      <td>{entry.actor_name}</td>
                      <td>{ACTION_LABELS[entry.action] ?? entry.action}</td>
                      <td className={styles.targetCell}>
                        {entry.target_table}/{entry.target_id.slice(0, 8)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
