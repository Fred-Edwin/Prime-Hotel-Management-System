"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { CategoryChips } from "@/components/CategoryChips";
import { Input } from "@/components/Input";
import { PeriodToggle } from "@/components/PeriodToggle";
import { Toast } from "@/components/Toast";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { Card } from "@/components/Card";
import { ActionMenu } from "@/components/ActionMenu";
import { Modal } from "@/components/Modal";
import { nairobiToday } from "@/lib/calculations";
import type { Database } from "@/lib/supabase/types";
import catalogStyles from "../../catalog.module.css";
import styles from "./expenses.module.css";

type Period = "today" | "week" | "month";
type ExpenseCategoryRow = Database["public"]["Tables"]["expense_categories"]["Row"];
interface CategoryDeleteImpact {
  expenses_count: number;
  expenses_value: number;
}
type ExpenseRow = Database["public"]["Tables"]["expenses"]["Row"] & {
  expense_categories: { id: string; name: string } | null;
};
// The form's own location choice — "business_wide" maps to a null
// `location` column value (see 20260721070000_admin_business_wide_expenses.sql),
// there's no third location_type enum value for it.
type LocationChoice = "restaurant" | "canteen" | "business_wide";

// Restaurant/canteen listed first — these are the frequent, routine
// entries (electricity, gas, charcoal), same categories staff already
// log daily. Business-wide (rent, salaries) is real but rare, so it's
// visually set apart rather than presented as a third, equal-weight
// location chip a first-time user might confuse with a "which branch"
// picker (see conversation: two rows of identical-looking pill buttons
// stacked directly above each other was flagged as a real mix-up risk).
const LOCATION_OPTIONS: { value: LocationChoice; label: string }[] = [
  { value: "restaurant", label: "Restaurant" },
  { value: "canteen", label: "Canteen" },
];

const PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

function locationLabel(location: ExpenseRow["location"]): string {
  if (location === "restaurant") return "Restaurant";
  if (location === "canteen") return "Canteen";
  return "Business-wide";
}

function money(value: number): string {
  return `KES ${value.toFixed(2)}`;
}

/**
 * Admin expense screen — two distinct jobs kept visually separate, per
 * the forms/CRUD + small-business-admin review: (1) logging a routine
 * expense, frequent and fast, vs. (2) reviewing/correcting history and
 * managing what categories exist, infrequent and deliberate.
 *
 * Quick-log form: Restaurant/Canteen chips are the default path (the
 * same daily-cost categories staff already log); "Business-wide" is a
 * separate toggle below it, not a third chip in the same row, since
 * rent/salaries are rare, large, whole-business costs, not a location.
 * Category picker reads the shared admin-managed expense_categories
 * catalog (20260721090000_expense_categories_catalog.sql) — no
 * hardcoded list — with a "Manage" entry point into a lightweight modal
 * for the rare add/rename/retire action, kept out of the common path.
 *
 * History: a real table (desktop) / card list (mobile), matching
 * Ledger/Purchases' existing convention — this is a reviewing/scanning
 * job, unlike single-item entry, so tabular columns win here
 * specifically. Each row supports admin edit/delete via ActionMenu,
 * same interaction pattern Purchases already uses.
 */
