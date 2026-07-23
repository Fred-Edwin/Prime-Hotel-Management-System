"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/Card";
import { Drawer } from "@/components/Drawer";
import { EmptyState } from "@/components/EmptyState";
import { FilterBar } from "@/components/FilterBar";
import { Icon, type IconName } from "@/components/Icon";
import { PeriodToggle } from "@/components/PeriodToggle";
import catalogStyles from "../../catalog.module.css";
import styles from "./audit-log.module.css";

interface AuditLogEntry {
  id: string;
  actor_id: string;
  actor_name: string;
  action: string;
  target_table: string;
  target_id: string;
  changes: { before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; impact?: unknown } | null;
  created_at: string;
}

type Period = "today" | "week" | "month" | "all";

/**
 * Every entity this action type touches maps to one icon + a short,
 * human category label — this is what lets the list be *scanned* by
 * category (a UX goal the old flat table didn't have at all: every row
 * read with identical visual weight, so "what kind of thing changed"
 * only came from reading the text). Grouped by target_table's entity,
 * not by literal action string, so a new action on an already-known
 * entity (e.g. a future "item.price_bulk_update") still gets a sane
 * icon via the ENTITY_ICON fallback below instead of the generic dot.
 */
const ENTITY_ICON: Record<string, IconName> = {
  users: "staff",
  items: "items",
  ingredients: "ingredients",
  delivery_locations: "delivery",
  expenses: "expenses",
  stock_entries: "entry",
  ingredient_entries: "store",
  ingredient_purchases: "ingredients",
  canteen_stock_purchases: "items",
};

const ACTION_LABELS: Record<string, string> = {
  "staff.edit": "Edited staff",
  "staff.deactivate": "Deactivated staff",
  "staff.reactivate": "Reactivated staff",
  "staff.pin_reset": "Reset PIN",
  "item.edit": "Edited item",
  "item.deactivate": "Deactivated item",
  "item.reactivate": "Reactivated item",
  "item.delete": "Deleted item",
  "ingredient.edit": "Edited ingredient",
  "ingredient.deactivate": "Deactivated ingredient",
  "ingredient.reactivate": "Reactivated ingredient",
  "delivery_location.edit": "Edited delivery zone",
  "delivery_location.deactivate": "Deactivated delivery zone",
  "delivery_location.reactivate": "Reactivated delivery zone",
  "expense.admin_edit": "Edited expense",
  "expense.delete": "Deleted expense",
  "stock_entry.admin_edit": "Edited stock entry",
  "ingredient_entry.admin_edit": "Edited ingredient entry",
  "ingredient_purchase.delete": "Deleted ingredient purchase",
  "canteen_purchase.delete": "Deleted canteen purchase",
};

// A price/fee/threshold edit reads far faster as "KES 560 → KES 63.61"
// than as two separate rows of raw numbers the admin has to diff by eye
// — this is the exact piece of information the Smokies ingredient
// investigation (2026-07-23) took a full session to reconstruct by hand
// because nothing on this screen surfaced it. Keys are matched by
// substring so this doesn't need updating every time a new *_price/_fee
// field is added somewhere.
const MONEY_FIELD_HINTS = ["price", "fee", "amount", "value"];

function isMoneyField(key: string): boolean {
  return MONEY_FIELD_HINTS.some((hint) => key.toLowerCase().includes(hint));
}

function formatFieldValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Active" : "Inactive";
  if (typeof value === "number") return isMoneyField(key) ? `KES ${value.toLocaleString("en-KE")}` : String(value);
  return String(value);
}

