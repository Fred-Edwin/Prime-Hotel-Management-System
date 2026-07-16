"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Card } from "@/components/Card";
import { Drawer } from "@/components/Drawer";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { Toast } from "@/components/Toast";
import { deliveryLocationSchema, type DeliveryLocationInput } from "@/lib/validation";
import type { Database } from "@/lib/supabase/types";
import styles from "../catalog.module.css";

type DeliveryLocation = Database["public"]["Tables"]["delivery_locations"]["Row"];

const emptyForm: DeliveryLocationInput = {
  name: "",
  fee: 0,
  active: true,
};

export function DeliveryLocationsClient({
  initialLocations,
}: {
  initialLocations: DeliveryLocation[];
}) {
  const [locations, setLocations] = useState<DeliveryLocation[]>(initialLocations);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DeliveryLocationInput>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof DeliveryLocationInput, string>>
  >({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
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

  function openAddModal() {
    setEditingId(null);
    setForm(emptyForm);
    setFieldErrors({});
    setDrawerOpen(true);
  }

  function openEditModal(location: DeliveryLocation) {
    setEditingId(location.id);
    setForm({ name: location.name, fee: location.fee, active: location.active });
    setFieldErrors({});
    setDrawerOpen(true);
  }

  async function handleSubmit() {
    const parsed = deliveryLocationSchema.safeParse(form);
    if (!parsed.success) {
      const errors: Partial<Record<keyof DeliveryLocationInput, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof DeliveryLocationInput;
        errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const url = editingId ? `/api/delivery-locations/${editingId}` : "/api/delivery-locations";
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

      const saved: DeliveryLocation = data.deliveryLocation;
      setLocations((prev) =>
        editingId ? prev.map((l) => (l.id === saved.id ? saved : l)) : [...prev, saved],
      );
      setDrawerOpen(false);
      setToast(editingId ? "Delivery location updated" : "Delivery location added");
    } catch {
      setFieldErrors({ name: "Couldn't reach the server — check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Delivery Locations</h1>
        <Button variant="primary" onClick={openAddModal}>
          Add location
        </Button>
      </div>

      {locations.length === 0 ? (
        <EmptyState
          icon={<Icon name="delivery" size={48} />}
          heading="No delivery locations yet"
          body="Add your first delivery zone to get started."
          actionLabel="Add location"
          onAction={openAddModal}
        />
      ) : (
        <>
          <Card className={`${styles.tableCard} ${styles.desktopOnly}`}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Zone</th>
                  <th className={styles.numeric}>Fee</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {locations.map((location) => (
                  <tr key={location.id}>
                    <td>{location.name}</td>
                    <td className={styles.numeric}>KES {location.fee.toFixed(2)}</td>
                    <td>
                      <span className={styles.statusCell}>
                        <span
                          className={`${styles.statusDot} ${
                            location.active ? styles.statusDotActive : styles.statusDotInactive
                          }`}
                        />
                        {location.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={styles.editLink}
                        onClick={() => openEditModal(location)}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <ul className={`${styles.cardList} ${styles.mobileOnly}`}>
            {locations.map((location) => {
              const isOpen = expandedIds.has(location.id);
              return (
                <li key={location.id} className={styles.itemCard}>
                  <button
                    type="button"
                    className={styles.itemCardRow}
                    aria-expanded={isOpen}
                    onClick={() => toggleExpanded(location.id)}
                  >
                    <span className={styles.itemCardIdentity}>
                      <span className={styles.itemCardName}>{location.name}</span>
                    </span>
                    <span className={styles.itemCardMetrics}>
                      <span className={styles.itemCardPrice}>KES {location.fee.toFixed(2)}</span>
                    </span>
                    <span
                      className={`${styles.itemCardStatusDot} ${
                        location.active ? styles.statusDotActive : styles.statusDotInactive
                      }`}
                      title={location.active ? "Active" : "Inactive"}
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
                        <span>Status</span>
                        <strong>{location.active ? "Active" : "Inactive"}</strong>
                      </div>
                      <div className={styles.itemCardFooter}>
                        <button
                          type="button"
                          className={styles.itemCardEditBtn}
                          onClick={() => openEditModal(location)}
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
        title={editingId ? "Edit delivery location" : "Add delivery location"}
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
            label="Zone name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            error={fieldErrors.name}
          />

          <Input
            label="Fee (KES)"
            type="number"
            min="0"
            step="0.01"
            numeric
            value={form.fee}
            onChange={(e) => setForm({ ...form, fee: Number(e.target.value) })}
            error={fieldErrors.fee}
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

      {toast && <Toast message={toast} status="success" onDismiss={() => setToast(null)} />}
    </div>
  );
}
