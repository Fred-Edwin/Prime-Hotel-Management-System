"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Card } from "@/components/Card";
import { Drawer } from "@/components/Drawer";
import { FormSection } from "@/components/FormSection";
import { FilterBar } from "@/components/FilterBar";
import { Modal } from "@/components/Modal";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { Toast } from "@/components/Toast";
import { ActionMenu } from "@/components/ActionMenu";
import {
  staffCreateSchema,
  staffUpdateSchema,
  staffPinResetSchema,
  type StaffCreateInput,
  type StaffUpdateInput,
  type StaffPinResetInput,
} from "@/lib/validation";
import type { Database } from "@/lib/supabase/types";
import catalogStyles from "../catalog.module.css";
import styles from "./staff.module.css";

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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function StaffClient({ initialStaff }: { initialStaff: StaffRow[] }) {
  const [staff, setStaff] = useState<StaffRow[]>(initialStaff);
  const [drawerOpen, setDrawerOpen] = useState(false);
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

  const [deleteTarget, setDeleteTarget] = useState<StaffRow | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
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

  const filteredStaff = useMemo(() => {
    return staff.filter((person) => {
      if (search && !person.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (roleFilter && person.role !== roleFilter) return false;
      if (locationFilter && person.location !== locationFilter) return false;
      return true;
    });
  }, [staff, search, roleFilter, locationFilter]);

  function openAddDrawer() {
    setForm(emptyForm);
    setFieldErrors({});
    setDrawerOpen(true);
  }

  function openEditDrawer(person: StaffRow) {
    setEditingStaff(person);
    setEditForm(toUpdateForm(person));
    setEditErrors({});
  }

  function openPinResetModal(person: StaffRow) {
    setPinResetStaff(person);
    setPinForm({ pin: "" });
    setPinErrors({});
  }

  function openDeleteModal(person: StaffRow) {
    setDeleteTarget(person);
    setDeleteConfirmText("");
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
      setDrawerOpen(false);
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

  async function handleQuickDeactivate(person: StaffRow) {
    setEditSubmitting(true);
    try {
      const res = await fetch(`/api/staff/${person.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...toUpdateForm(person), active: !person.active }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast(data.error ?? "Something went wrong");
        return;
      }
      const saved: StaffRow = data.staff;
      setStaff((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
      setToast(saved.active ? `${saved.name} reactivated` : `${saved.name} deactivated`);
    } catch {
      setToast("Couldn't reach the server — check your connection and try again.");
    } finally {
      setEditSubmitting(false);
    }
  }

  return (
    <div>
      <div className={catalogStyles.header}>
        <h1 className={catalogStyles.title}>Staff</h1>
        <Button variant="primary" onClick={openAddDrawer}>
          Add staff
        </Button>
      </div>

      <div className={catalogStyles.toolbarRow}>
        <FilterBar
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value);
            setExpandedIds(new Set());
          }}
          searchPlaceholder="Search staff…"
          filters={[
            {
              value: roleFilter,
              onChange: (value) => {
                setRoleFilter(value);
                setExpandedIds(new Set());
              },
              "aria-label": "Filter by role",
              options: [
                { value: "", label: "All roles" },
                { value: "admin", label: "Admin" },
                { value: "staff", label: "Staff" },
              ],
            },
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
          ]}
        />
      </div>

      {staff.length === 0 ? (
        <EmptyState
          icon={<Icon name="staff" size={48} />}
          heading="No staff accounts yet"
          body="Add your first staff account to get started."
          actionLabel="Add staff"
          onAction={openAddDrawer}
        />
      ) : filteredStaff.length === 0 ? (
        <EmptyState
          icon={<Icon name="staff" size={48} />}
          heading="No staff match your filters"
          body="Try a different search term or clear a filter."
        />
      ) : (
        <>
          <Card className={`${catalogStyles.tableCard} ${catalogStyles.desktopOnly}`}>
            <table className={catalogStyles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Location</th>
                  <th>Store manager</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filteredStaff.map((person) => (
                  <tr key={person.id} data-accent={person.active ? "active" : "inactive"}>
                    <td className={styles.nameTd}>
                      <div className={styles.nameCell}>
                        <span className={styles.avatar}>{initials(person.name)}</span>
                        <span className={styles.personName}>{person.name}</span>
                      </div>
                    </td>
                    <td data-label="Role">{person.role === "admin" ? "Admin" : "Staff"}</td>
                    <td data-label="Location">
                      {person.location
                        ? person.location.charAt(0).toUpperCase() + person.location.slice(1)
                        : "—"}
                    </td>
                    {person.is_store_manager && (
                      <td data-label="Store manager" className={styles.storeManagerTd}>
                        Yes
                      </td>
                    )}
                    <td data-label="Status" className={styles.statusTd}>
                      <span className={catalogStyles.statusCell}>
                        <span
                          className={`${catalogStyles.statusDot} ${
                            person.active ? catalogStyles.statusDotActive : catalogStyles.statusDotInactive
                          }`}
                        />
                        {person.active ? "Active" : "Deactivated"}
                      </span>
                    </td>
                    <td className={styles.actionsTd}>
                      <ActionMenu
                        aria-label={`Actions for ${person.name}`}
                        items={[
                          { label: "Edit", onClick: () => openEditDrawer(person) },
                          { label: "Reset PIN", onClick: () => openPinResetModal(person) },
                          {
                            label: person.active ? "Deactivate" : "Reactivate",
                            onClick: () => handleQuickDeactivate(person),
                            disabled: editSubmitting,
                          },
                          {
                            label: "Delete",
                            onClick: () => openDeleteModal(person),
                            destructive: true,
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <ul className={`${catalogStyles.cardList} ${catalogStyles.mobileOnly}`}>
            {filteredStaff.map((person) => {
              const isOpen = expandedIds.has(person.id);
              return (
                <li key={person.id} className={catalogStyles.itemCard}>
                  <button
                    type="button"
                    className={catalogStyles.itemCardRow}
                    aria-expanded={isOpen}
                    onClick={() => toggleExpanded(person.id)}
                  >
                    <span className={styles.avatar}>{initials(person.name)}</span>
                    <span className={catalogStyles.itemCardIdentity}>
                      <span className={catalogStyles.itemCardName}>{person.name}</span>
                      <span className={catalogStyles.itemCardCategory}>
                        {person.role === "admin" ? "Admin" : "Staff"}
                        {person.location
                          ? ` · ${person.location.charAt(0).toUpperCase() + person.location.slice(1)}`
                          : ""}
                      </span>
                    </span>
                    <span
                      className={`${catalogStyles.itemCardStatusDot} ${
                        person.active ? catalogStyles.statusDotActive : catalogStyles.statusDotInactive
                      }`}
                      title={person.active ? "Active" : "Deactivated"}
                    />
                    <span
                      className={`${catalogStyles.itemCardChevron} ${
                        isOpen ? catalogStyles.itemCardChevronOpen : ""
                      }`}
                    >
                      <Icon name="chevron-right" size={20} />
                    </span>
                  </button>

                  <div
                    className={`${catalogStyles.itemCardDetails} ${
                      isOpen ? catalogStyles.itemCardDetailsOpen : ""
                    }`}
                  >
                    <div className={catalogStyles.itemCardDetailsInner}>
                      <div className={catalogStyles.itemCardDetailLine}>
                        <span>Status</span>
                        <strong>{person.active ? "Active" : "Deactivated"}</strong>
                      </div>
                      {person.is_store_manager && (
                        <div className={catalogStyles.itemCardDetailLine}>
                          <span>Store manager</span>
                          <strong>Yes</strong>
                        </div>
                      )}
                      <div className={styles.itemCardActionRow}>
                        <button
                          type="button"
                          className={catalogStyles.itemCardEditBtn}
                          onClick={() => openPinResetModal(person)}
                        >
                          Reset PIN
                        </button>
                        <button
                          type="button"
                          className={catalogStyles.itemCardEditBtn}
                          disabled={editSubmitting}
                          onClick={() => handleQuickDeactivate(person)}
                        >
                          {person.active ? "Deactivate" : "Reactivate"}
                        </button>
                        <button
                          type="button"
                          className={`${catalogStyles.itemCardEditBtn} ${styles.itemCardDeleteBtn}`}
                          onClick={() => openDeleteModal(person)}
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          className={catalogStyles.itemCardEditBtn}
                          onClick={() => openEditDrawer(person)}
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

      {/* Add staff */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Add staff"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDrawerOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Creating…" : "Create account"}
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
        </FormSection>

        <FormSection label="Access">
          <Input
            label="PIN (6 digits)"
            type="password"
            inputMode="numeric"
            value={form.pin}
            onChange={(e) => setForm({ ...form, pin: e.target.value })}
            error={fieldErrors.pin}
          />

          <label className={catalogStyles.selectField}>
            <span className={catalogStyles.selectLabel}>Role</span>
            <select
              className={catalogStyles.select}
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
        </FormSection>

        {form.role === "staff" && (
          <FormSection label="Responsibilities">
            <label className={catalogStyles.selectField}>
              <span className={catalogStyles.selectLabel}>Location</span>
              <select
                className={catalogStyles.select}
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
              <label className={catalogStyles.checkboxField}>
                <input
                  type="checkbox"
                  checked={form.is_store_manager}
                  onChange={(e) => setForm({ ...form, is_store_manager: e.target.checked })}
                />
                <span>Store manager</span>
              </label>
            )}
          </FormSection>
        )}

        {fieldErrors.form && <p className={catalogStyles.formError}>{fieldErrors.form}</p>}
      </Drawer>

      {/* Edit staff */}
      <Drawer
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
          <>
            <FormSection label="Identity">
              <Input
                label="Name"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                error={editErrors.name}
              />
            </FormSection>

            <FormSection label="Access">
              <label className={catalogStyles.selectField}>
                <span className={catalogStyles.selectLabel}>Role</span>
                <select
                  className={catalogStyles.select}
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
            </FormSection>

            {editForm.role === "staff" && (
              <FormSection label="Responsibilities">
                <label className={catalogStyles.selectField}>
                  <span className={catalogStyles.selectLabel}>Location</span>
                  <select
                    className={catalogStyles.select}
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
                  <label className={catalogStyles.checkboxField}>
                    <input
                      type="checkbox"
                      checked={editForm.is_store_manager}
                      onChange={(e) =>
                        setEditForm({ ...editForm, is_store_manager: e.target.checked })
                      }
                    />
                    <span>Store manager</span>
                  </label>
                )}
              </FormSection>
            )}

            <FormSection label="Status">
              <label className={catalogStyles.checkboxField}>
                <input
                  type="checkbox"
                  checked={editForm.active}
                  onChange={(e) => setEditForm({ ...editForm, active: e.target.checked })}
                />
                <span>Active (can log in)</span>
              </label>
            </FormSection>

            {editErrors.form && <p className={catalogStyles.formError}>{editErrors.form}</p>}
          </>
        )}
      </Drawer>

      {/* Reset PIN — short, non-form interaction: Modal remains correct here */}
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
        <div className={catalogStyles.form}>
          <Input
            label="New PIN (6 digits)"
            type="password"
            inputMode="numeric"
            value={pinForm.pin}
            onChange={(e) => setPinForm({ pin: e.target.value })}
            error={pinErrors.pin}
          />
          {pinErrors.form && <p className={catalogStyles.formError}>{pinErrors.form}</p>}
        </div>
      </Modal>

      {/* Delete — destructive, guarded with a typed confirmation; not yet
          wired to a real backend delete (Phase 10 scope: UI/confirmation
          flow only, see docs/04_PHASE_PLAN.md's Phase 10 section). */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={deleteTarget ? `Delete ${deleteTarget.name}?` : "Delete staff"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteConfirmText !== deleteTarget?.name}
              onClick={() => {
                setToast("Hard-delete isn't wired up yet — use Deactivate for now.");
                setDeleteTarget(null);
              }}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        <div className={catalogStyles.form}>
          <p className={styles.deleteWarning}>
            This permanently removes the account. This is different from Deactivate, which can be
            reversed. Type <strong>{deleteTarget?.name}</strong> to confirm.
          </p>
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
