"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Card } from "@/components/Card";
import { Modal } from "@/components/Modal";
import { EmptyState } from "@/components/EmptyState";
import { Toast } from "@/components/Toast";
import { staffCreateSchema, type StaffCreateInput } from "@/lib/validation";
import type { Database } from "@/lib/supabase/types";
import styles from "../catalog.module.css";

type StaffRow = Pick<
  Database["public"]["Tables"]["users"]["Row"],
  "id" | "name" | "staff_code" | "role" | "location" | "is_store_manager" | "created_at"
>;

const emptyForm: StaffCreateInput = {
  name: "",
  pin: "",
  role: "staff",
  location: "restaurant",
  is_store_manager: false,
};

export function StaffClient({ initialStaff }: { initialStaff: StaffRow[] }) {
  const [staff, setStaff] = useState<StaffRow[]>(initialStaff);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<StaffCreateInput>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function openAddModal() {
    setForm(emptyForm);
    setFieldErrors({});
    setModalOpen(true);
  }

  async function handleSubmit() {
    const parsed = staffCreateSchema.safeParse(form);
    if (!parsed.success) {
      const errors: Partial<Record<string, string>> = {};
      for (const issue of parsed.error.issues) {
        errors[String(issue.path[0])] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setFieldErrors({ form: data.error ?? "Something went wrong" });
        return;
      }

      const saved: StaffRow = data.staff;
      setStaff((prev) => [...prev, saved].sort((a, b) => a.staff_code.localeCompare(b.staff_code)));
      setModalOpen(false);
      setToast(`${saved.name} can now log in (code ${saved.staff_code})`);
    } catch {
      setFieldErrors({ form: "Couldn't reach the server — check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className={styles.header}>
        <h1 className={styles.title}>Staff</h1>
        <Button variant="primary" onClick={openAddModal}>
          Add staff
        </Button>
      </div>

      {staff.length === 0 ? (
        <EmptyState
          icon={<span aria-hidden>+</span>}
          heading="No staff accounts yet"
          body="Add your first staff account to get started."
          actionLabel="Add staff"
          onAction={openAddModal}
        />
      ) : (
        <Card className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Code</th>
                <th>Role</th>
                <th>Location</th>
                <th>Store manager</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((person) => (
                <tr key={person.id}>
                  <td>{person.name}</td>
                  <td>{person.staff_code}</td>
                  <td>{person.role === "admin" ? "Admin" : "Staff"}</td>
                  <td>
                    {person.location
                      ? person.location.charAt(0).toUpperCase() + person.location.slice(1)
                      : "—"}
                  </td>
                  <td>{person.is_store_manager ? "Yes" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Add staff"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Creating…" : "Create account"}
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
            label="PIN (4–6 digits)"
            type="password"
            inputMode="numeric"
            value={form.pin}
            onChange={(e) => setForm({ ...form, pin: e.target.value })}
            error={fieldErrors.pin}
          />

          <label className={styles.selectField}>
            <span className={styles.selectLabel}>Role</span>
            <select
              className={styles.select}
              value={form.role}
              onChange={(e) => {
                const role = e.target.value as StaffCreateInput["role"];
                setForm({
                  ...form,
                  role,
                  location: role === "admin" ? null : "restaurant",
                  is_store_manager: false,
                });
              }}
            >
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </label>

          {form.role === "staff" && (
            <>
              <label className={styles.selectField}>
                <span className={styles.selectLabel}>Location</span>
                <select
                  className={styles.select}
                  value={form.location ?? "restaurant"}
                  onChange={(e) => {
                    const location = e.target.value as "restaurant" | "canteen";
                    setForm({
                      ...form,
                      location,
                      is_store_manager: location === "restaurant" ? form.is_store_manager : false,
                    });
                  }}
                >
                  <option value="restaurant">Restaurant</option>
                  <option value="canteen">Canteen</option>
                </select>
              </label>

              {form.location === "restaurant" && (
                <label className={styles.checkboxField}>
                  <input
                    type="checkbox"
                    checked={form.is_store_manager}
                    onChange={(e) => setForm({ ...form, is_store_manager: e.target.checked })}
                  />
                  <span>Store manager</span>
                </label>
              )}
            </>
          )}

          {fieldErrors.form && <p className={styles.formError}>{fieldErrors.form}</p>}
        </div>
      </Modal>

      {toast && <Toast message={toast} status="success" onDismiss={() => setToast(null)} />}
    </div>
  );
}
