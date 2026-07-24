"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { CategoryChips } from "@/components/CategoryChips";
import { Input } from "@/components/Input";
import { Modal } from "@/components/Modal";
import { PeriodToggle } from "@/components/PeriodToggle";
import { EmptyState } from "@/components/EmptyState";
import { FilterBar } from "@/components/FilterBar";
import { Icon } from "@/components/Icon";
import { InfoTooltip } from "@/components/InfoTooltip";
import { LowStockIndicator } from "@/components/LowStockIndicator";
import { MetricCard } from "@/components/MetricCard";
import { PlaceholderStat } from "@/components/PlaceholderStat";
import { Select } from "@/components/Select";
import { Toast } from "@/components/Toast";
import { isLowStock, nairobiToday } from "@/lib/calculations";
import catalogStyles from "../../catalog.module.css";
import styles from "./ledger.module.css";

type Period = "today" | "week" | "month";
type Location = "restaurant" | "canteen" | "";

interface ItemLedgerRow {
  entry_date: string;
  item_id: string;
  item_name: string;
  location: "restaurant" | "canteen";
  opening_stock: number;
  added_stock: number;
  sent_out: number;
  till_quantity_sold: number;
  quantity_sold: number;
  wastage: number;
  closing_stock: number;
  sales_value: number;
  cost_value: number;
  closing_stock_value: number;
  wastage_value: number;
  low_stock_threshold: number;
}

interface IngredientLedgerRow {
  entry_date: string;
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  opening_stock: number;
  received: number;
  quantity_used: number;
  wastage: number;
  closing_stock: number;
  cost_value: number;
  closing_stock_value: number;
  wastage_value: number;
  low_stock_threshold: number;
}

type StockConsumptionCategory = "wastage" | "staff_meal" | "complimentary_meal" | "stock_adjustment";

/**
 * Unified Stock Consumption ledger row (docs/backlog/05_stock_consumption.md)
 * — a tagged union over wastage/staff meals/complimentary meals/stock
 * adjustments, replacing the old standalone StaffMealLedgerRow. Only one
 * of item_id/ingredient_id is ever non-null per row (wastage can be
 * either; the three per-claim categories are always items). staff_id/
 * staff_name are null for wastage rows (no per-claim attribution, §3.3).
 */
interface StockConsumptionLedgerRow {
  category: StockConsumptionCategory;
  entry_date: string;
  item_id: string | null;
  item_name: string | null;
  ingredient_id: string | null;
  ingredient_name: string | null;
  unit: string | null;
  location: "restaurant" | "canteen" | null;
  quantity: number;
  value: number;
  note: string | null;
  staff_id: string | null;
  staff_name: string | null;
}

interface LedgerResponse {
  period: Period;
  from: string;
  to: string;
  items: ItemLedgerRow[];
  ingredients: IngredientLedgerRow[];
  stockConsumption: StockConsumptionLedgerRow[];
}

const PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

const LOCATION_OPTIONS: { value: Location; label: string }[] = [
  { value: "", label: "Both locations" },
  { value: "restaurant", label: "Restaurant" },
  { value: "canteen", label: "Canteen" },
];

function money(value: number): string {
  return `KES ${Math.round(value).toLocaleString("en-KE")}`;
}