function humanizeFieldName(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Fallback for any action string that doesn't have a curated label above
// — turns "some_table.new_action" into "Some table: new action" instead
// of ever showing the raw dotted/underscored identifier verbatim, which
// is what the old table did for expense.admin_edit and
// ingredient_purchase.delete before this redesign.
function humanizeAction(action: string): string {
  const [table, verb] = action.split(".");
  if (!verb) return humanizeFieldName(action);
  return `${humanizeFieldName(table)}: ${humanizeFieldName(verb)}`;
}

/**
 * The subject line for a row — "Smokies", "Sarah Makena", "Estate A" —
 * resolved from whichever of before/after carries a `name` field, since
 * every catalog/staff entity this log covers has one. Falls back to the
 * old table/id-prefix form only for the rare action shape that has none
 * (defensive, not expected to hit in practice given current callers).
 */
function subjectName(entry: AuditLogEntry): string {
  const name = entry.changes?.before?.name ?? entry.changes?.after?.name;
  if (typeof name === "string" && name.length > 0) return name;
  return `${entry.target_table}/${entry.target_id.slice(0, 8)}`;
}

/**
 * The single most useful line for a scan: the first field that actually
 * differs between before/after, formatted as "Buying price: KES 560 →
 * KES 63.61". Deliberately shows only the first diff, not all of
 * them — a row-level summary, not a full diff (the Drawer, opened per
 * row, has the complete before/after). Skips `name`/`updated_at`-style
 * fields that aren't meaningful as a "what changed" headline.
 */
const SUMMARY_SKIP_FIELDS = new Set(["name", "created_at", "updated_at", "created_by"]);

function changeSummary(entry: AuditLogEntry): string | null {
  const before = entry.changes?.before;
  const after = entry.changes?.after;
  if (!before || !after) return null;

  for (const key of Object.keys(after)) {
    if (SUMMARY_SKIP_FIELDS.has(key)) continue;
    const beforeVal = before[key];
    const afterVal = after[key];
    if (JSON.stringify(beforeVal) === JSON.stringify(afterVal)) continue;
    return `${humanizeFieldName(key)}: ${formatFieldValue(key, beforeVal)} → ${formatFieldValue(key, afterVal)}`;
  }
  return null;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-KE", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "all", label: "All time" },
];

function periodToRange(period: Period): { from: string | null; to: string | null } {
  if (period === "all") return { from: null, to: null };
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now);
  if (period === "week") from.setDate(from.getDate() - 6);
  if (period === "month") from.setDate(from.getDate() - 29);
  return { from: from.toISOString().slice(0, 10), to };
}

