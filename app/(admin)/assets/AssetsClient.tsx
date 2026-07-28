"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Select } from "@/components/Select";
import { Card } from "@/components/Card";
import { Drawer } from "@/components/Drawer";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { Toast } from "@/components/Toast";
import { ActionMenu } from "@/components/ActionMenu";
import { Modal } from "@/components/Modal";
import { AssetEventModal } from "@/components/AssetEventModal/AssetEventModal";
import { assetSchema, type AssetInput } from "@/lib/validation";
import type { Database } from "@/lib/supabase/types";
import styles from "../catalog.module.css";

type Asset = Database["public"]["Tables"]["assets"]["Row"] & {
  quantity_on_hand: number;
  value: number;
};

interface DeleteImpact {
  events_affected_count: number;
  events_total_value: number;
}

const emptyForm: AssetInput = {
  name: "",
  category: "",
  location: null,
  unit_cost: 0,
  low_stock_threshold: null,
  active: true,
};

const locationOptions = [
  { value: "", label: "Shared (both locations)" },
  { value: "restaurant", label: "Restaurant" },
  { value: "canteen", label: "Canteen" },
];

export function AssetsClient({ initialAssets }: { initialAssets: Asset[] }) {
  const [assets, setAssets] = useState<Asset[]>(initialAssets);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AssetInput>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof AssetInput, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const [eventModal, setEventModal] = useState<{ asset: Asset; type: "purchase" | "loss" } | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<DeleteImpact | null>(null);
  const [deleteImpactLoading, setDeleteImpactLoading] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function openDeleteModal(asset: Asset) {
    setDeleteTarget(asset);
    setDeleteConfirmText("");
    setDeleteError(null);
    setDeleteImpact(null);
    setDeleteImpactLoading(true);
    try {
      const res = await fetch(`/api/assets/${asset.id}/delete-impact`);
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
      const res = await fetch(`/api/assets/${deleteTarget.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to delete asset");
      setAssets((prev) => prev.filter((a) => a.id !== deleteTarget.id));
      setDeleteTarget(null);
      setToast(`${deleteTarget.name} deleted`);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete asset");
    } finally {
      setDeleting(false);
    }
  }

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openAddModal() {
    setEditingId(null);
    setForm(emptyForm);
    setFieldErrors({});
    setDrawerOpen(true);
  }

  function openEditModal(asset: Asset) {
    setEditingId(asset.id);
    setForm({
      name: asset.name,
      category: asset.category,
      location: asset.location,
      unit_cost: asset.unit_cost,
      low_stock_threshold: asset.low_stock_threshold,
      active: asset.active,
    });
    setFieldErrors({});
    setDrawerOpen(true);
  }

  async function refreshAssets() {
    const res = await fetch("/api/assets");
    const data = await res.json().catch(() => ({}));
    if (res.ok) setAssets(data.assets ?? []);
  }

  async function handleSubmit() {
    const parsed = assetSchema.safeParse(form);
    if (!parsed.success) {
      const errors: Partial<Record<keyof AssetInput, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof AssetInput;
        errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const url = editingId ? `/api/assets/${editingId}` : "/api/assets";
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

      setDrawerOpen(false);
      setToast(editingId ? "Asset updated" : "Asset added");
      await refreshAssets();
    } catch {
      setFieldErrors({ name: "Couldn't reach the server — check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
  }

  function locationLabel(location: Asset["location"]) {
    if (location === "restaurant") return "Restaurant";
    if (location === "canteen") return "Canteen";
    return "Shared";
  }

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Assets</h1>
        <Button variant="primary" onClick={openAddModal}>
          Add asset
        </Button>
      </div>

      {assets.length === 0 ? (
        <EmptyState
          icon={<Icon name="ingredients" size={48} />}
          heading="No assets yet"
          body="Add utensils, cookware, or other equipment to start tracking them."
          actionLabel="Add asset"
          onAction={openAddModal}
        />
      ) : (
        <>
          <Card className={`${styles.tableCard} ${styles.desktopOnly}`}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Location</th>
                  <th className={styles.numeric}>Unit cost</th>
                  <th className={styles.numeric}>On hand</th>
                  <th className={styles.numeric}>Value</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {assets.map((asset) => (
                  <tr key={asset.id}>
                    <td>{asset.name}</td>
                    <td>{asset.category}</td>
                    <td>{locationLabel(asset.location)}</td>
                    <td className={styles.numeric}>KES {asset.unit_cost.toFixed(2)}</td>
                    <td className={styles.numeric}>{asset.quantity_on_hand}</td>
                    <td className={styles.numeric}>KES {asset.value.toFixed(2)}</td>
                    <td>
                      <span className={styles.statusCell}>
                        <span
                          className={`${styles.statusDot} ${
                            asset.active ? styles.statusDotActive : styles.statusDotInactive
                          }`}
                        />
                        {asset.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <ActionMenu
                        aria-label={`Actions for ${asset.name}`}
                        items={[
                          { label: "Edit", onClick: () => openEditModal(asset) },
                          { label: "Log purchase", onClick: () => setEventModal({ asset, type: "purchase" }) },
                          { label: "Log loss", onClick: () => setEventModal({ asset, type: "loss" }) },
                          {
                            label: "Delete",
                            destructive: true,
                            onClick: () => openDeleteModal(asset),
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
            {assets.map((asset) => {
              const isOpen = expandedIds.has(asset.id);
              return (
                <li key={asset.id} className={styles.itemCard}>
                  <button
                    type="button"
                    className={styles.itemCardRow}
                    aria-expanded={isOpen}
                    onClick={() => toggleExpanded(asset.id)}
                  >
                    <span className={styles.itemCardIdentity}>
                      <span className={styles.itemCardName}>{asset.name}</span>
                      <span className={styles.itemCardCategory}>{asset.category}</span>
                    </span>
                    <span className={styles.itemCardMetrics}>
                      <span className={styles.itemCardPrice}>{asset.quantity_on_hand} on hand</span>
                    </span>
                    <span
                      className={`${styles.itemCardStatusDot} ${
                        asset.active ? styles.statusDotActive : styles.statusDotInactive
                      }`}
                      title={asset.active ? "Active" : "Inactive"}
                    />
                    <span
                      className={`${styles.itemCardChevron} ${isOpen ? styles.itemCardChevronOpen : ""}`}
                    >
                      <Icon name="chevron-right" size={20} />
                    </span>
                  </button>

                  <div
                    className={`${styles.itemCardDetails} ${isOpen ? styles.itemCardDetailsOpen : ""}`}
                  >
                    <div className={styles.itemCardDetailsInner}>
                      <div className={styles.itemCardDetailLine}>
                        <span>Location</span>
                        <strong>{locationLabel(asset.location)}</strong>
                      </div>
                      <div className={styles.itemCardDetailLine}>
                        <span>Unit cost</span>
                        <strong>KES {asset.unit_cost.toFixed(2)}</strong>
                      </div>
                      <div className={styles.itemCardDetailLine}>
                        <span>Value on hand</span>
                        <strong>KES {asset.value.toFixed(2)}</strong>
                      </div>
                      <div className={styles.itemCardDetailLine}>
                        <span>Status</span>
                        <strong>{asset.active ? "Active" : "Inactive"}</strong>
                      </div>
                      <div className={styles.itemCardFooter}>
                        <button type="button" className={styles.itemCardEditBtn} onClick={() => openEditModal(asset)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className={styles.itemCardEditBtn}
                          onClick={() => setEventModal({ asset, type: "purchase" })}
                        >
                          Log purchase
                        </button>
                        <button
                          type="button"
                          className={styles.itemCardEditBtn}
                          onClick={() => setEventModal({ asset, type: "loss" })}
                        >
                          Log loss
                        </button>
                        <button
                          type="button"
                          className={`${styles.itemCardEditBtn} ${styles.itemCardDeleteBtn}`}
                          onClick={() => openDeleteModal(asset)}
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
        title={editingId ? "Edit asset" : "Add asset"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDrawerOpen(false)}>
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
            label="Category"
            placeholder="e.g. Utensils, Cookware, Furniture"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            error={fieldErrors.category}
          />

          <Select
            label="Location"
            value={form.location ?? ""}
            options={locationOptions}
            onChange={(e) =>
              setForm({ ...form, location: e.target.value === "" ? null : (e.target.value as "restaurant" | "canteen") })
            }
          />

          <Input
            label="Unit cost (KES)"
            type="number"
            min="0"
            step="0.01"
            numeric
            value={form.unit_cost}
            onChange={(e) => setForm({ ...form, unit_cost: Number(e.target.value) })}
            error={fieldErrors.unit_cost}
          />

          <Input
            label="Low stock threshold (optional)"
            type="number"
            min="0"
            step="1"
            numeric
            value={form.low_stock_threshold ?? ""}
            onChange={(e) =>
              setForm({ ...form, low_stock_threshold: e.target.value === "" ? null : Number(e.target.value) })
            }
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
      </Drawer>

      <AssetEventModal
        open={eventModal !== null}
        onClose={() => setEventModal(null)}
        asset={eventModal?.asset ?? null}
        eventType={eventModal?.type ?? "purchase"}
        onSaved={() => {
          setToast(eventModal?.type === "purchase" ? "Purchase logged" : "Loss logged");
          refreshAssets();
        }}
      />

      {/* Delete — permanent. Unlike delivery_locations (whose FK is
          nullable), asset_events.asset_id is NOT nullable, so this also
          removes the asset's full purchase/loss history — confirmed
          acceptable with the human (assets are a low-stakes catalog, no
          sales/profit history depends on one). See
          supabase/migrations/20260728140000_asset_hard_delete.sql. */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={deleteTarget ? `Delete ${deleteTarget.name}?` : "Delete asset"}
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
            This permanently removes the asset and cannot be undone.
          </p>

          {deleteImpactLoading && <p>Checking what this will affect…</p>}

          {deleteImpact && (
            <ul className={styles.deleteImpactList}>
              {deleteImpact.events_affected_count > 0 ? (
                <li>
                  <strong>{deleteImpact.events_affected_count}</strong> purchase/loss event
                  {deleteImpact.events_affected_count === 1 ? "" : "s"} totaling{" "}
                  <strong>KES {deleteImpact.events_total_value.toFixed(2)}</strong> will be deleted along
                  with this asset — that history cannot be recovered.
                </li>
              ) : (
                <li>No purchase/loss events logged yet — nothing else will be affected.</li>
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
