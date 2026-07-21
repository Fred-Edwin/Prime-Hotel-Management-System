"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { CategoryChips } from "@/components/CategoryChips";
import { Input } from "@/components/Input";
import { Toast } from "@/components/Toast";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { nairobiToday } from "@/lib/calculations";
import type { Database } from "@/lib/supabase/types";
import { StaffMealsClient } from "./StaffMealsClient";
import styles from "./expenses.module.css";

type Tab = "expenses" | "staff_meals";

type ExpenseRow = Database["public"]["Tables"]["expenses"]["Row"] & {
  expense_categories: { id: string; name: string } | null;
};
type ExpenseCategoryRow = Database["public"]["Tables"]["expense_categories"]["Row"];

function todayISO(): string {
  return nairobiToday();
}

/**
 * Expense logging screen — a forms/CRUD lens, not the POS/retail lens
 * Phase 4's entry screens used: expenses are logged sporadically, one at
 * a time, not as a fixed daily sheet of rows to sweep through. Single
 * submit + running list of today's already-logged expenses below (see
 * docs/phases/phase5_context.md for why this diverges from the
 * till-strip batch-save pattern).
 */
export function ExpensesClient() {
  const [tab, setTab] = useState<Tab>("expenses");
  const today = todayISO();
  const [categories, setCategories] = useState<ExpenseCategoryRow[]>([]);
  const [categoryId, setCategoryId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; status: "success" | "error" } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const res = await fetch(`/api/expenses?date=${today}`);
      const body = await res.json();
      if (cancelled) return;

      if (!res.ok) {
        setToast({ message: body.error ?? "Couldn't load today's expenses", status: "error" });
        setLoading(false);
        return;
      }

      const fetchedCategories = (body.expenseCategories ?? []) as ExpenseCategoryRow[];
      setExpenses(body.expenses ?? []);
      setCategories(fetchedCategories);
      setCategoryId((current) => current || fetchedCategories[0]?.id || "");
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [today]);

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
        }),
      });
      const body = await res.json();

      if (!res.ok) {
        setToast({ message: body.error ?? "Couldn't save the expense", status: "error" });
        return;
      }

      setExpenses((prev) => [body.expense as ExpenseRow, ...prev]);
      setAmount("");
      setNote("");
      setToast({ message: "Expense logged", status: "success" });
    } catch {
      setToast({ message: "Couldn't reach the server — check your connection and try again.", status: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  const todayTotal = expenses.reduce((sum, expense) => sum + expense.amount, 0);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>{tab === "expenses" ? "Expenses" : "Staff meals"}</h1>
        <p className={styles.dateLabel}>{today}</p>
      </div>

      <div className={styles.field}>
        <CategoryChips
          options={[
            { value: "expenses", label: "Expenses" },
            { value: "staff_meals", label: "Staff meals" },
          ]}
          value={tab}
          onChange={(value) => setTab(value as Tab)}
        />
      </div>

      {tab === "staff_meals" ? (
        <StaffMealsClient />
      ) : (
        <>
          <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Category</span>
          <CategoryChips
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
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
          placeholder="e.g. KPLC token top-up"
        />

        <Button type="submit" variant="primary" fullWidth disabled={submitting || !amountValid}>
          {submitting ? "Saving…" : "Add expense"}
        </Button>
      </form>

      <div className={styles.listSection}>
        <div className={styles.listHeader}>
          <h2 className={styles.listTitle}>Today&apos;s expenses</h2>
          {expenses.length > 0 && (
            <span className={styles.listTotal}>KES {todayTotal.toFixed(2)}</span>
          )}
        </div>

        {loading ? (
          <p className={styles.loading}>Loading…</p>
        ) : expenses.length === 0 ? (
          <EmptyState
            icon={<Icon name="expenses" size={48} />}
            heading="No expenses logged yet"
            body="Costs you log today (electricity, gas, charcoal, other) will show up here."
          />
        ) : (
          <ul className={styles.expenseList}>
            {expenses.map((expense) => (
              <li key={expense.id} className={styles.expenseRow}>
                <div>
                  <p className={styles.expenseCategory}>
                    {expense.expense_categories?.name ?? "Unknown category"}
                  </p>
                  {expense.note && <p className={styles.expenseNote}>{expense.note}</p>}
                </div>
                <span className={styles.expenseAmount}>KES {expense.amount.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        )}
          </div>

          {toast && <Toast message={toast.message} status={toast.status} onDismiss={() => setToast(null)} />}
        </>
      )}
    </div>
  );
}
