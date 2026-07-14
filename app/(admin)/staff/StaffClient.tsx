"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Card } from "@/components/Card";
import { Modal } from "@/components/Modal";
import { EmptyState } from "@/components/EmptyState";
import { Toast } from "@/components/Toast";
import {
  staffCreateSchema,
  staffUpdateSchema,
  staffPinResetSchema,
  type StaffCreateInput,
  type StaffUpdateInput,
  type StaffPinResetInput,
} from "@/lib/validation";
import type { Database } from "@/lib/supabase/types";
import styles from "../catalog.module.css";

type StaffRow = Pick<
  Database["public"]["Tables"]["users"]["Row"],
  "id" | "name" | "staff_code" | "role" | "location" | "is_store_manager" | "active" | "created_at"
>;

const emptyForm: StaffCreateInput = {
  name: "",
  pin: "",
  role: "staff",
  location: "restaurant",
  is_store_manager: false,
};

function toUpdateForm(person: StaffRow): StaffUpdateInput {
  return {
    name: person.name,
    role: person.role,
    location: person.location,
    is_store_manager: person.is_store_manager,
    active: person.active,
  };
}

export function StaffClient({ initialStaff }: { initialStaff: StaffRow[] }) {
  const [staff, setStaff] = useState<StaffRow[]>(initialStaff);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<StaffCreateInput>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [editingStaff, setEditingStaff] = useState<StaffRow | null>(null);
  const [editForm, setEditForm] = useState<StaffUpdateInput | null>(null);
  const [editErrors, setEditErrors] = useState<Partial<Record<string, string>>>({});
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [pinResetStaff, setPinResetStaff] = useState<StaffRow | null>(null);
  const [pinForm, setPinForm] = useState<StaffPinResetInput>({ pin: "" });
  const [pinErrors, setPinErrors] = useState<Partial<Record<string, string>>>({});
  const [pinSubmitting, setPinSubmitting] = useState(false);

  function openAddModal() {
    setForm(emptyForm);
    setFieldErrors({});
    setModalOpen(true);
  }

  function openEditModal(person: StaffRow) {
    setEditingStaff(person);
    setEditForm(toUpdateForm(person));
    setEditErrors({});
  }

  function openPinResetModal(person: StaffRow) {
    setPinResetStaff(person);
    setPinForm({ pin: "" });
    setPinErrors({});
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

  async function handleEditSubmit() {
    if (!editingStaff || !editForm) return;
    const parsed = staffUpdateSchema.safeParse(editForm);
    if (!parsed.success) {
      const errors: Partial<Record<string, string>> = {};
      for (const issue of parsed.error.issues) {
        errors[String(issue.path[0])] = issue.message;
      }
      setEditErrors(errors);
      return;
    }

    setEditSubmitting(true);
    try {
      const res = await fetch(`/api/staff/${editingStaff.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setEditErrors({ form: data.error ?? "Something went wrong" });
        return;
      }

      const saved: StaffRow = data.staff;
      setStaff((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
      setEditingStaff(null);
      setToast(`${saved.name}'s account was updated`);
    } catch {
      setEditErrors({ form: "Couldn't reach the server — check your connection and try again." });
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handlePinResetSubmit() {
    if (!pinResetStaff) return;
    const parsed = staffPinResetSchema.safeParse(pinForm);
    if (!parsed.success) {
      const errors: Partial<Record<string, string>> = {};
      for (const issue of parsed.error.issues) {
        errors[String(issue.path[0])] = issue.message;
      }
      setPinErrors(errors);
      return;
    }

    setPinSubmitting(true);
    try {
      const res = await fetch(`/api/staff/${pinResetStaff.id}/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setPinErrors({ form: data.error ?? "Something went wrong" });
        return;
      }

      const name = pinResetStaff.name;
      setPinResetStaff(null);
      setToast(`${name}'s PIN was reset`);
    } catch {
      setPinErrors({ form: "Couldn't reach the server — check your connection and try again." });
    } finally {
      setPinSubmitting(false);
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
                <th>Status</th>
                <th></th>
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
                  <td>
                    <span className={person.active ? styles.badgeActive : styles.badgeInactive}>
                      {person.active ? "Active" : "Deactivated"}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className={styles.editLink}
                      onClick={() => openEditModal(person)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={styles.editLink}
                      onClick={() => openPinResetModal(person)}
                    >
                      Reset PIN
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Add staff */}
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
            label="PIN (6 digits)"
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

      {/* Edit staff */}
      <Modal
        open={editingStaff !== null}
        onClose={() => setEditingStaff(null)}
        title={editingStaff ? `Edit ${editingStaff.name}` : "Edit staff"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditingStaff(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleEditSubmit} disabled={editSubmitting}>
              {editSubmitting ? "Saving…" : "Save changes"}
            </Button>
          </>
        }
      >
        {editForm && (
          <div className={styles.form}>
            <Input
              label="Name"
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              error={editErrors.name}
            />

            <label className={styles.selectField}>
              <span className={styles.selectLabel}>Role</span>
              <select
                className={styles.select}
                value={editForm.role}
                onChange={(e) => {
                  const role = e.target.value as StaffUpdateInput["role"];
                  setEditForm({
                    ...editForm,
                    role,
                    location: role === "admin" ? null : (editForm.location ?? "restaurant"),
                    is_store_manager: role === "admin" ? false : editForm.is_store_manager,
                  });
                }}
              >
                <option value="staff">Staff</option>
                <option value="admin">Admin</option>
              </select>
            </label>

            {editForm.role === "staff" && (
              <>
                <label className={styles.selectField}>
                  <span className={styles.selectLabel}>Location</span>
                  <select
                    className={styles.select}
                    value={editForm.location ?? "restaurant"}
                    onChange={(e) => {
                      const location = e.target.value as "restaurant" | "canteen";
                      setEditForm({
                        ...editForm,
                        location,
                        is_store_manager: location === "restaurant" ? editForm.is_store_manager : false,
                      });
                    }}
                  >
                    <option value="restaurant">Restaurant</option>
                    <option value="canteen">Canteen</option>
                  </select>
                </label>

                {editForm.location === "restaurant" && (
                  <label className={styles.checkboxField}>
                    <input
                      type="checkbox"
                      checked={editForm.is_store_manager}
                      onChange={(e) => setEditForm({ ...editForm, is_store_manager: e.target.checked })}
                    />
                    <span>Store manager</span>
                  </label>
                )}
              </>
            )}

            <label className={styles.checkboxField}>
              <input
                type="checkbox"
                checked={editForm.active}
                onChange={(e) => setEditForm({ ...editForm, active: e.target.checked })}
              />
              <span>Active (can log in)</span>
            </label>

            {editErrors.form && <p className={styles.formError}>{editErrors.form}</p>}
          </div>
        )}
      </Modal>

      {/* Reset PIN */}
      <Modal
        open={pinResetStaff !== null}
        onClose={() => setPinResetStaff(null)}
        title={pinResetStaff ? `Reset PIN — ${pinResetStaff.name}` : "Reset PIN"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPinResetStaff(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handlePinResetSubmit} disabled={pinSubmitting}>
              {pinSubmitting ? "Resetting…" : "Reset PIN"}
            </Button>
          </>
        }
      >
        <div className={styles.form}>
          <Input
            label="New PIN (6 digits)"
            type="password"
            inputMode="numeric"
            value={pinForm.pin}
            onChange={(e) => setPinForm({ pin: e.target.value })}
            error={pinErrors.pin}
          />
          {pinErrors.form && <p className={styles.formError}>{pinErrors.form}</p>}
        </div>
      </Modal>

      {toast && <Toast message={toast} status="success" onDismiss={() => setToast(null)} />}
    </div>
  );
}