function qty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Admin direct ledger-row edit (docs/backlog/04_admin_ledger_edit.md) — a
 * quantities-only edit form opened from a row's edit affordance, submitted
 * through PATCH /api/dashboard/ledger/entry. Price snapshots are never
 * editable here (resolved design decision #2); the server rejects the edit
 * outright (409) if this isn't the most-recent row for the item/ingredient
 * (resolved design decision #1) — the modal just surfaces that message.
 */
type StockEntryEditTarget = {
  kind: "stock_entries";
  item_id: string;
  item_name: string;
  location: "restaurant" | "canteen";
  entry_date: string;
  till_quantity_sold: number;
  added_stock: number;
  sent_out: number;
  wastage: number;
};

/**
 * Admin-authored non-sales stock consumption dropdown (client feedback,
 * 2026-07-24) — the item-row edit modal's old bare "Wastage" input is now
 * a category picker. "wastage" still edits stock_entries.wastage via the
 * existing StockEntryEditTarget/submit path unchanged; the other three
 * categories create a brand-new staff_meal_entries/complimentary_meal_
 * entries/stock_adjustment_entries row via PATCH /api/dashboard/ledger/entry's
 * "stock_consumption" table variant — see stockConsumptionAdminEntrySchema.
 * Admin picks the staff member the claim is attributed to (staff_id); the
 * admin herself is always created_by.
 */
type NonSalesConsumptionCategory = "wastage" | "staff_meal" | "complimentary_meal" | "stock_adjustment";

const CONSUMPTION_CATEGORY_OPTIONS: { value: NonSalesConsumptionCategory; label: string }[] = [
  { value: "wastage", label: "Wastage" },
  { value: "staff_meal", label: "Staff meal" },
  { value: "complimentary_meal", label: "Complimentary meal" },
  { value: "stock_adjustment", label: "Stock adjustment" },
];

type IngredientEntryEditTarget = {
  kind: "ingredient_entries";
  mode: "edit" | "create";
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  entry_date: string;
  received: number;
  quantity_used: number;
  wastage: number;
};

type EditTarget = StockEntryEditTarget | IngredientEntryEditTarget;

interface IngredientCatalogRow {
  id: string;
  name: string;
  unit: string;
}

interface StaffRosterRow {
  id: string;
  name: string;
  staff_code: string;
  role: "admin" | "staff";
  location: "restaurant" | "canteen" | null;
  active: boolean;
}

export function LedgerClient() {
  const [period, setPeriod] = useState<Period>("today");
  const [location, setLocation] = useState<Location>("");
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [rangeDraft, setRangeDraft] = useState({ from: "", to: "" });
  const [rangePickerOpen, setRangePickerOpen] = useState(false);
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [itemSearch, setItemSearch] = useState("");
  const [ingredientSearch, setIngredientSearch] = useState("");
  const [consumptionSearch, setConsumptionSearch] = useState("");
  // Stock Consumption category filter (docs/backlog/05_stock_consumption.md)
  // — "all" shows every category in one list, matching the confirmed
  // "one section, filter chips" UI direction.
  const [consumptionCategoryFilter, setConsumptionCategoryFilter] = useState<
    "all" | StockConsumptionCategory
  >("all");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [editForm, setEditForm] = useState<Record<string, number>>({});
  // Non-sales stock consumption dropdown state (stock_entries edit target
  // only — ingredient_entries keeps its own plain Wastage input, since
  // staff_meal/complimentary_meal/stock_adjustment are items-only
  // concepts, §3.5). consumptionQuantity/consumptionNote back the form
  // whenever consumptionCategory !== "wastage"; "wastage" keeps using
  // editForm.wastage exactly as before.
  const [consumptionCategory, setConsumptionCategory] = useState<NonSalesConsumptionCategory>("wastage");
  const [consumptionQuantity, setConsumptionQuantity] = useState(0);
  const [consumptionDirection, setConsumptionDirection] = useState<"shortfall" | "surplus">("shortfall");
  const [consumptionNote, setConsumptionNote] = useState("");
  // Who a Ledger-authored staff meal/complimentary meal/stock adjustment
  // claim is attributed to (client feedback, 2026-07-24 — admin picks a
  // real staff member rather than this always defaulting to her own
  // account; see docs/01_DATA_MODEL.md §3.12). Reset whenever the edit
  // modal opens a new row, same as consumptionQuantity/consumptionNote.
  const [consumptionStaffId, setConsumptionStaffId] = useState("");
  const [staffRoster, setStaffRoster] = useState<StaffRosterRow[]>([]);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Which of the three ledger tables (if any) is currently maximized — one
  // shared piece of state rather than a separate boolean per table, since
  // only one table can sensibly be fullscreen at a time. Was a single
  // `isTableMaximized` boolean scoped to just the Item Ledger table before
  // the Ingredients/Non-Sales Stock Consumption tables gained the same
  // maximize affordance.
  const [maximizedTable, setMaximizedTable] = useState<"items" | "ingredients" | "consumption" | null>(
    null
  );
  const [ingredientCatalog, setIngredientCatalog] = useState<IngredientCatalogRow[]>([]);
  // Historical-edit cascade preview (docs/00_ARCHITECTURE.md's admin
  // ledger-edit cascade) — null while loading/not yet fetched, { count: 0 }
  // once confirmed this is already the latest row (no cascade, no
  // confirmation step needed). cascadeConfirmed gates the actual submit:
  // when count > 0, the first "Save" click shows the impact instead of
  // submitting; a second click (with cascadeConfirmed true) proceeds.
  const [cascadeImpact, setCascadeImpact] = useState<{ count: number; through: string | null } | null>(
    null
  );
  const [cascadeConfirmed, setCascadeConfirmed] = useState(false);

  // Cost-ratio settings modal (docs/01_DATA_MODEL.md §3.11, 2026-07-23,
  // simplified to an unconditional rule same day) — the rate applied to
  // selling_price for every wastage/staff-meal/complimentary-meal/stock-
  // adjustment row's `value`. Loaded lazily when the modal opens, not on
  // initial page load, since it's an infrequently-changed setting the
  // ledger screen doesn't otherwise need.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsRatio, setSettingsRatio] = useState<string>("");
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSubmitting, setSettingsSubmitting] = useState(false);

  async function openSettings() {
    setSettingsOpen(true);
    setSettingsError(null);
    setSettingsLoading(true);
    try {
      const res = await fetch("/api/settings");
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setSettingsRatio(String(json.settings?.estimated_cost_ratio ?? ""));
      } else {
        setSettingsError(json.error ?? "Failed to load settings");
      }
    } catch {
      setSettingsError("Failed to load settings");
    } finally {
      setSettingsLoading(false);
    }
  }

  function closeSettings() {
    setSettingsOpen(false);
    setSettingsError(null);
  }

  async function submitSettings() {
    const ratio = Number(settingsRatio);
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
      setSettingsError("Enter a number between 0 and 1 (e.g. 0.6 for 60%)");
      return;
    }
    setSettingsSubmitting(true);
    setSettingsError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estimated_cost_ratio: ratio }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSettingsError(json.error ?? "Failed to save");
        return;
      }
      setSettingsOpen(false);
      setToast("Cost ratio updated");
      setReloadKey((key) => key + 1);
    } catch {
      setSettingsError("Failed to save");
    } finally {
      setSettingsSubmitting(false);
    }
  }

  function openStockEntryEdit(row: ItemLedgerRow) {
    setEditError(null);
    setEditTarget({
      kind: "stock_entries",
      item_id: row.item_id,
      item_name: row.item_name,
      location: row.location,
      entry_date: row.entry_date,
      till_quantity_sold: row.till_quantity_sold,
      added_stock: row.added_stock,
      sent_out: row.sent_out,
      wastage: row.wastage,
    });
    setEditForm({
      till_quantity_sold: row.till_quantity_sold,
      added_stock: row.added_stock,
      sent_out: row.sent_out,
      wastage: row.wastage,
    });
    // Non-sales consumption dropdown always reopens on "Wastage" — it's a
    // one-shot "log a new claim" action for the other three categories,
    // not a persisted field on the row, so there's nothing to restore.
    setConsumptionCategory("wastage");
    setConsumptionQuantity(0);
    setConsumptionDirection("shortfall");
    setConsumptionNote("");
    setConsumptionStaffId("");
  }

  function openIngredientEntryEdit(row: IngredientLedgerRow) {
    setEditError(null);
    setEditTarget({
      kind: "ingredient_entries",
      mode: "edit",
      ingredient_id: row.ingredient_id,
      ingredient_name: row.ingredient_name,
      unit: row.unit,
      entry_date: row.entry_date,
      received: row.received,
      quantity_used: row.quantity_used,
      wastage: row.wastage,
    });
    setEditForm({
      received: row.received,
      quantity_used: row.quantity_used,
      wastage: row.wastage,
    });
  }

  // "Log today's ingredient entry as admin" (docs/backlog/07_admin_ux_sweep.md
  // item 6) — the same PATCH /api/dashboard/ledger/entry route already
  // creates a brand-new row when none exists yet for the given
  // ingredient/date (see that route's editIngredientEntry doc comment), so
  // this reuses the identical edit form/submit path with an empty starting
  // ingredient selection instead of adding a second write path.
  function openIngredientEntryCreate() {
    setEditError(null);
    const first = ingredientCatalog[0];
    setEditTarget({
      kind: "ingredient_entries",
      mode: "create",
      ingredient_id: first?.id ?? "",
      ingredient_name: first?.name ?? "",
      unit: first?.unit ?? "",
      entry_date: nairobiToday(),
      received: 0,
      quantity_used: 0,
      wastage: 0,
    });
    setEditForm({ received: 0, quantity_used: 0, wastage: 0 });
  }

  function closeEdit() {
    setEditTarget(null);
    setEditError(null);
    setCascadeImpact(null);
    setCascadeConfirmed(false);
  }

  // Historical-edit cascade preview — fetches how many later entries (and
  // through what date) editing this row would recompute, so the confirm
  // step below can show "This will also recalculate N later entries..."
  // before the admin commits. Skipped for a brand-new ingredient entry
  // (mode: "create") — there's nothing later than a row that doesn't
  // exist yet. Re-fetches whenever a different row is opened; does not
  // re-fetch on every keystroke inside the form, since which rows exist
  // later doesn't depend on the quantities being typed.
  const isCreateMode =
    (editTarget?.kind === "ingredient_entries" && editTarget.mode === "create") ||
    (editTarget?.kind === "stock_entries" && consumptionCategory !== "wastage");

  useEffect(() => {
    if (!editTarget || isCreateMode) return;
    let cancelled = false;

    async function loadImpact() {
      setCascadeImpact(null);
      setCascadeConfirmed(false);
      const params =
        editTarget!.kind === "stock_entries"
          ? new URLSearchParams({
              table: "stock_entries",
              item_id: editTarget!.item_id,
              location: (editTarget as StockEntryEditTarget).location,
              entry_date: editTarget!.entry_date,
            })
          : new URLSearchParams({
              table: "ingredient_entries",
              ingredient_id: (editTarget as IngredientEntryEditTarget).ingredient_id,
              entry_date: editTarget!.entry_date,
            });
      try {
        const res = await fetch(`/api/dashboard/ledger/entry/impact?${params.toString()}`);
        const json = await res.json().catch(() => ({}));
        if (!cancelled) setCascadeImpact(res.ok ? { count: json.count ?? 0, through: json.through ?? null } : { count: 0, through: null });
      } catch {
        if (!cancelled) setCascadeImpact({ count: 0, through: null });
      }
    }

    loadImpact();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fetch keyed on which row is open (identity fields), not on every editForm keystroke
  }, [
    editTarget?.kind,
    editTarget?.entry_date,
    isCreateMode,
    consumptionCategory,
    editTarget?.kind === "stock_entries" ? editTarget.item_id : undefined,
    editTarget?.kind === "stock_entries" ? editTarget.location : undefined,
    editTarget?.kind === "ingredient_entries" ? editTarget.ingredient_id : undefined,
  ]);

  // Create mode never has a cascade (nothing can be later than a row that
  // doesn't exist yet) — treated as a resolved { count: 0 } without ever
  // going through the async fetch/effect above, so the Save button isn't
  // disabled waiting on a request this case never needs to make.
  const resolvedCascadeImpact = isCreateMode ? { count: 0, through: null } : cascadeImpact;

  async function submitEdit() {
    if (!editTarget) return;
    if (editTarget.kind === "ingredient_entries" && editTarget.mode === "create" && !editTarget.ingredient_id) {
      setEditError("Select an ingredient first.");
      return;
    }
    if (
      editTarget.kind === "stock_entries" &&
      consumptionCategory !== "wastage" &&
      consumptionQuantity <= 0
    ) {
      setEditError("Enter a quantity greater than 0.");
      return;
    }
    if (editTarget.kind === "stock_entries" && consumptionCategory !== "wastage" && !consumptionStaffId) {
      setEditError("Choose who this claim is for.");
      return;
    }
    // First click on a historical row (cascade impact > 0) just reveals
    // the confirmation copy in the modal instead of submitting — the
    // second click (cascadeConfirmed already true) proceeds for real.
    if (resolvedCascadeImpact && resolvedCascadeImpact.count > 0 && !cascadeConfirmed) {
      setCascadeConfirmed(true);
      return;
    }
    setEditSubmitting(true);
    setEditError(null);

    const payload =
      editTarget.kind === "stock_entries" && consumptionCategory !== "wastage"
        ? {
            table: "stock_consumption" as const,
            category: consumptionCategory,
            item_id: editTarget.item_id,
            location: editTarget.location,
            entry_date: editTarget.entry_date,
            staff_id: consumptionStaffId,
            // Stock adjustment is the one signed category (§3.10): "Add"
            // (surplus) negates the quantity before sending, same
            // convention StockConsumptionClient.tsx already uses on
            // /expenses so the server-side sign meaning is set once, not
            // re-derived per caller.
            quantity:
              consumptionCategory === "stock_adjustment" && consumptionDirection === "surplus"
                ? -consumptionQuantity
                : consumptionQuantity,
            note: consumptionNote.trim() || null,
          }
        : editTarget.kind === "stock_entries"
          ? {
              table: "stock_entries" as const,
              item_id: editTarget.item_id,
              location: editTarget.location,
              entry_date: editTarget.entry_date,
              till_quantity_sold: editForm.till_quantity_sold,
              added_stock: editForm.added_stock,
              sent_out: editForm.sent_out,
              wastage: editForm.wastage,
            }
          : {
              table: "ingredient_entries" as const,
              ingredient_id: editTarget.ingredient_id,
              entry_date: editTarget.entry_date,
              received: editForm.received,
              quantity_used: editForm.quantity_used,
              wastage: editForm.wastage,
            };

    try {
      const res = await fetch("/api/dashboard/ledger/entry", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditError(json.error ?? "Couldn't save — please try again.");
        return;
      }
      const wasCreate =
        (editTarget.kind === "ingredient_entries" && editTarget.mode === "create") ||
        (editTarget.kind === "stock_entries" && consumptionCategory !== "wastage");
      setEditTarget(null);
      setCascadeImpact(null);
      setCascadeConfirmed(false);
      setToast(wasCreate ? "Entry logged" : "Entry updated");
      setReloadKey((key) => key + 1);
    } catch {
      setEditError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setEditSubmitting(false);
    }
  }

  function toggleExpanded(key: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Escape backs out of maximized-table mode — standard fullscreen-toggle
  // convention (docs/backlog/07_admin_ux_sweep.md's "expand/maximize the
  // table" ask), matching how Modal (components/Modal) already handles
  // Escape elsewhere in this app rather than inventing a new convention.
  useEffect(() => {
    if (!maximizedTable) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMaximizedTable(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [maximizedTable]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ period });
        if (location) params.set("location", location);
        if (customRange) {
          params.set("from", customRange.from);
          params.set("to", customRange.to);
        }

        const res = await fetch(`/api/dashboard/ledger?${params.toString()}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Failed to load ledger");
        if (!cancelled) setData(json as LedgerResponse);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load ledger");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [period, location, customRange, reloadKey]);

  // Ingredient catalog for the "New ingredient entry" picker — admin-only,
  // location-independent (ingredients aren't scoped by location), loaded
  // once rather than re-fetched per period/location change like the ledger
  // data above.
  useEffect(() => {
    let cancelled = false;
    async function loadCatalog() {
      try {
        const res = await fetch("/api/ingredients");
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return;
        if (!cancelled) setIngredientCatalog(json.ingredients ?? []);
      } catch {
        // Non-fatal — the "New entry" picker just starts empty; the rest
        // of the Ledger screen doesn't depend on this.
      }
    }
    loadCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  // Staff roster for the "who is this claim for" picker (client feedback,
  // 2026-07-24) — admin-only, loaded once like the ingredient catalog
  // above, then filtered per-row to the edited item's location + active
  // staff at submit time (the route re-checks this server-side too).
  useEffect(() => {
    let cancelled = false;
    async function loadRoster() {
      try {
        const res = await fetch("/api/staff");
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return;
        if (!cancelled) setStaffRoster(json.staff ?? []);
      } catch {
        // Non-fatal — the staff picker just starts empty.
      }
    }
    loadRoster();
    return () => {
      cancelled = true;
    };
  }, []);

  function selectPeriod(value: Period) {
    setCustomRange(null);
    setPeriod(value);
  }

  function applyCustomRange() {
    if (!rangeDraft.from || !rangeDraft.to || rangeDraft.from > rangeDraft.to) return;
    setCustomRange({ from: rangeDraft.from, to: rangeDraft.to });
    setRangePickerOpen(false);
  }

  const filteredItems =
    data?.items.filter((row) =>
      row.item_name.toLowerCase().includes(itemSearch.trim().toLowerCase())
    ) ?? [];

  const filteredIngredients =
    data?.ingredients.filter((row) =>
      row.ingredient_name.toLowerCase().includes(ingredientSearch.trim().toLowerCase())
    ) ?? [];

  // Summary strip totals — computed client-side from the already-loaded
  // filtered result set (no new endpoint needed). Answers "how did this
  // period do" at a glance, and gives the page something substantial to
  // show even when the filtered result is a single row.
  const totals = (data?.items ?? []).reduce(
    (acc, row) => ({
      salesValue: acc.salesValue + row.sales_value,
      costValue: acc.costValue + row.cost_value,
    }),
    { salesValue: 0, costValue: 0 }
  );

  // Stock Consumption total (docs/backlog/05_stock_consumption.md) —
  // wastage + staff meals + complimentary meals + stock adjustments,
  // combined into one figure for the summary strip; the section below
  // breaks it down per-category via the filter chips.
  const stockConsumptionRows = data?.stockConsumption ?? [];
  const stockConsumptionTotal = stockConsumptionRows.reduce((sum, row) => sum + row.value, 0);
  const filteredConsumptionRows = stockConsumptionRows
    .filter((row) => consumptionCategoryFilter === "all" || row.category === consumptionCategoryFilter)
    .filter((row) => {
      const subject = (row.item_name ?? row.ingredient_name ?? "").toLowerCase();
      return subject.includes(consumptionSearch.trim().toLowerCase());
    });

  const CONSUMPTION_CATEGORY_LABELS: Record<StockConsumptionCategory, string> = {
    wastage: "Wastage",
    staff_meal: "Staff meal",
    complimentary_meal: "Complimentary meal",
    stock_adjustment: "Stock adjustment",
  };

  // Stock adjustments are signed (docs/backlog/05_stock_consumption.md,
  // 2026-07-22): a negative quantity is a surplus (stock found, added
  // back), positive is a shortfall (missing stock) — label each row
  // distinctly rather than showing a bare category name that reads as
  // always-a-loss for this one category.
  function consumptionRowLabel(row: StockConsumptionLedgerRow): string {
    if (row.category !== "stock_adjustment") return CONSUMPTION_CATEGORY_LABELS[row.category];
    return row.quantity < 0 ? "Stock adjustment (surplus)" : "Stock adjustment (shortfall)";
  }

  return (
    <div className={`${styles.page} ${styles.pageFullBleed}`}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={catalogStyles.title}>Item Ledger</h1>
          <Link href="/dashboard" className={styles.backLink}>
            ← Back to dashboard
          </Link>
        </div>
        <div className={styles.controls}>
          <PeriodToggle
            options={PERIOD_OPTIONS}
            value={customRange ? "" : period}
            onChange={(v) => selectPeriod(v as Period)}
          />
          <div className={styles.rangePicker}>
            <button
              type="button"
              className={styles.rangeButton}
              onClick={() => {
                setRangeDraft(customRange ?? { from: "", to: "" });
                setRangePickerOpen((open) => !open);
              }}
            >
              <Icon name="summary" size={16} />
              {customRange ? `${customRange.from} → ${customRange.to}` : "Select range"}
            </button>
            {rangePickerOpen && (
              <div className={styles.rangePopover}>
                <label className={styles.rangeField}>
                  <span>From</span>
                  <input
                    type="date"
                    value={rangeDraft.from}
                    onChange={(e) => setRangeDraft({ ...rangeDraft, from: e.target.value })}
                  />
                </label>
                <label className={styles.rangeField}>
                  <span>To</span>
                  <input
                    type="date"
                    value={rangeDraft.to}
                    onChange={(e) => setRangeDraft({ ...rangeDraft, to: e.target.value })}
                  />
                </label>
                <button type="button" className={styles.rangeApply} onClick={applyCustomRange}>
                  Apply
                </button>
              </div>
            )}
          </div>
          <label className={styles.locationSelect}>
            <select value={location} onChange={(e) => setLocation(e.target.value as Location)}>
              {LOCATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error && <p className={catalogStyles.formError}>{error}</p>}

      {loading && !data ? (
        <p>Loading…</p>
      ) : data ? (
        <>
          <div className={styles.summaryStrip}>
            <MetricCard label="Total sales value" value={money(totals.salesValue)} />
            <MetricCard label="Total cost value" value={money(totals.costValue)} />
            <MetricCard label="Non-sales stock consumption value" value={money(stockConsumptionTotal)} />
            <MetricCard label="Rows" value={String(data.items.length)} />
          </div>

          <section className={styles.section}>
            <div className={styles.toolbarRow}>
              <FilterBar
                searchValue={itemSearch}
                onSearchChange={setItemSearch}
                searchPlaceholder="Search items…"
              />
            </div>
            <>
                {maximizedTable === "items" && (
                  <div className={styles.maximizeBackdrop} onClick={() => setMaximizedTable(null)} />
                )}
                <Card
                  className={[
                    catalogStyles.tableCard,
                    styles.ledgerTableCard,
                    maximizedTable === "items" ? styles.ledgerTableCardMaximized : "",
                    catalogStyles.desktopOnly,
                  ].join(" ")}
                >
                  {/* Maximize/restore toggle — docs/backlog/07_admin_ux_sweep.md's
                      "the table takes up such a small part of the screen" ask,
                      redesigned per direct human feedback from a labeled
                      bordered-pill button (felt heavy) to an icon-only ghost
                      button sitting in the card's own top-right corner —
                      matching the window-control convention of Notion/
                      Airtable/Linear's own data tables rather than reading as
                      a separate toolbar bolted above the table. Lives inside
                      the Card (not a sibling above it) so it rides along with
                      the Card's own position: fixed when maximized instead of
                      needing its own separate fixed-position handling. */}
                  <div className={styles.maximizeButtonShell}>
                    <button
                      type="button"
                      className={styles.maximizeButton}
                      onClick={() => setMaximizedTable((prev) => (prev === "items" ? null : "items"))}
                      aria-label={maximizedTable === "items" ? "Restore table size" : "Maximize table"}
                      title={maximizedTable === "items" ? "Restore table size (Esc)" : "Maximize table"}
                    >
                      <Icon name={maximizedTable === "items" ? "collapse" : "expand"} size={16} />
                    </button>
                  </div>
                <table
                  className={[
                    catalogStyles.table,
                    styles.ledgerTable,
                    filteredItems.length <= 3 ? styles.ledgerTableSparse : "",
                  ].join(" ")}
                >
                  <thead>
                    <tr>
                      <th colSpan={5} className={[styles.groupHeader, styles.groupHeaderIdentity].join(" ")}>
                        Identity
                      </th>
                      <th
                        colSpan={6}
                        className={[styles.groupHeader, styles.groupHeaderMovement, styles.groupDividerStart].join(
                          " "
                        )}
                      >
                        Stock movement
                      </th>
                      <th
                        colSpan={4}
                        className={[styles.groupHeader, styles.groupHeaderValue, styles.groupDividerStart].join(" ")}
                      >
                        Inventory value
                      </th>
                    </tr>
                    <tr>
                      <th className={styles.stickyCol}>Date</th>
                      <th className={styles.stickyColItem}>Item</th>
                      <th>Location</th>
                      <th>Staff on shift</th>
                      <th className={catalogStyles.numeric}>Opening</th>
                      <th className={[catalogStyles.numeric, styles.groupDividerStart].join(" ")}>Added</th>
                      <th className={catalogStyles.numeric}>Canteen (S/R)</th>
                      <th className={catalogStyles.numeric}>Sold (Hotel)</th>
                      <th className={catalogStyles.numeric}>Sold (total)</th>
                      <th className={catalogStyles.numeric}>Wastage</th>
                      <th className={catalogStyles.numeric}>Closing</th>
                      <th className={[catalogStyles.numeric, styles.groupDividerStart].join(" ")}>Sales value</th>
                      <th className={catalogStyles.numeric}>Cost value</th>
                      <th className={catalogStyles.numeric}>Closing stock value</th>
                      <th className={catalogStyles.numeric}>Wastage value</th>
                      <th aria-label="Edit" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.length === 0 && (
                      <tr>
                        <td colSpan={16} className={styles.emptyRow}>
                          <EmptyState
                            icon={<Icon name="summary" size={48} />}
                            heading={
                              data.items.length === 0 ? "No item entries this period" : "No matching items"
                            }
                            body={
                              data.items.length === 0
                                ? "Once staff save till or canteen entries, they'll show up here row by row."
                                : "Try a different search term."
                            }
                          />
                        </td>
                      </tr>
                    )}
                    {filteredItems.map((row) => {
                      const canteenSignedQty =
                        row.location === "canteen" ? row.added_stock : -row.sent_out;
                      return (
                        <tr
                          key={`${row.entry_date}-${row.item_id}-${row.location}`}
                          className={styles.editableRow}
                          onClick={() => openStockEntryEdit(row)}
                        >
                          <td className={styles.stickyCol}>{row.entry_date}</td>
                          <td className={styles.stickyColItem}>{row.item_name}</td>
                          <td className={[styles.locationCell, styles.groupWashIdentity].join(" ")}>
                            {row.location === "restaurant" ? "Restaurant" : "Canteen"}
                          </td>
                          <td className={styles.groupWashIdentity}>
                            <PlaceholderStat
                              label="Staff on shift"
                              reason="Coming with the planned lightweight clock-in feature — not built yet, so this column isn't wired to real attendance data."
                            />
                          </td>
                          <td className={catalogStyles.numeric}>{qty(row.opening_stock)}</td>
                          <td className={[catalogStyles.numeric, styles.groupDividerStart].join(" ")}>
                            {qty(row.added_stock)}
                          </td>
                          <td className={catalogStyles.numeric}>
                            <span
                              className={
                                canteenSignedQty < 0
                                  ? styles.negativeValue
                                  : canteenSignedQty > 0
                                    ? styles.positiveValue
                                    : undefined
                              }
                            >
                              {canteenSignedQty > 0 ? "+" : ""}
                              {qty(canteenSignedQty)}
                            </span>
                          </td>
                          <td className={catalogStyles.numeric}>{qty(row.till_quantity_sold)}</td>
                          <td className={catalogStyles.numeric}>{qty(row.quantity_sold)}</td>
                          <td className={catalogStyles.numeric}>{qty(row.wastage)}</td>
                          <td className={catalogStyles.numeric}>
                            <span
                              className={
                                isLowStock(row.closing_stock, row.low_stock_threshold)
                                  ? styles.lowValue
                                  : undefined
                              }
                            >
                              {qty(row.closing_stock)}
                            </span>
                          </td>
                          <td
                            className={[
                              catalogStyles.numeric,
                              styles.numericStrong,
                              styles.groupDividerStart,
                              styles.groupWashValue,
                            ].join(" ")}
                          >
                            <span className={row.sales_value > 0 ? styles.salesValuePositive : undefined}>
                              {money(row.sales_value)}
                            </span>
                          </td>
                          <td
                            className={[catalogStyles.numeric, styles.numericStrong, styles.groupWashValue].join(
                              " "
                            )}
                          >
                            {money(row.cost_value)}
                          </td>
                          <td
                            className={[catalogStyles.numeric, styles.numericStrong, styles.groupWashValue].join(
                              " "
                            )}
                          >
                            {money(row.closing_stock_value)}
                          </td>
                          <td
                            className={[catalogStyles.numeric, styles.numericStrong, styles.groupWashValue].join(
                              " "
                            )}
                          >
                            <span className={row.wastage_value > 0 ? styles.wastageValueNotable : undefined}>
                              {money(row.wastage_value)}
                            </span>
                          </td>
                          <td>
                            <button
                              type="button"
                              className={styles.editButton}
                              onClick={(e) => {
                                e.stopPropagation();
                                openStockEntryEdit(row);
                              }}
                              aria-label={`Edit ${row.item_name} entry`}
                            >
                              <Icon name="edit" size={16} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </Card>
              </>

            {/* Mobile collapsible-card treatment (<600px), matching the
                pattern already used on Items/Ingredients/Delivery
                Locations/Staff/Orders — the one gap left over from the
                Phase 10 sweep. A 15-column table can't reflow onto a
                phone screen, so each row collapses to Item + Date +
                Closing (the figure most worth a glance) with the rest
                behind a tap, same interaction as Items' price/margin
                summary row. */}
            {filteredItems.length > 0 && (
              <ul className={`${catalogStyles.cardList} ${catalogStyles.mobileOnly}`}>
                {filteredItems.map((row) => {
                  const key = `${row.entry_date}-${row.item_id}-${row.location}`;
                  const isOpen = expandedRows.has(key);
                  const canteenSignedQty =
                    row.location === "canteen" ? row.added_stock : -row.sent_out;
                  return (
                    <li key={key} className={catalogStyles.itemCard}>
                      <button
                        type="button"
                        className={catalogStyles.itemCardRow}
                        aria-expanded={isOpen}
                        onClick={() => toggleExpanded(key)}
                      >
                        <span className={catalogStyles.itemCardIdentity}>
                          <span className={catalogStyles.itemCardName}>{row.item_name}</span>
                          <span className={catalogStyles.itemCardCategory}>
                            {row.entry_date} · {row.location === "restaurant" ? "Restaurant" : "Canteen"}
                          </span>
                        </span>
                        <span className={catalogStyles.itemCardMetrics}>
                          <span className={catalogStyles.itemCardPrice}>{money(row.sales_value)}</span>
                          <span
                            className={[
                              styles.itemCardClosingStock,
                              isLowStock(row.closing_stock, row.low_stock_threshold)
                                ? styles.lowValue
                                : "",
                            ].join(" ")}
                          >
                            {qty(row.closing_stock)} left
                          </span>
                        </span>
                        <span
                          className={[
                            catalogStyles.itemCardChevron,
                            isOpen ? catalogStyles.itemCardChevronOpen : "",
                          ].join(" ")}
                        >
                          <Icon name="chevron-right" size={20} />
                        </span>
                      </button>

                      <div
                        className={[
                          catalogStyles.itemCardDetails,
                          isOpen ? catalogStyles.itemCardDetailsOpen : "",
                        ].join(" ")}
                      >
                        <div className={catalogStyles.itemCardDetailsInner}>
                          <div className={catalogStyles.itemCardDetailLine}>
                            <span>Opening</span>
                            <strong>{qty(row.opening_stock)}</strong>
                          </div>
                          <div className={catalogStyles.itemCardDetailLine}>
                            <span>Added</span>
                            <strong>{qty(row.added_stock)}</strong>
                          </div>
                          <div className={catalogStyles.itemCardDetailLine}>
                            <span>Canteen (S/R)</span>
                            <strong>
                              {canteenSignedQty > 0 ? "+" : ""}
                              {qty(canteenSignedQty)}
                            </strong>
                          </div>
                          <div className={catalogStyles.itemCardDetailLine}>
                            <span>Sold (hotel till)</span>
                            <strong>{qty(row.till_quantity_sold)}</strong>
                          </div>
                          <div className={catalogStyles.itemCardDetailLine}>
                            <span>Sold (total)</span>
                            <strong>{qty(row.quantity_sold)}</strong>
                          </div>
                          <div className={catalogStyles.itemCardDetailLine}>
                            <span>Wastage</span>
                            <strong>{qty(row.wastage)}</strong>
                          </div>
                          <div className={catalogStyles.itemCardDetailLine}>
                            <span>Sales value</span>
                            <strong>{money(row.sales_value)}</strong>
                          </div>
                          <div className={catalogStyles.itemCardDetailLine}>
                            <span>Cost value</span>
                            <strong>{money(row.cost_value)}</strong>
                          </div>
                          <div className={catalogStyles.itemCardDetailLine}>
                            <span>Closing stock value</span>
                            <strong>{money(row.closing_stock_value)}</strong>
                          </div>
                          <div className={catalogStyles.itemCardDetailLine}>
                            <span>Wastage value</span>
                            <strong>{money(row.wastage_value)}</strong>
                          </div>
                          <button
                            type="button"
                            className={styles.editCardButton}
                            onClick={() => openStockEntryEdit(row)}
                          >
                            <Icon name="edit" size={14} />
                            Edit entry
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {location !== "canteen" && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>Ingredients</h2>
                <LowStockIndicator variant="pill" label="Restaurant only" />
                <Button
                  variant="secondary"
                  className={styles.newEntryButton}
                  onClick={openIngredientEntryCreate}
                  disabled={ingredientCatalog.length === 0}
                >
                  New entry
                </Button>
              </div>
              <div className={styles.toolbarRow}>
                <FilterBar
                  searchValue={ingredientSearch}
                  onSearchChange={setIngredientSearch}
                  searchPlaceholder="Search ingredients…"
                />
              </div>
              <>
                      {maximizedTable === "ingredients" && (
                        <div className={styles.maximizeBackdrop} onClick={() => setMaximizedTable(null)} />
                      )}
                      <Card
                        className={[
                          catalogStyles.tableCard,
                          styles.ledgerTableCard,
                          maximizedTable === "ingredients" ? styles.ledgerTableCardMaximized : "",
                          catalogStyles.desktopOnly,
                        ].join(" ")}
                      >
                        {/* Maximize toggle + sticky header, same mechanism as
                            the Item Ledger table above — this table
                            previously used a plain, unbounded Card, which is
                            why its <thead> scrolled away with the page
                            instead of staying pinned (the reported "can't
                            tell the columns" bug: a plain catalogStyles.table
                            has no sticky positioning of its own). */}
                        <div className={styles.maximizeButtonShell}>
                          <button
                            type="button"
                            className={styles.maximizeButton}
                            onClick={() =>
                              setMaximizedTable((prev) => (prev === "ingredients" ? null : "ingredients"))
                            }
                            aria-label={
                              maximizedTable === "ingredients" ? "Restore table size" : "Maximize table"
                            }
                            title={
                              maximizedTable === "ingredients"
                                ? "Restore table size (Esc)"
                                : "Maximize table"
                            }
                          >
                            <Icon name={maximizedTable === "ingredients" ? "collapse" : "expand"} size={16} />
                          </button>
                        </div>
                        <table
                          className={[
                            catalogStyles.table,
                            styles.ledgerTable,
                            filteredIngredients.length <= 3 ? styles.ledgerTableSparse : "",
                          ].join(" ")}
                        >
                          <thead>
                            <tr className={styles.ingredientHeaderRow}>
                              <th>Date</th>
                              <th>Ingredient</th>
                              <th className={catalogStyles.numeric}>Opening</th>
                              <th className={catalogStyles.numeric}>Received</th>
                              <th className={catalogStyles.numeric}>Used</th>
                              <th className={catalogStyles.numeric}>Wastage</th>
                              <th className={catalogStyles.numeric}>Closing</th>
                              <th className={catalogStyles.numeric}>Cost value</th>
                              <th className={catalogStyles.numeric}>Closing value</th>
                              <th className={catalogStyles.numeric}>Wastage value</th>
                              <th aria-label="Edit" />
                            </tr>
                          </thead>
                          <tbody>
                            {filteredIngredients.length === 0 && (
                              <tr>
                                <td colSpan={11} className={styles.emptyRow}>
                                  <EmptyState
                                    icon={<Icon name="summary" size={48} />}
                                    heading={
                                      data.ingredients.length === 0
                                        ? "No ingredient entries this period"
                                        : "No matching ingredients"
                                    }
                                    body={
                                      data.ingredients.length === 0
                                        ? "Once the store manager saves ingredient receiving/usage, they'll show up here. Or log one yourself with New entry above."
                                        : "Try a different search term."
                                    }
                                  />
                                </td>
                              </tr>
                            )}
                            {filteredIngredients.map((row) => (
                              <tr
                                key={`${row.entry_date}-${row.ingredient_id}`}
                                className={styles.editableRow}
                                onClick={() => openIngredientEntryEdit(row)}
                              >
                                <td>{row.entry_date}</td>
                                <td>{row.ingredient_name}</td>
                                <td className={catalogStyles.numeric}>
                                  {qty(row.opening_stock)} {row.unit}
                                </td>
                                <td className={catalogStyles.numeric}>
                                  {qty(row.received)} {row.unit}
                                </td>
                                <td className={catalogStyles.numeric}>
                                  {qty(row.quantity_used)} {row.unit}
                                </td>
                                <td className={catalogStyles.numeric}>
                                  {qty(row.wastage)} {row.unit}
                                </td>
                                <td className={catalogStyles.numeric}>
                                  <span
                                    className={
                                      isLowStock(row.closing_stock, row.low_stock_threshold)
                                        ? styles.lowValue
                                        : undefined
                                    }
                                  >
                                    {qty(row.closing_stock)} {row.unit}
                                  </span>
                                </td>
                                <td className={catalogStyles.numeric}>{money(row.cost_value)}</td>
                                <td className={catalogStyles.numeric}>{money(row.closing_stock_value)}</td>
                                <td className={catalogStyles.numeric}>{money(row.wastage_value)}</td>
                                <td>
                                  <button
                                    type="button"
                                    className={styles.editButton}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openIngredientEntryEdit(row);
                                    }}
                                    aria-label={`Edit ${row.ingredient_name} entry`}
                                  >
                                    <Icon name="edit" size={16} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </Card>

                      <ul className={`${catalogStyles.cardList} ${catalogStyles.mobileOnly}`}>
                        {filteredIngredients.map((row) => {
                          const key = `${row.entry_date}-${row.ingredient_id}`;
                          const isOpen = expandedRows.has(key);
                          return (
                            <li key={key} className={catalogStyles.itemCard}>
                              <button
                                type="button"
                                className={catalogStyles.itemCardRow}
                                aria-expanded={isOpen}
                                onClick={() => toggleExpanded(key)}
                              >
                                <span className={catalogStyles.itemCardIdentity}>
                                  <span className={catalogStyles.itemCardName}>
                                    {row.ingredient_name}
                                  </span>
                                  <span className={catalogStyles.itemCardCategory}>{row.entry_date}</span>
                                </span>
                                <span className={catalogStyles.itemCardMetrics}>
                                  <span
                                    className={[
                                      catalogStyles.itemCardPrice,
                                      isLowStock(row.closing_stock, row.low_stock_threshold)
                                        ? styles.lowValue
                                        : "",
                                    ].join(" ")}
                                  >
                                    {qty(row.closing_stock)} {row.unit} left
                                  </span>
                                </span>
                                <span
                                  className={[
                                    catalogStyles.itemCardChevron,
                                    isOpen ? catalogStyles.itemCardChevronOpen : "",
                                  ].join(" ")}
                                >
                                  <Icon name="chevron-right" size={20} />
                                </span>
                              </button>

                              <div
                                className={[
                                  catalogStyles.itemCardDetails,
                                  isOpen ? catalogStyles.itemCardDetailsOpen : "",
                                ].join(" ")}
                              >
                                <div className={catalogStyles.itemCardDetailsInner}>
                                  <div className={catalogStyles.itemCardDetailLine}>
                                    <span>Opening</span>
                                    <strong>
                                      {qty(row.opening_stock)} {row.unit}
                                    </strong>
                                  </div>
                                  <div className={catalogStyles.itemCardDetailLine}>
                                    <span>Received</span>
                                    <strong>
                                      {qty(row.received)} {row.unit}
                                    </strong>
                                  </div>
                                  <div className={catalogStyles.itemCardDetailLine}>
                                    <span>Used</span>
                                    <strong>
                                      {qty(row.quantity_used)} {row.unit}
                                    </strong>
                                  </div>
                                  <div className={catalogStyles.itemCardDetailLine}>
                                    <span>Wastage</span>
                                    <strong>
                                      {qty(row.wastage)} {row.unit}
                                    </strong>
                                  </div>
                                  <div className={catalogStyles.itemCardDetailLine}>
                                    <span>Cost value</span>
                                    <strong>{money(row.cost_value)}</strong>
                                  </div>
                                  <div className={catalogStyles.itemCardDetailLine}>
                                    <span>Closing value</span>
                                    <strong>{money(row.closing_stock_value)}</strong>
                                  </div>
                                  <div className={catalogStyles.itemCardDetailLine}>
                                    <span>Wastage value</span>
                                    <strong>{money(row.wastage_value)}</strong>
                                  </div>
                                  <button
                                    type="button"
                                    className={styles.editCardButton}
                                    onClick={() => openIngredientEntryEdit(row)}
                                  >
                                    <Icon name="edit" size={14} />
                                    Edit entry
                                  </button>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
              </>
            </section>
          )}

          {/* Stock Consumption (docs/backlog/05_stock_consumption.md,
              replacing the old standalone "Staff meals" section) —
              wastage + staff meals + complimentary meals + stock
              adjustments in one unified, category-filterable list.
              Read-only here: wastage still comes from the same admin
              ledger-edit path as before (§3.4); the three per-claim
              categories are logged by staff themselves on /expenses.
              Reporting-only figures (docs/backlog/05_stock_consumption.md)
              — no longer subtracted from net profit, see dashboard's
              Stock Consumption section for the same figures aggregated. */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Non-sales stock consumption</h2>
              {/* InfoTooltip lives here, not on the "Value" column header
                  below -- that header sits inside .ledgerTableCard's
                  scrolling container (overflow-y/x: auto), which clips any
                  absolutely-positioned popover regardless of z-index. This
                  spot is outside any scrolling ancestor. */}
              <InfoTooltip
                label="Value"
                message="Quantity × selling price × the admin-set cost ratio (docs/01_DATA_MODEL.md §3.11). Never used in profit calculations."
              />
              <Button variant="secondary" className={styles.newEntryButton} onClick={openSettings}>
                Cost ratio settings
              </Button>
            </div>
            <div className={styles.toolbarRow}>
              <CategoryChips
                options={[
                  { value: "all", label: "All" },
                  { value: "wastage", label: "Wastage" },
                  { value: "staff_meal", label: "Staff meals" },
                  { value: "complimentary_meal", label: "Complimentary meals" },
                  { value: "stock_adjustment", label: "Stock adjustments" },
                ]}
                value={consumptionCategoryFilter}
                onChange={(value) => setConsumptionCategoryFilter(value as "all" | StockConsumptionCategory)}
              />
            </div>
            <div className={styles.toolbarRow}>
              <FilterBar
                searchValue={consumptionSearch}
                onSearchChange={setConsumptionSearch}
                searchPlaceholder="Search items / ingredients…"
              />
            </div>
            <>
                {maximizedTable === "consumption" && (
                  <div className={styles.maximizeBackdrop} onClick={() => setMaximizedTable(null)} />
                )}
                <Card
                  className={[
                    catalogStyles.tableCard,
                    styles.ledgerTableCard,
                    maximizedTable === "consumption" ? styles.ledgerTableCardMaximized : "",
                    catalogStyles.desktopOnly,
                  ].join(" ")}
                >
                  <div className={styles.maximizeButtonShell}>
                    <button
                      type="button"
                      className={styles.maximizeButton}
                      onClick={() =>
                        setMaximizedTable((prev) => (prev === "consumption" ? null : "consumption"))
                      }
                      aria-label={maximizedTable === "consumption" ? "Restore table size" : "Maximize table"}
                      title={
                        maximizedTable === "consumption" ? "Restore table size (Esc)" : "Maximize table"
                      }
                    >
                      <Icon name={maximizedTable === "consumption" ? "collapse" : "expand"} size={16} />
                    </button>
                  </div>
                  <table className={[catalogStyles.table, styles.ledgerTable].join(" ")}>
                    <thead>
                      <tr className={styles.ingredientHeaderRow}>
                        <th>Date</th>
                        <th>Category</th>
                        <th>Staff</th>
                        <th>Item / Ingredient</th>
                        <th>Location</th>
                        <th className={catalogStyles.numeric}>Quantity</th>
                        <th className={catalogStyles.numeric}>Value</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredConsumptionRows.length === 0 && (
                        <tr>
                          <td colSpan={8} className={styles.emptyRow}>
                            <EmptyState
                              icon={<Icon name="wastage" size={48} />}
                              heading={
                                stockConsumptionRows.length === 0
                                  ? "Nothing in this category this period"
                                  : "No matching entries"
                              }
                              body={
                                stockConsumptionRows.length === 0
                                  ? "Wastage, staff meals, complimentary meals, and stock adjustments will show up here, itemized by category."
                                  : "Try a different search term or category."
                              }
                            />
                          </td>
                        </tr>
                      )}
                      {filteredConsumptionRows.map((row, i) => (
                        <tr key={`${row.category}-${row.entry_date}-${row.item_id ?? row.ingredient_id}-${row.staff_id}-${i}`}>
                          <td>{row.entry_date}</td>
                          <td>{consumptionRowLabel(row)}</td>
                          <td>{row.staff_name ?? "—"}</td>
                          <td>{row.item_name ?? row.ingredient_name}</td>
                          <td className={styles.locationCell}>
                            {row.location === "restaurant" ? "Restaurant" : row.location === "canteen" ? "Canteen" : "—"}
                          </td>
                          <td className={catalogStyles.numeric}>
                            {row.quantity < 0 ? "+" : ""}
                            {qty(Math.abs(row.quantity))}
                            {row.unit ? ` ${row.unit}` : ""}
                          </td>
                          <td className={catalogStyles.numeric}>
                            {row.value < 0 ? "+" : ""}
                            {money(Math.abs(row.value))}
                          </td>
                          <td>{row.note ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>

                <ul className={`${catalogStyles.cardList} ${catalogStyles.mobileOnly}`}>
                  {filteredConsumptionRows.map((row, i) => {
                    const key = `${row.category}-${row.entry_date}-${row.item_id ?? row.ingredient_id}-${row.staff_id}-${i}`;
                    const isOpen = expandedRows.has(key);
                    const subjectName = row.item_name ?? row.ingredient_name ?? "—";
                    return (
                      <li key={key} className={catalogStyles.itemCard}>
                        <button
                          type="button"
                          className={catalogStyles.itemCardRow}
                          aria-expanded={isOpen}
                          onClick={() => toggleExpanded(key)}
                        >
                          <span className={catalogStyles.itemCardIdentity}>
                            <span className={catalogStyles.itemCardName}>{subjectName}</span>
                            <span className={catalogStyles.itemCardCategory}>
                              {consumptionRowLabel(row)} · {row.entry_date}
                              {row.staff_name ? ` · ${row.staff_name}` : ""}
                            </span>
                          </span>
                          <span className={catalogStyles.itemCardMetrics}>
                            <span className={catalogStyles.itemCardPrice}>
                              {row.value < 0 ? "+" : ""}
                              {money(Math.abs(row.value))}
                            </span>
                          </span>
                          <span
                            className={[
                              catalogStyles.itemCardChevron,
                              isOpen ? catalogStyles.itemCardChevronOpen : "",
                            ].join(" ")}
                          >
                            <Icon name="chevron-right" size={20} />
                          </span>
                        </button>

                        <div
                          className={[
                            catalogStyles.itemCardDetails,
                            isOpen ? catalogStyles.itemCardDetailsOpen : "",
                          ].join(" ")}
                        >
                          <div className={catalogStyles.itemCardDetailsInner}>
                            <div className={catalogStyles.itemCardDetailLine}>
                              <span>Location</span>
                              <strong>
                                {row.location === "restaurant" ? "Restaurant" : row.location === "canteen" ? "Canteen" : "—"}
                              </strong>
                            </div>
                            <div className={catalogStyles.itemCardDetailLine}>
                              <span>Quantity</span>
                              <strong>
                                {row.quantity < 0 ? "+" : ""}
                                {qty(Math.abs(row.quantity))}
                                {row.unit ? ` ${row.unit}` : ""}
                              </strong>
                            </div>
                            <div className={catalogStyles.itemCardDetailLine}>
                              <span>Value</span>
                              <strong>
                                {row.value < 0 ? "+" : ""}
                                {money(Math.abs(row.value))}
                              </strong>
                            </div>
                            {row.note && (
                              <div className={catalogStyles.itemCardDetailLine}>
                                <span>Note</span>
                                <strong>{row.note}</strong>
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
          </section>
        </>
      ) : null}

      <Modal
        open={editTarget !== null}
        onClose={closeEdit}
        title={
          editTarget?.kind === "stock_entries"
            ? `Edit ${editTarget.item_name} — ${editTarget.entry_date}`
            : editTarget?.kind === "ingredient_entries"
              ? editTarget.mode === "create"
                ? "New ingredient entry"
                : `Edit ${editTarget.ingredient_name} — ${editTarget.entry_date}`
              : "Edit entry"
        }
        footer={
          <>
            <Button variant="tertiary" onClick={closeEdit} disabled={editSubmitting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={submitEdit}
              disabled={editSubmitting || resolvedCascadeImpact === null}
            >
              {editSubmitting
                ? "Saving…"
                : resolvedCascadeImpact && resolvedCascadeImpact.count > 0 && !cascadeConfirmed
                  ? "Continue"
                  : "Save"}
            </Button>
          </>
        }
      >
        {editTarget && (
          <div className={styles.editForm}>
            <p className={styles.editFormMeta}>
              {editTarget.kind === "ingredient_entries" && editTarget.mode === "create"
                ? "Logs a new receiving/usage entry the same way the store manager would from /store. Buying price is taken from the current ingredient catalog. If an entry already exists for this ingredient and date, saving will update it instead."
                : "Only quantities are editable here — prices stay locked to what was recorded at the time."}
            </p>
            {/* Historical-edit cascade warning — shown once the impact
                check (useEffect above) confirms this isn't the latest
                row. Resolved design decision: count + date range only,
                not a full before/after preview — enough for a sanity
                check without a bigger UI lift. The Save button reads
                "Continue" until this has been seen once (cascadeConfirmed),
                so the admin can't blow past it by habit-clicking Save. */}
            {resolvedCascadeImpact && resolvedCascadeImpact.count > 0 && (
              <p className={styles.cascadeWarning}>
                This will also recalculate {resolvedCascadeImpact.count}{" "}
                {resolvedCascadeImpact.count === 1 ? "later entry" : "later entries"} for this{" "}
                {editTarget.kind === "stock_entries" ? "item" : "ingredient"}, through{" "}
                {resolvedCascadeImpact.through}.
                {!cascadeConfirmed && " Click Continue to review, then Save to confirm."}
              </p>
            )}
            {editError && <p className={catalogStyles.formError}>{editError}</p>}

            {editTarget.kind === "ingredient_entries" && editTarget.mode === "create" && (
              <>
                <Select
                  label="Ingredient"
                  value={editTarget.ingredient_id}
                  options={ingredientCatalog.map((ing) => ({
                    value: ing.id,
                    label: `${ing.name} (${ing.unit})`,
                  }))}
                  onChange={(e) => {
                    const selected = ingredientCatalog.find((ing) => ing.id === e.target.value);
                    setEditTarget({
                      ...editTarget,
                      ingredient_id: e.target.value,
                      ingredient_name: selected?.name ?? "",
                      unit: selected?.unit ?? "",
                    });
                  }}
                />
                <Input
                  label="Date"
                  type="date"
                  value={editTarget.entry_date}
                  max={nairobiToday()}
                  onChange={(e) => setEditTarget({ ...editTarget, entry_date: e.target.value })}
                />
              </>
            )}

            {editTarget.kind === "stock_entries" ? (
              <>
                <Input
                  label="Till sales"
                  type="number"
                  numeric
                  value={editForm.till_quantity_sold}
                  onChange={(e) =>
                    setEditForm({ ...editForm, till_quantity_sold: Number(e.target.value) })
                  }
                />
                <Input
                  label="Added stock"
                  type="number"
                  numeric
                  value={editForm.added_stock}
                  onChange={(e) => setEditForm({ ...editForm, added_stock: Number(e.target.value) })}
                />
                {editTarget.location === "restaurant" && (
                  <Input
                    label="Sent to canteen"
                    type="number"
                    numeric
                    value={editForm.sent_out}
                    onChange={(e) => setEditForm({ ...editForm, sent_out: Number(e.target.value) })}
                  />
                )}
                <Select
                  label="Non-sales stock consumption"
                  value={consumptionCategory}
                  options={CONSUMPTION_CATEGORY_OPTIONS}
                  onChange={(e) => setConsumptionCategory(e.target.value as NonSalesConsumptionCategory)}
                />
                {consumptionCategory === "wastage" ? (
                  <Input
                    label="Wastage"
                    type="number"
                    numeric
                    value={editForm.wastage}
                    onChange={(e) => setEditForm({ ...editForm, wastage: Number(e.target.value) })}
                  />
                ) : (
                  <>
                    <p className={styles.editFormMeta}>
                      Logs a new{" "}
                      {consumptionCategory === "staff_meal"
                        ? "staff meal"
                        : consumptionCategory === "complimentary_meal"
                          ? "complimentary meal"
                          : "stock adjustment"}{" "}
                      claim for {editTarget.item_name} on {editTarget.entry_date}.
                    </p>
                    <Select
                      label="Who is this for?"
                      placeholder="Choose who this is for…"
                      value={consumptionStaffId}
                      options={staffRoster
                        .filter(
                          (person) =>
                            person.active &&
                            // Location-scoped staff at this claim's own
                            // location, plus the admin's own account
                            // (client feedback, 2026-07-24 — she may
                            // personally consume/give away stock too,
                            // not just attribute claims to staff).
                            ((person.role === "staff" && person.location === editTarget.location) ||
                              person.role === "admin"),
                        )
                        .map((person) => ({ value: person.id, label: person.name }))}
                      onChange={(e) => setConsumptionStaffId(e.target.value)}
                    />
                    {consumptionCategory === "stock_adjustment" && (
                      <Select
                        label="Direction"
                        value={consumptionDirection}
                        options={[
                          { value: "shortfall", label: "Remove (missing stock)" },
                          { value: "surplus", label: "Add (found extra)" },
                        ]}
                        onChange={(e) =>
                          setConsumptionDirection(e.target.value as "shortfall" | "surplus")
                        }
                      />
                    )}
                    <Input
                      label="Quantity"
                      type="number"
                      numeric
                      min={0}
                      value={consumptionQuantity}
                      onChange={(e) => setConsumptionQuantity(Number(e.target.value))}
                    />
                    <Input
                      label="Note (optional)"
                      value={consumptionNote}
                      onChange={(e) => setConsumptionNote(e.target.value)}
                    />
                  </>
                )}
              </>
            ) : (
              <>
                <Input
                  label="Received"
                  type="number"
                  numeric
                  value={editForm.received}
                  onChange={(e) => setEditForm({ ...editForm, received: Number(e.target.value) })}
                />
                <Input
                  label="Used"
                  type="number"
                  numeric
                  value={editForm.quantity_used}
                  onChange={(e) =>
                    setEditForm({ ...editForm, quantity_used: Number(e.target.value) })
                  }
                />
                <Input
                  label="Wastage"
                  type="number"
                  numeric
                  value={editForm.wastage}
                  onChange={(e) => setEditForm({ ...editForm, wastage: Number(e.target.value) })}
                />
              </>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={settingsOpen}
        onClose={closeSettings}
        title="Cost ratio settings"
        footer={
          <>
            <Button variant="tertiary" onClick={closeSettings} disabled={settingsSubmitting}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submitSettings} disabled={settingsSubmitting || settingsLoading}>
              {settingsSubmitting ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        {settingsLoading ? (
          <p>Loading…</p>
        ) : (
          <div className={styles.editForm}>
            <p>
              Wastage and staff-meal/complimentary-meal/stock-adjustment quantities are valued at this fraction of
              the item&apos;s selling price — for reporting only. This never affects cost of goods sold or net
              profit.
            </p>
            <Input
              label="Cost ratio (0–1, e.g. 0.6 for 60%)"
              type="number"
              numeric
              min={0}
              max={1}
              step={0.01}
              value={settingsRatio}
              onChange={(e) => setSettingsRatio(e.target.value)}
              error={settingsError ?? undefined}
            />
          </div>
        )}
      </Modal>

      {toast && <Toast message={toast} status="success" onDismiss={() => setToast(null)} />}
    </div>
  );
}