export function AdminExpensesClient() {
  const [period, setPeriod] = useState<Period>("today");
  const [categories, setCategories] = useState<ExpenseCategoryRow[]>([]);
  const [categoryId, setCategoryId] = useState<string>("");
  const [businessWide, setBusinessWide] = useState(false);
  const [location, setLocation] = useState<LocationChoice>("restaurant");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; status: "success" | "error" } | null>(null);

  const [manageOpen, setManageOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const [categoryDeleteTarget, setCategoryDeleteTarget] = useState<ExpenseCategoryRow | null>(null);
  const [categoryDeleteImpact, setCategoryDeleteImpact] = useState<CategoryDeleteImpact | null>(null);
  const [categoryDeleteImpactLoading, setCategoryDeleteImpactLoading] = useState(false);
  const [categoryDeleteConfirmText, setCategoryDeleteConfirmText] = useState("");
  const [categoryDeleting, setCategoryDeleting] = useState(false);
  const [categoryDeleteError, setCategoryDeleteError] = useState<string | null>(null);

  const [editTarget, setEditTarget] = useState<ExpenseRow | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editCategoryId, setEditCategoryId] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<ExpenseRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const dateRange = useCallback((): string[] => {
    const today = nairobiToday();
    if (period === "today") return [today];

    const days = period === "week" ? 7 : 30;
    const dates: string[] = [];
    const cursor = new Date(`${today}T00:00:00Z`);
    for (let i = 0; i < days; i++) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return dates;
  }, [period]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dates = dateRange();
      const results = await Promise.all(
        dates.map(async (date) => {
          const res = await fetch(`/api/expenses?date=${date}`);
          const body = await res.json();
          if (!res.ok) throw new Error(body.error ?? "Couldn't load expenses");
          return body as { expenses: ExpenseRow[]; expenseCategories: ExpenseCategoryRow[] };
        }),
      );
      const allExpenses = results.flatMap((r) => r.expenses ?? []);
      allExpenses.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      setExpenses(allExpenses);

      const fetchedCategories = results[0]?.expenseCategories ?? [];
      setCategories(fetchedCategories);
      setCategoryId((current) => current || fetchedCategories[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load expenses");
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const parsedAmount = Number(amount);
  const amountValid = amount.trim() !== "" && Number.isFinite(parsedAmount) && parsedAmount >= 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!categoryId) {
      setToast({ message: "Choose a category", status: "error" });
      return;
    }
    if (!amountValid) {
      setToast({ message: "Enter a valid amount", status: "error" });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category_id: categoryId,
          amount: parsedAmount,
          note: note.trim() ? note.trim() : null,
          location: businessWide ? null : location,
        }),
      });
      const body = await res.json();

      if (!res.ok) {
        setToast({ message: body.error ?? "Couldn't save the expense", status: "error" });
        return;
      }

      setAmount("");
      setNote("");
      setToast({ message: "Expense logged", status: "success" });
      await load();
    } catch {
      setToast({ message: "Couldn't reach the server — check your connection and try again.", status: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    setCategorySaving(true);
    setCategoryError(null);
    try {
      const res = await fetch("/api/expense-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCategoryName.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't add category");
      setNewCategoryName("");
      await load();
    } catch (err) {
      setCategoryError(err instanceof Error ? err.message : "Couldn't add category");
    } finally {
      setCategorySaving(false);
    }
  }

  async function toggleCategoryActive(category: ExpenseCategoryRow) {
    setCategoryError(null);
    try {
      const res = await fetch(`/api/expense-categories/${category.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !category.active }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't update category");
      await load();
    } catch (err) {
      setCategoryError(err instanceof Error ? err.message : "Couldn't update category");
    }
  }

  async function openCategoryDeleteModal(category: ExpenseCategoryRow) {
    setCategoryDeleteTarget(category);
    setCategoryDeleteConfirmText("");
    setCategoryDeleteError(null);
    setCategoryDeleteImpact(null);
    setCategoryDeleteImpactLoading(true);
    try {
      const res = await fetch(`/api/expense-categories/${category.id}/delete-impact`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setCategoryDeleteImpact(data.impact ?? null);
    } finally {
      setCategoryDeleteImpactLoading(false);
    }
  }

  async function confirmCategoryDelete() {
    if (!categoryDeleteTarget) return;
    setCategoryDeleting(true);
    setCategoryDeleteError(null);
    try {
      const res = await fetch(`/api/expense-categories/${categoryDeleteTarget.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to delete category");
      setCategoryDeleteTarget(null);
      setToast({ message: `${categoryDeleteTarget.name} deleted`, status: "success" });
      await load();
    } catch (err) {
      setCategoryDeleteError(err instanceof Error ? err.message : "Failed to delete category");
    } finally {
      setCategoryDeleting(false);
    }
  }

  function openEdit(expense: ExpenseRow) {
    setEditTarget(expense);
    setEditAmount(String(expense.amount));
    setEditNote(expense.note ?? "");
    setEditCategoryId(expense.category_id);
    setEditError(null);
  }

  async function confirmEdit() {
    if (!editTarget) return;
    const parsed = Number(editAmount);
    if (editAmount.trim() === "" || !Number.isFinite(parsed) || parsed < 0) {
      setEditError("Enter a valid amount");
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/expenses/${editTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category_id: editCategoryId,
          amount: parsed,
          note: editNote.trim() ? editNote.trim() : null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't save changes");
      setEditTarget(null);
      setToast({ message: "Expense updated", status: "success" });
      await load();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Couldn't save changes");
    } finally {
      setEditSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/expenses/${deleteTarget.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't delete expense");
      setDeleteTarget(null);
      setToast({ message: "Expense deleted", status: "success" });
      await load();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Couldn't delete expense");
    } finally {
      setDeleting(false);
    }
  }

  const periodTotal = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const periodLabel = period === "today" ? "Today's expenses" : period === "week" ? "This week's expenses" : "This month's expenses";

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={catalogStyles.title}>Expenses</h1>
          <Link href="/dashboard" className={styles.backLink}>
            ← Back to dashboard
          </Link>
        </div>
        <PeriodToggle options={PERIOD_OPTIONS} value={period} onChange={(v) => setPeriod(v as Period)} />
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Applies to</span>
          <CategoryChips
            options={LOCATION_OPTIONS}
            value={location}
            onChange={(value) => {
              setLocation(value as LocationChoice);
              setBusinessWide(false);
            }}
          />
          <button
            type="button"
            className={businessWide ? styles.businessWideToggleActive : styles.businessWideToggle}
            onClick={() => setBusinessWide((v) => !v)}
          >
            {businessWide ? "✓ " : ""}Business-wide expense (rent, salaries, etc.)
          </button>
        </div>

        <div className={styles.field}>
          <div className={styles.categoryFieldHeader}>
            <span className={styles.fieldLabel}>Category</span>
            <button type="button" className={styles.manageLink} onClick={() => setManageOpen(true)}>
              Manage
            </button>
          </div>
          <CategoryChips
            options={categories.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))}
            value={categoryId}
            onChange={setCategoryId}
          />
        </div>

        <Input
          label="Amount (KES)"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          numeric
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
        />

        <Input
          label="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. July rent, KPLC token top-up"
        />

        <Button type="submit" variant="primary" fullWidth disabled={submitting || !amountValid}>
          {submitting ? "Saving…" : "Add expense"}
        </Button>
      </form>

      {error && <p className={catalogStyles.formError}>{error}</p>}

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>{periodLabel}</h2>
          {expenses.length > 0 && <span className={styles.sectionTotal}>{money(periodTotal)}</span>}
        </div>

        {loading ? (
          <p className={styles.loading}>Loading…</p>
        ) : expenses.length === 0 ? (
          <EmptyState
            icon={<Icon name="expenses" size={48} />}
            heading="No expenses logged yet"
            body="Costs logged here or by staff on their own /expenses screen will show up in this list."
          />
        ) : (
          <>
            <Card className={`${catalogStyles.tableCard} ${catalogStyles.desktopOnly}`}>
              <table className={catalogStyles.table}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Applies to</th>
                    <th>Category</th>
                    <th>Note</th>
                    <th className={catalogStyles.numeric}>Amount</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((expense) => (
                    <tr key={expense.id}>
                      <td>{expense.expense_date}</td>
                      <td>{locationLabel(expense.location)}</td>
                      <td>{expense.expense_categories?.name ?? "Unknown category"}</td>
                      <td>{expense.note ?? "—"}</td>
                      <td className={catalogStyles.numeric}>{money(expense.amount)}</td>
                      <td>
                        <ActionMenu
                          aria-label={`Actions for expense — ${expense.expense_categories?.name ?? "expense"}`}
                          items={[
                            { label: "Edit", onClick: () => openEdit(expense) },
                            { label: "Delete", destructive: true, onClick: () => setDeleteTarget(expense) },
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <ul className={`${catalogStyles.cardList} ${catalogStyles.mobileOnly}`}>
              {expenses.map((expense) => (
                <li key={expense.id} className={catalogStyles.itemCard}>
                  <div className={catalogStyles.itemCardRow}>
                    <span className={catalogStyles.itemCardIdentity}>
                      <span className={styles.locationBadge}>{locationLabel(expense.location)}</span>
                      <span className={catalogStyles.itemCardName}>
                        {expense.expense_categories?.name ?? "Unknown category"}
                      </span>
                      <span className={catalogStyles.itemCardCategory}>
                        {expense.expense_date}
                        {expense.note ? ` · ${expense.note}` : ""}
                      </span>
                    </span>
                    <span className={catalogStyles.itemCardMetrics}>
                      <span className={catalogStyles.itemCardPrice}>{money(expense.amount)}</span>
                    </span>
                  </div>
                  <div className={styles.itemCardActionRow}>
                    <button type="button" className={catalogStyles.itemCardEditBtn} onClick={() => openEdit(expense)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className={`${catalogStyles.itemCardEditBtn} ${styles.itemCardDeleteBtn}`}
                      onClick={() => setDeleteTarget(expense)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* Category management — deliberately a modal, not its own page:
          rare action (add/rename/retire), kept one tap away from the
          quick-log form rather than permanently occupying screen space. */}
      <Modal open={manageOpen} onClose={() => setManageOpen(false)} title="Manage expense categories">
        <div className={catalogStyles.form}>
          <form className={styles.inlineForm} onSubmit={handleAddCategory}>
            <Input
              label="New category name"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="e.g. Rent, Salaries, Water"
            />
            <Button type="submit" variant="secondary" disabled={categorySaving || !newCategoryName.trim()}>
              {categorySaving ? "Adding…" : "Add"}
            </Button>
          </form>

          {categoryError && <p className={catalogStyles.formError}>{categoryError}</p>}

          <ul className={styles.categoryManageList}>
            {categories.map((category) => (
              <li key={category.id} className={styles.categoryManageRow}>
                <span className={category.active ? undefined : styles.categoryInactive}>{category.name}</span>
                <span className={styles.categoryManageActions}>
                  <button type="button" className={styles.manageLink} onClick={() => toggleCategoryActive(category)}>
                    {category.active ? "Retire" : "Reactivate"}
                  </button>
                  <button
                    type="button"
                    className={`${styles.manageLink} ${catalogStyles.itemCardDeleteBtn}`}
                    onClick={() => openCategoryDeleteModal(category)}
                  >
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Modal>

      {/* Category delete — permanent, extends items' hard-delete exception
          to expense_categories (client request, 2026-07-23). expenses.category_id
          is not null with no nullable escape, so deleting a category also
          deletes every expense row filed under it, retroactively changing
          past expense/profit figures — confirmed directly with the client
          before this was built. The impact preview below shows the real
          numbers so this isn't a surprise after the fact. See
          supabase/migrations/20260723100000_expense_category_hard_delete.sql. */}
      <Modal
        open={categoryDeleteTarget !== null}
        onClose={() => setCategoryDeleteTarget(null)}
        title={categoryDeleteTarget ? `Delete ${categoryDeleteTarget.name}?` : "Delete category"}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setCategoryDeleteTarget(null)}
              disabled={categoryDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={
                categoryDeleteConfirmText !== categoryDeleteTarget?.name ||
                categoryDeleting ||
                categoryDeleteImpactLoading
              }
              onClick={confirmCategoryDelete}
            >
              {categoryDeleting ? "Deleting…" : "Delete permanently"}
            </Button>
          </>
        }
      >
        <div className={catalogStyles.form}>
          <p className={styles.deleteWarning}>
            This permanently removes the category and cannot be undone.
          </p>

          {categoryDeleteImpactLoading && <p>Checking what this will affect…</p>}

          {categoryDeleteImpact && (
            <ul className={catalogStyles.deleteImpactList}>
              {categoryDeleteImpact.expenses_count > 0 ? (
                <li>
                  <strong>{categoryDeleteImpact.expenses_count}</strong> expense
                  {categoryDeleteImpact.expenses_count === 1 ? "" : "s"} totaling{" "}
                  <strong>{money(categoryDeleteImpact.expenses_value)}</strong> filed under this
                  category — this will change already-closed days&rsquo; expense and profit
                  totals.
                </li>
              ) : (
                <li>No expenses found under this category — nothing else will be affected.</li>
              )}
            </ul>
          )}

          {categoryDeleteError && <p className={catalogStyles.formError}>{categoryDeleteError}</p>}

          <Input
            label="Confirm name"
            value={categoryDeleteConfirmText}
            onChange={(e) => setCategoryDeleteConfirmText(e.target.value)}
          />
        </div>
      </Modal>

      {/* Edit — admin-only correction in place (expenses_update_admin_only
          RLS), same append-only-but-correctable convention as
          stock_entries/ingredient_entries: a mistake is fixed, not
          silently disappeared. */}
      <Modal
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        title="Edit expense"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditTarget(null)} disabled={editSaving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirmEdit} disabled={editSaving}>
              {editSaving ? "Saving…" : "Save changes"}
            </Button>
          </>
        }
      >
        <div className={catalogStyles.form}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Category</span>
            <CategoryChips
              options={categories.filter((c) => c.active || c.id === editCategoryId).map((c) => ({ value: c.id, label: c.name }))}
              value={editCategoryId}
              onChange={setEditCategoryId}
            />
          </div>
          <Input
            label="Amount (KES)"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            numeric
            value={editAmount}
            onChange={(e) => setEditAmount(e.target.value)}
          />
          <Input label="Note (optional)" value={editNote} onChange={(e) => setEditNote(e.target.value)} />
          {editError && <p className={catalogStyles.formError}>{editError}</p>}
        </div>
      </Modal>

      {/* Delete — admin-only, expenses_delete_admin_only RLS. No derived
          value to unwind (unlike a purchase's weighted-average cost),
          so this is a plain removal, gated only by this confirmation. */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        title="Delete this expense?"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setDeleteTarget(null);
                setDeleteError(null);
              }}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete expense"}
            </Button>
          </>
        }
      >
        <div className={catalogStyles.form}>
          <p className={styles.deleteWarning}>
            This removes the{" "}
            <strong>{money(deleteTarget?.amount ?? 0)}</strong>{" "}
            {deleteTarget?.expense_categories?.name ?? "expense"} entry logged{" "}
            {deleteTarget?.expense_date}. This can&rsquo;t be undone.
          </p>
          {deleteError && <p className={catalogStyles.formError}>{deleteError}</p>}
        </div>
      </Modal>

      {toast && <Toast message={toast.message} status={toast.status} onDismiss={() => setToast(null)} />}
    </div>
  );
}
