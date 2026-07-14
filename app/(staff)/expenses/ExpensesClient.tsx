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
import styles from "./expenses.module.css";

type ExpenseRow = Database["public"]["Tables"]["expenses"]["Row"];
type ExpenseCategory = Database["public"]["Enums"]["expense_category"];

const CATEGORY_OPTIONS: { value: ExpenseCategory; label: string }[] = [
  { value: "electricity", label: "Electricity" },
  { value: "gas", label: "Gas" },
  { value: "charcoal", label: "Charcoal" },
  { value: "other", label: "Other" },
];

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
  const today = todayISO();
  const [category, setCategory] = useState<ExpenseCategory>("electricity");
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

      setExpenses(body.expenses ?? []);
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
          category,
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
        <h1 className={styles.title}>Expenses</h1>
        <p className={styles.dateLabel}>{today}</p>
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Category</span>
          <CategoryChips
            options={CATEGORY_OPTIONS}
            value={category}
            onChange={(value) => setCategory(value as ExpenseCategory)}
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
                    {CATEGORY_OPTIONS.find((c) => c.value === expense.category)?.label ?? expense.category}
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
    </div>
  );
}
