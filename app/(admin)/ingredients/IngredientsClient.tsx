"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Card } from "@/components/Card";
import { Drawer } from "@/components/Drawer";
import { FormSection } from "@/components/FormSection";
import { FilterBar } from "@/components/FilterBar";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { Toast } from "@/components/Toast";
import { ActionMenu } from "@/components/ActionMenu";
import { Modal } from "@/components/Modal";
import { ingredientSchema, type IngredientInput } from "@/lib/validation";
import type { Database } from "@/lib/supabase/types";
import styles from "../catalog.module.css";

interface DeleteImpact {
  ingredient_entries_count: number;
  ingredient_entries_closing_value: number;
  ingredient_purchases_count: number;
  ingredient_purchases_value: number;
}

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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<IngredientInput>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof IngredientInput, string>>>(
    {},
  );
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const [deleteTarget, setDeleteTarget] = useState<Ingredient | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<DeleteImpact | null>(null);
  const [deleteImpactLoading, setDeleteImpactLoading] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function openDeleteModal(ingredient: Ingredient) {
    setDeleteTarget(ingredient);
    setDeleteConfirmText("");
    setDeleteError(null);
    setDeleteImpact(null);
    setDeleteImpactLoading(true);
    try {
      const res = await fetch(`/api/ingredients/${ingredient.id}/delete-impact`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setDeleteImpact(data.impact ?? null);
    } finally {
      setDeleteImpactLoading(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/ingredients/${deleteTarget.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to delete ingredient");
      setIngredients((prev) => prev.filter((i) => i.id !== deleteTarget.id));
      setDeleteTarget(null);
      setToast(`${deleteTarget.name} deleted`);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete ingredient");
    } finally {
      setDeleting(false);
    }
  }

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const filteredIngredients = useMemo(() => {
    return ingredients.filter((ingredient) => {
      if (search && !ingredient.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (statusFilter === "active" && !ingredient.active) return false;
      if (statusFilter === "inactive" && ingredient.active) return false;
      return true;
    });
  }, [ingredients, search, statusFilter]);

  function openAddDrawer() {
    setEditingId(null);
    setForm(emptyForm);
    setFieldErrors({});
    setDrawerOpen(true);
  }

  function openEditDrawer(ingredient: Ingredient) {
    setEditingId(ingredient.id);
    setForm({
      name: ingredient.name,
      unit: ingredient.unit,
      buying_price: ingredient.buying_price,
      low_stock_threshold: ingredient.low_stock_threshold,
      active: ingredient.active,
    });
    setFieldErrors({});
    setDrawerOpen(true);
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
      setDrawerOpen(false);
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
        <Button variant="primary" onClick={openAddDrawer}>
          Add ingredient
        </Button>
      </div>

      <div className={styles.toolbarRow}>
        <FilterBar
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value);
            setExpandedIds(new Set());
          }}
          searchPlaceholder="Search ingredients…"
          filters={[
            {
              value: statusFilter,
              onChange: (value) => {
                setStatusFilter(value);
                setExpandedIds(new Set());
              },
              "aria-label": "Filter by status",
              options: [
                { value: "", label: "All status" },
                { value: "active", label: "Active" },
                { value: "inactive", label: "Inactive" },
              ],
            },
          ]}
        />
      </div>

      {ingredients.length === 0 ? (
        <EmptyState
          icon={<Icon name="ingredients" size={48} />}
          heading="No ingredients yet"
          body="Add your first raw material to get started."
          actionLabel="Add ingredient"
          onAction={openAddDrawer}
        />
      ) : filteredIngredients.length === 0 ? (
        <EmptyState
          icon={<Icon name="ingredients" size={48} />}
          heading="No ingredients match your filters"
          body="Try a different search term or clear a filter."
        />
      ) : (
        <>
          <Card className={`${styles.tableCard} ${styles.desktopOnly}`}>
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
                {filteredIngredients.map((ingredient) => (
                  <tr key={ingredient.id}>
                    <td>{ingredient.name}</td>
                    <td>{ingredient.unit}</td>
                    <td className={styles.numeric}>KES {ingredient.buying_price.toFixed(2)}</td>
                    <td className={styles.numeric}>{ingredient.low_stock_threshold}</td>
                    <td>
                      <span className={styles.statusCell}>
                        <span
                          className={`${styles.statusDot} ${
                            ingredient.active ? styles.statusDotActive : styles.statusDotInactive
                          }`}
                        />
                        {ingredient.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <ActionMenu
                        aria-label={`Actions for ${ingredient.name}`}
                        items={[
                          { label: "Edit", onClick: () => openEditDrawer(ingredient) },
                          {
                            label: "Delete",
                            destructive: true,
                            onClick: () => openDeleteModal(ingredient),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <ul className={`${styles.cardList} ${styles.mobileOnly}`}>
            {filteredIngredients.map((ingredient) => {
              const isOpen = expandedIds.has(ingredient.id);
              return (
                <li key={ingredient.id} className={styles.itemCard}>
                  <button
                    type="button"
                    className={styles.itemCardRow}
                    aria-expanded={isOpen}
                    onClick={() => toggleExpanded(ingredient.id)}
                  >
                    <span className={styles.itemCardIdentity}>
                      <span className={styles.itemCardName}>{ingredient.name}</span>
                      <span className={styles.itemCardCategory}>{ingredient.unit}</span>
                    </span>
                    <span className={styles.itemCardMetrics}>
                      <span className={styles.itemCardPrice}>
                        KES {ingredient.buying_price.toFixed(2)}
                      </span>
                    </span>
                    <span
                      className={`${styles.itemCardStatusDot} ${
                        ingredient.active ? styles.statusDotActive : styles.statusDotInactive
                      }`}
                      title={ingredient.active ? "Active" : "Inactive"}
                    />
                    <span
                      className={`${styles.itemCardChevron} ${
                        isOpen ? styles.itemCardChevronOpen : ""
                      }`}
                    >
                      <Icon name="chevron-right" size={20} />
                    </span>
                  </button>

                  <div
                    className={`${styles.itemCardDetails} ${
                      isOpen ? styles.itemCardDetailsOpen : ""
                    }`}
                  >
                    <div className={styles.itemCardDetailsInner}>
                      <div className={styles.itemCardDetailLine}>
                        <span>Low stock at</span>
                        <strong>{ingredient.low_stock_threshold}</strong>
                      </div>
                      <div className={styles.itemCardDetailLine}>
                        <span>Status</span>
                        <strong>{ingredient.active ? "Active" : "Inactive"}</strong>
                      </div>
                      <div className={styles.itemCardFooter}>
                        <button
                          type="button"
                          className={styles.itemCardEditBtn}
                          onClick={() => openEditDrawer(ingredient)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={`${styles.itemCardEditBtn} ${styles.itemCardDeleteBtn}`}
                          onClick={() => openDeleteModal(ingredient)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editingId ? "Edit ingredient" : "Add ingredient"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDrawerOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Saving…" : "Save ingredient"}
            </Button>
          </>
        }
      >
        <FormSection label="Identity">
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
        </FormSection>

        <FormSection label="Pricing">
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
        </FormSection>

        <FormSection label="Stock behavior">
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
        </FormSection>

        <FormSection label="Status">
          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            <span>Active</span>
          </label>
        </FormSection>
      </Drawer>

      {/* Delete — permanent, extends items' hard-delete exception to
          ingredients (client request, 2026-07-23, triggered by the
          "Smokies" ingredient mistakenly tracked as both a menu item and
          a raw ingredient). Also deletes every ingredient_entries/
          ingredient_purchases row referencing this ingredient,
          retroactively changing past Ledger/dashboard figures — confirmed
          directly with the client before this was built. The impact
          preview below shows the real numbers so this isn't a surprise
          after the fact. See
          supabase/migrations/20260723080000_ingredient_hard_delete.sql. */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={deleteTarget ? `Delete ${deleteTarget.name}?` : "Delete ingredient"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteConfirmText !== deleteTarget?.name || deleting || deleteImpactLoading}
              onClick={confirmDelete}
            >
              {deleting ? "Deleting…" : "Delete permanently"}
            </Button>
          </>
        }
      >
        <div className={styles.form}>
          <p className={styles.deleteWarning}>
            This permanently removes the ingredient and cannot be undone.
          </p>

          {deleteImpactLoading && <p>Checking what this will affect…</p>}

          {deleteImpact && (
            <ul className={styles.deleteImpactList}>
              {deleteImpact.ingredient_entries_count > 0 && (
                <li>
                  <strong>{deleteImpact.ingredient_entries_count}</strong> ingredient ledger entr
                  {deleteImpact.ingredient_entries_count === 1 ? "y" : "ies"} totaling{" "}
                  <strong>KES {deleteImpact.ingredient_entries_closing_value.toFixed(2)}</strong> in
                  closing stock value — this will change already-closed days&rsquo; Ledger and
                  dashboard totals.
                </li>
              )}
              {deleteImpact.ingredient_purchases_count > 0 && (
                <li>
                  <strong>{deleteImpact.ingredient_purchases_count}</strong> ingredient purchase
                  {deleteImpact.ingredient_purchases_count === 1 ? "" : "s"} totaling{" "}
                  <strong>KES {deleteImpact.ingredient_purchases_value.toFixed(2)}</strong>.
                </li>
              )}
              {deleteImpact.ingredient_entries_count === 0 &&
                deleteImpact.ingredient_purchases_count === 0 && (
                  <li>No history found for this ingredient — nothing else will be affected.</li>
                )}
            </ul>
          )}

          {deleteError && <p className={styles.formError}>{deleteError}</p>}

          <Input
            label="Confirm name"
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
          />
        </div>
      </Modal>

      {toast && <Toast message={toast} status="success" onDismiss={() => setToast(null)} />}
    </div>
  );
}
