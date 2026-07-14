"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Card } from "@/components/Card";
import { Modal } from "@/components/Modal";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { Toast } from "@/components/Toast";
import { itemSchema, type ItemInput } from "@/lib/validation";
import type { Database } from "@/lib/supabase/types";
import styles from "../catalog.module.css";

type Item = Database["public"]["Tables"]["items"]["Row"];
type ItemCategory = Database["public"]["Enums"]["item_category"];
type ItemSupplyType = Database["public"]["Enums"]["item_supply_type"];

const CATEGORY_LABELS: Record<ItemCategory, string> = {
  beverages: "Beverages",
  snacks: "Snacks",
  meals: "Meals",
  fruits: "Fruits",
  cyber: "Cyber",
  retail: "Retail",
  ingredients: "Ingredients",
  stationery: "Stationery",
  dawa: "Dawa",
  sweets: "Sweets",
  biscuits: "Biscuits",
  packing_supplies: "Packing Supplies",
  others: "Others",
};

const SUPPLY_TYPE_LABELS: Record<ItemSupplyType, string> = {
  restaurant_only: "Restaurant only",
  canteen_supplied: "Restaurant → Canteen",
  canteen_independent: "Canteen independent",
};

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS) as [ItemCategory, string][];
const SUPPLY_TYPE_OPTIONS = Object.entries(SUPPLY_TYPE_LABELS) as [ItemSupplyType, string][];

const emptyForm: ItemInput = {
  name: "",
  category: "meals",
  supply_type: "restaurant_only",
  buying_price: 0,
  selling_price: 0,
  low_stock_threshold: 5,
  active: true,
};

export function ItemsClient({ initialItems }: { initialItems: Item[] }) {
  const [items, setItems] = useState<Item[]>(initialItems);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ItemInput>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof ItemInput, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function openAddModal() {
    setEditingId(null);
    setForm(emptyForm);
    setFieldErrors({});
    setModalOpen(true);
  }

  function openEditModal(item: Item) {
    setEditingId(item.id);
    setForm({
      name: item.name,
      category: item.category,
      supply_type: item.supply_type,
      buying_price: item.buying_price,
      selling_price: item.selling_price,
      low_stock_threshold: item.low_stock_threshold,
      active: item.active,
    });
    setFieldErrors({});
    setModalOpen(true);
  }

  async function handleSubmit() {
    const parsed = itemSchema.safeParse(form);
    if (!parsed.success) {
      const errors: Partial<Record<keyof ItemInput, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof ItemInput;
        errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const url = editingId ? `/api/items/${editingId}` : "/api/items";
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

      const saved: Item = data.item;
      setItems((prev) =>
        editingId ? prev.map((i) => (i.id === saved.id ? saved : i)) : [...prev, saved],
      );
      setModalOpen(false);
      setToast(editingId ? "Item updated" : "Item added");
    } catch {
      setFieldErrors({ name: "Couldn't reach the server — check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Item Master</h1>
        <Button variant="primary" onClick={openAddModal}>
          Add item
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<Icon name="items" size={48} />}
          heading="No items yet"
          body="Add your first menu item to get started."
          actionLabel="Add item"
          onAction={openAddModal}
        />
      ) : (
        <Card className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Supply type</th>
                <th className={styles.numeric}>Buying</th>
                <th className={styles.numeric}>Selling</th>
                <th className={styles.numeric}>Low stock at</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{CATEGORY_LABELS[item.category]}</td>
                  <td>{SUPPLY_TYPE_LABELS[item.supply_type]}</td>
                  <td className={styles.numeric}>KES {item.buying_price.toFixed(2)}</td>
                  <td className={styles.numeric}>KES {item.selling_price.toFixed(2)}</td>
                  <td className={styles.numeric}>{item.low_stock_threshold}</td>
                  <td>
                    <span className={item.active ? styles.badgeActive : styles.badgeInactive}>
                      {item.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={styles.editLink}
                      onClick={() => openEditModal(item)}
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
        title={editingId ? "Edit item" : "Add item"}
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

          <label className={styles.selectField}>
            <span className={styles.selectLabel}>Category</span>
            <select
              className={styles.select}
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as ItemCategory })}
            >
              {CATEGORY_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.selectField}>
            <span className={styles.selectLabel}>Supply type</span>
            <select
              className={styles.select}
              value={form.supply_type}
              onChange={(e) =>
                setForm({ ...form, supply_type: e.target.value as ItemSupplyType })
              }
            >
              {SUPPLY_TYPE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

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
            label="Selling price (KES)"
            type="number"
            min="0"
            step="0.01"
            numeric
            value={form.selling_price}
            onChange={(e) => setForm({ ...form, selling_price: Number(e.target.value) })}
            error={fieldErrors.selling_price}
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
