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

function marginPercent(buying: number, selling: number): number | null {
  if (!selling) return null;
  return ((selling - buying) / selling) * 100;
}

// Illustrative bands for the mobile card's at-a-glance margin color —
// confirm real thresholds with the client before treating these as final.
function marginBand(margin: number | null): "good" | "mid" | "low" | null {
  if (margin === null) return null;
  if (margin >= 40) return "good";
  if (margin >= 20) return "mid";
  return "low";
}

const MARGIN_BAND_CLASS = {
  good: "itemCardMarginGood",
  mid: "itemCardMarginMid",
  low: "itemCardMarginLow",
} as const;

export function ItemsClient({ initialItems }: { initialItems: Item[] }) {
  const [items, setItems] = useState<Item[]>(initialItems);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ItemInput>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof ItemInput, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

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

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (categoryFilter && item.category !== categoryFilter) return false;
      if (locationFilter === "restaurant" && item.supply_type === "canteen_independent") return false;
      if (locationFilter === "canteen" && item.supply_type === "restaurant_only") return false;
      return true;
    });
  }, [items, search, categoryFilter, locationFilter]);

  const formMargin = marginPercent(form.buying_price, form.selling_price);

  function openAddDrawer() {
    setEditingId(null);
    setForm(emptyForm);
    setFieldErrors({});
    setDrawerOpen(true);
  }

  function openEditDrawer(item: Item) {
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
    setDrawerOpen(true);
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
      setDrawerOpen(false);
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
        <Button variant="primary" onClick={openAddDrawer}>
          Add item
        </Button>
      </div>

      <div className={styles.toolbarRow}>
        <FilterBar
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value);
            setExpandedIds(new Set());
          }}
          searchPlaceholder="Search menu items…"
          filters={[
            {
              value: locationFilter,
              onChange: (value) => {
                setLocationFilter(value);
                setExpandedIds(new Set());
              },
              "aria-label": "Filter by location",
              options: [
                { value: "", label: "All locations" },
                { value: "restaurant", label: "Restaurant" },
                { value: "canteen", label: "Canteen" },
              ],
            },
            {
              value: categoryFilter,
              onChange: (value) => {
                setCategoryFilter(value);
                setExpandedIds(new Set());
              },
              "aria-label": "Filter by category",
              options: [
                { value: "", label: "All categories" },
                ...CATEGORY_OPTIONS.map(([value, label]) => ({ value, label })),
              ],
            },
          ]}
        />
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<Icon name="items" size={48} />}
          heading="No items yet"
          body="Add your first menu item to get started."
          actionLabel="Add item"
          onAction={openAddDrawer}
        />
      ) : filteredItems.length === 0 ? (
        <EmptyState
          icon={<Icon name="items" size={48} />}
          heading="No items match your filters"
          body="Try a different search term or clear a filter."
        />
      ) : (
        <>
          <Card className={`${styles.tableCard} ${styles.desktopOnly}`}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Supply type</th>
                  <th className={styles.numeric}>Buying</th>
                  <th className={styles.numeric}>Selling</th>
                  <th className={styles.numeric}>Margin</th>
                  <th className={styles.numeric}>Low stock at</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const margin = marginPercent(item.buying_price, item.selling_price);
                  return (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>{CATEGORY_LABELS[item.category]}</td>
                      <td>{SUPPLY_TYPE_LABELS[item.supply_type]}</td>
                      <td className={styles.numeric}>KES {item.buying_price.toFixed(2)}</td>
                      <td className={styles.numeric}>KES {item.selling_price.toFixed(2)}</td>
                      <td className={styles.numeric}>
                        {margin === null ? "—" : `${margin.toFixed(1)}%`}
                      </td>
                      <td className={styles.numeric}>{item.low_stock_threshold}</td>
                      <td>
                        <span className={styles.statusCell}>
                          <span
                            className={`${styles.statusDot} ${
                              item.active ? styles.statusDotActive : styles.statusDotInactive
                            }`}
                          />
                          {item.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className={styles.editLink}
                          onClick={() => openEditDrawer(item)}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <ul className={`${styles.cardList} ${styles.mobileOnly}`}>
            {filteredItems.map((item) => {
              const margin = marginPercent(item.buying_price, item.selling_price);
              const band = marginBand(margin);
              const isOpen = expandedIds.has(item.id);
              return (
                <li key={item.id} className={styles.itemCard}>
                  <button
                    type="button"
                    className={styles.itemCardRow}
                    aria-expanded={isOpen}
                    onClick={() => toggleExpanded(item.id)}
                  >
                    <span className={styles.itemCardIdentity}>
                      <span className={styles.itemCardName}>{item.name}</span>
                      <span className={styles.itemCardCategory}>
                        {CATEGORY_LABELS[item.category]}
                      </span>
                    </span>
                    <span className={styles.itemCardMetrics}>
                      <span className={styles.itemCardPrice}>
                        KES {item.selling_price.toFixed(2)}
                      </span>
                      {margin !== null && band && (
                        <span
                          className={`${styles.itemCardMargin} ${styles[MARGIN_BAND_CLASS[band]]}`}
                        >
                          {margin.toFixed(1)}%
                        </span>
                      )}
                    </span>
                    <span
                      className={`${styles.itemCardStatusDot} ${
                        item.active ? styles.statusDotActive : styles.statusDotInactive
                      }`}
                      title={item.active ? "Active" : "Inactive"}
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
                        <span>Buying price</span>
                        <strong>KES {item.buying_price.toFixed(2)}</strong>
                      </div>
                      <div className={styles.itemCardDetailLine}>
                        <span>Supply type</span>
                        <strong>{SUPPLY_TYPE_LABELS[item.supply_type]}</strong>
                      </div>
                      <div className={styles.itemCardDetailLine}>
                        <span>Low stock at</span>
                        <strong>{item.low_stock_threshold}</strong>
                      </div>
                      <div className={styles.itemCardFooter}>
                        <button
                          type="button"
                          className={styles.itemCardEditBtn}
                          onClick={() => openEditDrawer(item)}
                        >
                          Edit
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
        title={editingId ? "Edit item" : "Add item"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDrawerOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Saving…" : "Save item"}
            </Button>
          </>
        }
      >
        <FormSection label="Identity">
          <Input
            label="Item name"
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

          <p className={styles.marginHint}>
            Margin:{" "}
            <strong>{formMargin === null ? "—" : `${formMargin.toFixed(1)}%`}</strong>
          </p>
        </FormSection>

        <FormSection label="Stock behavior">
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

      {toast && <Toast message={toast} status="success" onDismiss={() => setToast(null)} />}
    </div>
  );
}