export function AuditLogClient() {
  const [period, setPeriod] = useState<Period>("week");
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [selected, setSelected] = useState<AuditLogEntry | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { from, to } = periodToRange(period);
        const params = new URLSearchParams();
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        const res = await fetch(`/api/audit-log?${params.toString()}`);
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
  }, [period]);

  const actionOptions = useMemo(() => {
    const known = Object.keys(ACTION_LABELS).map((value) => ({
      value,
      label: ACTION_LABELS[value],
    }));
    return [{ value: "", label: "All actions" }, ...known];
  }, []);

  const filtered = (entries ?? []).filter((entry) => {
    if (actionFilter && entry.action !== actionFilter) return false;
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (
      entry.actor_name.toLowerCase().includes(term) || subjectName(entry).toLowerCase().includes(term)
    );
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
        <PeriodToggle
          options={PERIOD_OPTIONS}
          value={period}
          onChange={(v) => setPeriod(v as Period)}
        />
      </div>

      <p className={styles.scopeNote}>
        Every admin edit to staff, items, ingredients, delivery zones, expenses, and stock/ingredient
        ledger entries — who changed what, and when. Staff and cashier actions elsewhere in the app
        (till sales, orders, wastage) aren&apos;t tracked here.
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
              searchPlaceholder="Search by admin or item/ingredient name…"
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
              icon={<Icon name="history" size={48} />}
              heading={entries && entries.length > 0 ? "No matching entries" : "No audit entries this period"}
              body={
                entries && entries.length > 0
                  ? "Try a different search term, action filter, or a wider time period."
                  : "Admin edits to staff, catalog items, and ledger entries will show up here."
              }
            />
          ) : (
            <>
              <Card className={`${catalogStyles.tableCard} ${catalogStyles.desktopOnly}`}>
                <table className={catalogStyles.table}>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Admin</th>
                      <th>Action</th>
                      <th>What changed</th>
                      <th aria-label="Details" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((entry) => {
                      const icon = ENTITY_ICON[entry.target_table] ?? "history";
                      const summary = changeSummary(entry);
                      return (
                        <tr
                          key={entry.id}
                          className={styles.row}
                          onClick={() => setSelected(entry)}
                        >
                          <td className={styles.whenCell}>{formatDateTime(entry.created_at)}</td>
                          <td>{entry.actor_name}</td>
                          <td>
                            <span className={styles.actionCell}>
                              <span className={styles.actionIcon}>
                                <Icon name={icon} size={16} />
                              </span>
                              <span>
                                <span className={styles.actionLabel}>
                                  {ACTION_LABELS[entry.action] ?? humanizeAction(entry.action)}
                                </span>
                                <span className={styles.subjectName}>{subjectName(entry)}</span>
                              </span>
                            </span>
                          </td>
                          <td className={styles.summaryCell}>
                            {summary ?? <span className={styles.noSummary}>—</span>}
                          </td>
                          <td>
                            <button
                              type="button"
                              className={styles.detailsButton}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelected(entry);
                              }}
                              aria-label="View full details"
                            >
                              <Icon name="info" size={16} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>

              {/* Mobile card list — same collapse-to-essentials pattern as
                  Ledger/Items/Staff (catalogStyles.cardList/itemCard). Each
                  card opens the same detail Drawer as the desktop row click. */}
              <ul className={`${catalogStyles.cardList} ${catalogStyles.mobileOnly}`}>
                {filtered.map((entry) => {
                  const icon = ENTITY_ICON[entry.target_table] ?? "history";
                  const summary = changeSummary(entry);
                  return (
                    <li key={entry.id} className={catalogStyles.itemCard}>
                      <button
                        type="button"
                        className={catalogStyles.itemCardRow}
                        onClick={() => setSelected(entry)}
                      >
                        <span className={styles.mobileIdentityRow}>
                          <span className={styles.actionIcon}>
                            <Icon name={icon} size={16} />
                          </span>
                          <span className={catalogStyles.itemCardIdentity}>
                            <span className={catalogStyles.itemCardName}>{subjectName(entry)}</span>
                            <span className={catalogStyles.itemCardCategory}>
                              {ACTION_LABELS[entry.action] ?? humanizeAction(entry.action)} · {entry.actor_name}
                            </span>
                          </span>
                        </span>
                        <span className={catalogStyles.itemCardChevron}>
                          <Icon name="chevron-right" size={20} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}

      <Drawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? ACTION_LABELS[selected.action] ?? humanizeAction(selected.action) : ""}
        subtitle={selected ? subjectName(selected) : undefined}
      >
        {selected && (
          <div className={styles.detail}>
            <div className={styles.detailMeta}>
              <div>
                <span className={styles.detailMetaLabel}>When</span>
                <span>{formatDateTime(selected.created_at)}</span>
              </div>
              <div>
                <span className={styles.detailMetaLabel}>Admin</span>
                <span>{selected.actor_name}</span>
              </div>
              <div>
                <span className={styles.detailMetaLabel}>Record</span>
                <span className={styles.detailMetaMono}>
                  {selected.target_table}/{selected.target_id.slice(0, 8)}
                </span>
              </div>
            </div>

            {selected.changes?.before || selected.changes?.after ? (
              <div className={styles.diffTable}>
                <div className={styles.diffHeaderRow}>
                  <span>Field</span>
                  <span>Before</span>
                  <span>After</span>
                </div>
                {Array.from(
                  new Set([
                    ...Object.keys(selected.changes?.before ?? {}),
                    ...Object.keys(selected.changes?.after ?? {}),
                  ]),
                ).map((key) => {
                  const beforeVal = selected.changes?.before?.[key];
                  const afterVal = selected.changes?.after?.[key];
                  const changed = JSON.stringify(beforeVal) !== JSON.stringify(afterVal);
                  return (
                    <div
                      key={key}
                      className={[styles.diffRow, changed ? styles.diffRowChanged : ""].join(" ")}
                    >
                      <span className={styles.diffField}>{humanizeFieldName(key)}</span>
                      <span>{formatFieldValue(key, beforeVal)}</span>
                      <span>{formatFieldValue(key, afterVal)}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className={styles.noDetail}>No field-level detail recorded for this action.</p>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
