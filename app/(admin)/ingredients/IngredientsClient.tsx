"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Card } from "@/components/Card";
import { Modal } from "@/components/Modal";
import { EmptyState } from "@/components/EmptyState";
import { Toast } from "@/components/Toast";
import { ingredientSchema, type IngredientInput } from "@/lib/validation";
import type { Database } from "@/lib/supabase/types";
import styles from "../catalog.module.css";

type Ingredient = Database["public"]["Tables"]["ingredients"]["Row"];

const emptyForm: IngredientInput = {
  name: "",
  unit: "",
  buying_price: 0,
  low_stock_threshold: 5,
  active: true,
};

export function IngredientsClient({ initialIngredients }: { initialIngredients: Ingredient[] }) {
  const [ingredients, setIngredients] = useState<Ingredient[]>(initialIngredients);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<IngredientInput>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof IngredientInput, string>>>(
    {},
  );
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function openAddModal() {
    setEditingId(null);
    setForm(emptyForm);
    setFieldErrors({});
    setModalOpen(true);
  }

  function openEditModal(ingredient: Ingredient) {
    setEditingId(ingredient.id);
    setForm({
      name: ingredient.name,
      unit: ingredient.unit,
      buying_price: ingredient.buying_price,
      low_stock_threshold: ingredient.low_stock_threshold,
      active: ingredient.active,
    });
    setFieldErrors({});
    setModalOpen(true);
  }

  async function handleSubmit() {
    const parsed = ingredientSchema.safeParse(form);
    if (!parsed.success) {
      const errors: Partial<Record<keyof IngredientInput, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof IngredientInput;
        errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const url = editingId ? `/api/ingredients/${editingId}` : "/api/ingredients";
      const method = editingId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setFieldErrors({ name: data.error ?? "Something went wrong" });
        return;
      }

      const saved: Ingredient = data.ingredient;
      setIngredients((prev) =>
        editingId ? prev.map((i) => (i.id === saved.id ? saved : i)) : [...prev, saved],
      );
      setModalOpen(false);
      setToast(editingId ? "Ingredient updated" : "Ingredient added");
    } catch {
      setFieldErrors({ name: "Couldn't reach the server — check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Ingredient Catalog</h1>
        <Button variant="primary" onClick={openAddModal}>
          Add ingredient
        </Button>
      </div>

      {ingredients.length === 0 ? (
        <EmptyState
          icon={<span aria-hidden>+</span>}
          heading="No ingredients yet"
          body="Add your first raw material to get started."
          actionLabel="Add ingredient"
          onAction={openAddModal}
        />
      ) : (
        <Card className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Unit</th>
                <th className={styles.numeric}>Buying price</th>
                <th className={styles.numeric}>Low stock at</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {ingredients.map((ingredient) => (
                <tr key={ingredient.id}>
                  <td>{ingredient.name}</td>
                  <td>{ingredient.unit}</td>
                  <td className={styles.numeric}>KES {ingredient.buying_price.toFixed(2)}</td>
                  <td className={styles.numeric}>{ingredient.low_stock_threshold}</td>
                  <td>
                    <span
                      className={ingredient.active ? styles.badgeActive : styles.badgeInactive}
                    >
                      {ingredient.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={styles.editLink}
                      onClick={() => openEditModal(ingredient)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? "Edit ingredient" : "Add ingredient"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className={styles.form}>
          <Input
            label="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            error={fieldErrors.name}
          />

          <Input
            label="Unit (e.g. kg, litre, bag)"
            value={form.unit}
            onChange={(e) => setForm({ ...form, unit: e.target.value })}
            error={fieldErrors.unit}
          />

          <Input
            label="Buying price (KES)"
            type="number"
            min="0"
            step="0.01"
            numeric
            value={form.buying_price}
            onChange={(e) => setForm({ ...form, buying_price: Number(e.target.value) })}
            error={fieldErrors.buying_price}
          />

          <Input
            label="Low stock alert threshold"
            type="number"
            min="0"
            step="1"
            numeric
            value={form.low_stock_threshold}
            onChange={(e) => setForm({ ...form, low_stock_threshold: Number(e.target.value) })}
            error={fieldErrors.low_stock_threshold}
          />

          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            <span>Active</span>
          </label>
        </div>
      </Modal>

      {toast && <Toast message={toast} status="success" onDismiss={() => setToast(null)} />}
    </div>
  );
}
