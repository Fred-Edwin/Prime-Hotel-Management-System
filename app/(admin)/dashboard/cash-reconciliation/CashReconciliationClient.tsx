"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/Card";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { Toast } from "@/components/Toast";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { ActionMenu } from "@/components/ActionMenu";
import catalogStyles from "../../catalog.module.css";
import styles from "./cashReconciliation.module.css";

type Location = "restaurant" | "canteen";

interface ReconciliationRow {
  id: string;
  location: Location;
  reconciliation_date: string;
  expected_cash: number;
  actual_cash: number;
  variance: number;
  note: string | null;
}

function money(value: number): string {
  return `KES ${Math.round(value).toLocaleString("en-KE")}`;
}

/** Signed money display — a shortfall (negative variance) keeps its
 * minus sign, a surplus gets an explicit "+" so it never misreads as a
 * shortfall's mirror image, same convention as stock adjustments'
 * moneySigned() elsewhere in this codebase (docs/01_DATA_MODEL.md
 * §3.10). */
function moneySigned(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${money(rounded)}`;
}

function todayISO(): string {
  // Mirrors lib/calculations.ts's nairobiToday() logic client-side (that
  // module is server/shared, but this keeps the date picker's default in
  // Nairobi wall-clock time rather than the browser's local timezone).
  const nairobiOffsetMs = 3 * 60 * 60 * 1000;
  return new Date(Date.now() + nairobiOffsetMs).toISOString().slice(0, 10);
}

function varianceTone(variance: number): string {
  if (variance === 0) return styles.varianceNeutral;
  return variance > 0 ? styles.varianceSurplus : styles.varianceShortfall;
}

const LOCATIONS: { value: Location; label: string }[] = [
  { value: "restaurant", label: "Restaurant" },
  { value: "canteen", label: "Canteen" },
];

/**
 * Cash reconciliation screen (post-launch feature, 2026-07-30). Two
 * parts: an entry form for "actual cash received" per location for a
 * chosen date (defaults to today, shows the system's expected figure
 * live), and a history table of every saved reconciliation so far,
 * filterable by date range — she can go back to any date and see what
 * the variance was that day. Reporting/records lens, matching Debtors'
 * established layout (date-scoped record list + a form) rather than a
 * dashboard-style aggregate view, since a reconciliation is a per-day,
 * per-location record she's actively entering, not a computed metric.
 */
export function CashReconciliationClient() {
  const [entryDate, setEntryDate] = useState(todayISO());
  const [expectedCash, setExpectedCash] = useState<{ restaurant: number; canteen: number } | null>(null);
  const [actualCash, setActualCash] = useState<{ restaurant: string; canteen: string }>({
    restaurant: "",
    canteen: "",
  });
  const [note, setNote] = useState<{ restaurant: string; canteen: string }>({ restaurant: "", canteen: "" });
  const [saving, setSaving] = useState<Location | null>(null);
  const [toast, setToast] = useState<{ message: string; status: "success" | "error" } | null>(null);

  const [historyFrom, setHistoryFrom] = useState(() => {
    const d = new Date(`${todayISO()}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 13);
    return d.toISOString().slice(0, 10);
  });
  const [historyTo, setHistoryTo] = useState(todayISO());
  const [history, setHistory] = useState<ReconciliationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const entryCardRef = useRef<HTMLDivElement>(null);

  // Delete confirmation (client feedback, 2026-07-30: "make the history
  // table editable in case she needs to delete or edit anything").
  // Deleting a whole reconciliation record — not just one line in a
  // bigger record, unlike order_payments' no-confirm delete — gets a
  // confirm modal, matching the Item Ledger's row-delete precedent
  // (docs/01_DATA_MODEL.md §3.16) rather than Debtors' no-confirm
  // payment-row delete.
  const [deleteTarget, setDeleteTarget] = useState<ReconciliationRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Wrapped in a nested function per this codebase's standing
  // "setState-before-fetch effect" convention (see DebtorsClient.tsx's
  // load()) so the lint rule against calling a setState-bearing
  // function directly in an effect body doesn't fire.
  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from: historyFrom, to: historyTo });
      const res = await fetch(`/api/dashboard/cash-reconciliation?${params.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to load cash reconciliations");
      setHistory(json.reconciliations ?? []);

      // currentExpectedCash reflects `to` (the most recent date in
      // range) — only meaningful for pre-filling the entry form when
      // the range's upper bound is the date currently selected for entry.
      if (json.currentExpectedCash?.date === entryDate) {
        setExpectedCash({
          restaurant: json.currentExpectedCash.restaurant ?? 0,
          canteen: json.currentExpectedCash.canteen ?? 0,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cash reconciliations");
    } finally {
      setLoading(false);
    }
  }

  // Separate small fetch just for the entry date's expected-cash figure
  // — the history range's `to` won't always equal entryDate (she can
  // browse history for a past range while still entering today's
  // figure), so this can't just rely on the load() effect above.
  async function loadExpectedForEntryDate() {
    try {
      const params = new URLSearchParams({ from: entryDate, to: entryDate });
      const res = await fetch(`/api/dashboard/cash-reconciliation?${params.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setExpectedCash({
        restaurant: json.currentExpectedCash?.restaurant ?? 0,
        canteen: json.currentExpectedCash?.canteen ?? 0,
      });
      // Pre-fill actual_cash/note from an already-saved reconciliation
      // for this exact date, if one exists — re-opening the same day
      // should show what was last saved, not a blank form.
      const existing = (json.reconciliations ?? []) as ReconciliationRow[];
      const restaurantRow = existing.find((r) => r.location === "restaurant" && r.reconciliation_date === entryDate);
      const canteenRow = existing.find((r) => r.location === "canteen" && r.reconciliation_date === entryDate);
      setActualCash({
        restaurant: restaurantRow ? String(restaurantRow.actual_cash) : "",
        canteen: canteenRow ? String(canteenRow.actual_cash) : "",
      });
      setNote({ restaurant: restaurantRow?.note ?? "", canteen: canteenRow?.note ?? "" });
    } catch {
      // Non-fatal — the entry form just won't show an expected figure yet.
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (cancelled) return;
      await loadExpectedForEntryDate();
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryDate]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (cancelled) return;
      await load();
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyFrom, historyTo]);

  async function handleSave(location: Location) {
    const raw = actualCash[location];
    const amount = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(amount) || amount < 0) {
      setToast({ message: "Enter a valid cash amount", status: "error" });
      return;
    }

    setSaving(location);
    try {
      const res = await fetch("/api/dashboard/cash-reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          location,
          reconciliation_date: entryDate,
          actual_cash: amount,
          note: note[location].trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast({ message: body.error ?? "Couldn't save this reconciliation", status: "error" });
        return;
      }
      setToast({ message: `${location === "restaurant" ? "Restaurant" : "Canteen"} reconciliation saved`, status: "success" });
      await loadExpectedForEntryDate();
      await load();
    } catch {
      setToast({ message: "Couldn't reach the server — check your connection and try again.", status: "error" });
    } finally {
      setSaving(null);
    }
  }

  /**
   * "Edit" a history row: there's no separate edit form — the entry
   * card above already re-populates from whatever's saved for the
   * selected date (loadExpectedForEntryDate()'s pre-fill, existing
   * behavior). Jumping the date picker to this row's date reuses that
   * exact mechanism, then scrolls the entry card into view so the
   * change is obvious on a long history list.
   */
  function handleEditRow(row: ReconciliationRow) {
    setEntryDate(row.reconciliation_date);
    entryCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openDeleteConfirm(row: ReconciliationRow) {
    setDeleteTarget(row);
    setDeleteError(null);
  }

  function closeDeleteConfirm() {
    setDeleteTarget(null);
    setDeleteError(null);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/dashboard/cash-reconciliation/${deleteTarget.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleteError(body.error ?? "Couldn't delete this reconciliation — please try again.");
        return;
      }
      setToast({ message: "Reconciliation deleted", status: "success" });
      setDeleteTarget(null);
      // If the deleted row was the one currently pre-filled into the
      // entry form, clear that form's fields so it doesn't keep
      // showing a value that no longer has a saved row behind it.
      if (deleteTarget.reconciliation_date === entryDate) {
        setActualCash((prev) => ({ ...prev, [deleteTarget.location]: "" }));
        setNote((prev) => ({ ...prev, [deleteTarget.location]: "" }));
      }
      await load();
    } catch {
      setDeleteError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={catalogStyles.title}>Cash Reconciliation</h1>
          <Link href="/dashboard" className={styles.backLink}>
            ← Back to dashboard
          </Link>
        </div>
      </div>

      <div ref={entryCardRef}>
      <Card className={styles.entryCard}>
        <div className={styles.entryHeader}>
          <h2 className={styles.entrySectionTitle}>Record cash received</h2>
          <Input
            type="date"
            value={entryDate}
            max={todayISO()}
            onChange={(e) => setEntryDate(e.target.value)}
            className={styles.dateInput}
          />
        </div>

        <div className={styles.entryGrid}>
          {LOCATIONS.map(({ value, label }) => (
            <div key={value} className={styles.entryColumn}>
              <h3 className={styles.entryColumnTitle}>{label}</h3>
              <div className={styles.expectedRow}>
                <span>System expects</span>
                <strong>{expectedCash ? money(expectedCash[value]) : "—"}</strong>
              </div>
              <Input
                label="Actual cash received (KES)"
                type="number"
                min="0"
                step="0.01"
                value={actualCash[value]}
                onChange={(e) => setActualCash((prev) => ({ ...prev, [value]: e.target.value }))}
                placeholder="e.g. 12500"
              />
              <Input
                label="Note (optional)"
                value={note[value]}
                onChange={(e) => setNote((prev) => ({ ...prev, [value]: e.target.value }))}
                placeholder="e.g. Sarah says one M-Pesa sale wasn't in the till"
              />
              {expectedCash && actualCash[value].trim() !== "" && Number.isFinite(Number(actualCash[value])) && (
                <p className={`${styles.livePreview} ${varianceTone(Number(actualCash[value]) - expectedCash[value])}`}>
                  Variance: {moneySigned(Number(actualCash[value]) - expectedCash[value])}
                </p>
              )}
              <Button type="button" onClick={() => handleSave(value)} disabled={saving === value}>
                {saving === value ? "Saving…" : "Save"}
              </Button>
            </div>
          ))}
        </div>
      </Card>
      </div>

      <div className={styles.historyHeaderRow}>
        <h2 className={styles.entrySectionTitle}>History</h2>
        <div className={styles.historyRangeInputs}>
          <Input type="date" value={historyFrom} max={historyTo} onChange={(e) => setHistoryFrom(e.target.value)} />
          <span className={styles.rangeSeparator}>to</span>
          <Input type="date" value={historyTo} min={historyFrom} max={todayISO()} onChange={(e) => setHistoryTo(e.target.value)} />
        </div>
      </div>

      {error && <p className={catalogStyles.formError}>{error}</p>}

      {loading ? (
        <p>Loading…</p>
      ) : history.length === 0 ? (
        <EmptyState
          icon={<Icon name="expenses" size={48} />}
          heading="No reconciliations recorded yet"
          body="Once you save a day's actual cash received above, it'll show up here."
        />
      ) : (
        <>
          <Card className={`${catalogStyles.tableCard} ${catalogStyles.desktopOnly}`}>
            <table className={catalogStyles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Location</th>
                  <th className={catalogStyles.numeric}>Expected</th>
                  <th className={catalogStyles.numeric}>Actual</th>
                  <th className={catalogStyles.numeric}>Variance</th>
                  <th>Note</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id}>
                    <td>{row.reconciliation_date}</td>
                    <td>{row.location === "restaurant" ? "Restaurant" : "Canteen"}</td>
                    <td className={catalogStyles.numeric}>{money(row.expected_cash)}</td>
                    <td className={catalogStyles.numeric}>{money(row.actual_cash)}</td>
                    <td className={`${catalogStyles.numeric} ${varianceTone(row.variance)}`}>
                      {moneySigned(row.variance)}
                    </td>
                    <td>{row.note ?? "—"}</td>
                    <td>
                      <ActionMenu
                        aria-label={`Actions for ${row.reconciliation_date} ${row.location} reconciliation`}
                        items={[
                          { label: "Edit", onClick: () => handleEditRow(row) },
                          { label: "Delete", onClick: () => openDeleteConfirm(row), destructive: true },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <ul className={`${catalogStyles.cardList} ${catalogStyles.mobileOnly}`}>
            {history.map((row) => (
              <li key={row.id} className={catalogStyles.itemCard}>
                <div className={catalogStyles.itemCardRow}>
                  <span className={catalogStyles.itemCardIdentity}>
                    <span className={catalogStyles.itemCardName}>
                      {row.reconciliation_date} · {row.location === "restaurant" ? "Restaurant" : "Canteen"}
                    </span>
                    <span className={catalogStyles.itemCardCategory}>
                      Expected {money(row.expected_cash)} · Actual {money(row.actual_cash)}
                    </span>
                  </span>
                  <span className={catalogStyles.itemCardMetrics}>
                    <span className={varianceTone(row.variance)}>{moneySigned(row.variance)}</span>
                  </span>
                  <ActionMenu
                    aria-label={`Actions for ${row.reconciliation_date} ${row.location} reconciliation`}
                    items={[
                      { label: "Edit", onClick: () => handleEditRow(row) },
                      { label: "Delete", onClick: () => openDeleteConfirm(row), destructive: true },
                    ]}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <Modal
        open={deleteTarget !== null}
        onClose={closeDeleteConfirm}
        title="Delete reconciliation"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeDeleteConfirm} disabled={deleting}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </>
        }
      >
        {deleteTarget && (
          <div className={styles.deleteConfirmBody}>
            <p>
              This removes the {deleteTarget.reconciliation_date}{" "}
              {deleteTarget.location === "restaurant" ? "Restaurant" : "Canteen"} reconciliation (actual{" "}
              {money(deleteTarget.actual_cash)} vs. expected {money(deleteTarget.expected_cash)}). It has no effect
              on recorded sales, stock, or profit — this only removes the record of what was reconciled.
            </p>
            {deleteError && <p className={catalogStyles.formError}>{deleteError}</p>}
          </div>
        )}
      </Modal>

      {toast && <Toast message={toast.message} status={toast.status} onDismiss={() => setToast(null)} />}
    </div>
  );
}
