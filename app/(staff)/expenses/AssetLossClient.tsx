"use client";

import { useMemo, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { SearchBar } from "@/components/SearchBar";
import { Stepper } from "@/components/Stepper";
import { Input } from "@/components/Input";
import { Toast } from "@/components/Toast";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { nairobiToday } from "@/lib/calculations";
import styles from "./expenses.module.css";

interface AssetOption {
  id: string;
  name: string;
  category: string;
  unit_cost: number;
  quantity_on_hand: number;
}

interface AssetLossRow {
  id: string;
  quantity: number;
  total_cost: number;
  note: string | null;
  created_at: string;
  assets: { name: string } | null;
  users: { name: string } | null;
}

function todayISO(): string {
  return nairobiToday();
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-KE", { hour: "numeric", minute: "2-digit" });
}

/**
 * "Log loss" tab on /expenses (docs/01_DATA_MODEL.md's asset-register
 * subsection, post-launch, 2026-07-28) — any staff member, at their own
 * location, can log breakage/theft of a durable asset (utensil,
 * cookware). Deliberately NOT built on top of StockConsumptionClient:
 * that component is parameterized around sellable ITEMS (item_category
 * enum, buying_price, an *_available_stock() RPC keyed on item_id) —
 * assets have none of that shape (free-text category, no menu-item
 * concept, on-hand quantity keyed on asset_id via
 * dashboard_assets_on_hand()). A small dedicated component matching the
 * same picker/stepper/list interaction conventions was judged clearer
 * than bending a mismatched abstraction to fit.
 *
 * GET /api/assets already returns each asset's derived quantity_on_hand
 * (own-location + shared + admin-sees-all per assets_select_own_location_or_admin,
 * 20260728120000_assets.sql) — no separate available-stock endpoint
 * needed. POST /api/asset-events with event_type: 'loss' is open to any
 * authenticated staff member (no store-manager gate); record_asset_event()
 * is the real oversell-style enforcement (errcode P0008 if the loss would
 * take on-hand negative), the client-side stepper cap below is a UX
 * convenience on top of it, not a replacement.
 */
export function AssetLossClient() {
  const today = todayISO();
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [losses, setLosses] = useState<AssetLossRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [assetId, setAssetId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; status: "success" | "error" } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const [assetsRes, eventsRes] = await Promise.all([
        fetch("/api/assets"),
        fetch(`/api/asset-events?period=today`),
      ]);
      const assetsBody = await assetsRes.json();
      const eventsBody = await eventsRes.json();
      if (cancelled) return;

      if (!assetsRes.ok) {
        setToast({ message: assetsBody.error ?? "Couldn't load assets", status: "error" });
        setLoading(false);
        return;
      }

      setAssets(assetsBody.assets ?? []);
      setLosses(
        ((eventsBody.events ?? []) as (AssetLossRow & { event_type: string })[]).filter(
          (e) => e.event_type === "loss",
        ),
      );
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [today]);

  const canSave = !submitting && assetId.length > 0 && quantity > 0;
  const selectedAsset = assets.find((asset) => asset.id === assetId) ?? null;

  const visibleAssets = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return assets.filter((asset) => !term || asset.name.toLowerCase().includes(term));
  }, [assets, searchTerm]);

  function resetForm() {
    setAssetId("");
    setSearchTerm("");
    setQuantity(1);
    setNote("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/asset-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset_id: assetId,
          event_type: "loss",
          event_date: today,
          quantity,
          note: note.trim() ? note.trim() : null,
        }),
      });
      const body = await res.json();

      if (!res.ok) {
        setToast({ message: body.error ?? "Couldn't save this entry", status: "error" });
        return;
      }

      setLosses((prev) => [
        {
          id: body.event.id,
          quantity: body.event.quantity,
          total_cost: body.event.total_cost,
          note: body.event.note,
          created_at: body.event.created_at,
          assets: selectedAsset ? { name: selectedAsset.name } : null,
          users: null,
        },
        ...prev,
      ]);
      setAssets((prev) =>
        prev.map((asset) =>
          asset.id === assetId ? { ...asset, quantity_on_hand: asset.quantity_on_hand - quantity } : asset,
        ),
      );
      setToast({ message: "Loss logged", status: "success" });
      resetForm();
    } catch {
      setToast({ message: "Couldn't reach the server — check your connection and try again.", status: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  const todayTotal = losses.reduce((sum, loss) => sum + loss.total_cost, 0);

  if (loading) {
    return <p className={styles.loading}>Loading…</p>;
  }

  if (assets.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="ingredients" size={48} />}
        heading="No assets yet"
        body="Ask an admin to add utensils/equipment before you can log a loss."
      />
    );
  }

  return (
    <div className={styles.page}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Asset</span>
          {selectedAsset ? (
            <div className={styles.selectedItemRow}>
              <div>
                <span className={styles.selectedItemName}>{selectedAsset.name}</span>
                <span className={styles.selectedItemMeta}>
                  On hand: {selectedAsset.quantity_on_hand}
                </span>
              </div>
              <button
                type="button"
                className={styles.changeItemButton}
                onClick={() => {
                  setAssetId("");
                  setSearchTerm("");
                }}
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <SearchBar value={searchTerm} onChange={setSearchTerm} placeholder="Search assets…" />
              {visibleAssets.length === 0 ? (
                <p className={styles.noResults}>No assets match &ldquo;{searchTerm}&rdquo;.</p>
              ) : (
                <ul className={styles.pickerList}>
                  {visibleAssets.map((asset) => (
                    <li key={asset.id}>
                      <button
                        type="button"
                        className={styles.pickerRow}
                        onClick={() => setAssetId(asset.id)}
                        disabled={asset.quantity_on_hand <= 0}
                      >
                        <span className={styles.pickerRowName}>{asset.name}</span>
                        <span className={styles.pickerRowMeta}>
                          {asset.category} · On hand: {asset.quantity_on_hand}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {selectedAsset && (
          <>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Quantity</span>
              <Stepper
                value={quantity}
                onChange={setQuantity}
                min={1}
                max={selectedAsset.quantity_on_hand}
                limitMessage={`Only ${selectedAsset.quantity_on_hand} on hand`}
                aria-label="Quantity"
              />
            </div>

            <Input
              label="Reason / note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. broken, missing"
            />

            <Button type="submit" variant="primary" fullWidth disabled={!canSave}>
              {submitting ? "Saving…" : "Log loss"}
            </Button>
          </>
        )}
      </form>

      <div className={styles.listSection}>
        <div className={styles.listHeader}>
          <h2 className={styles.listTitle}>Today&rsquo;s asset losses</h2>
          {losses.length > 0 && <span className={styles.listTotal}>KES {todayTotal.toFixed(2)}</span>}
        </div>

        {losses.length === 0 ? (
          <EmptyState
            icon={<Icon name="ingredients" size={48} />}
            heading="Nothing logged yet"
            body="Broken or missing utensils/equipment logged today will show up here."
          />
        ) : (
          <ul className={styles.expenseList}>
            {losses.map((loss) => (
              <li key={loss.id} className={styles.expenseRow}>
                <div>
                  <p className={styles.expenseCategory}>
                    {loss.quantity} × {loss.assets?.name ?? "Asset"}
                  </p>
                  <p className={styles.expenseNote}>
                    {formatTime(loss.created_at)} · {loss.users?.name ?? "You"}
                    {loss.note ? ` · ${loss.note}` : ""}
                  </p>
                </div>
                <span className={styles.expenseAmount}>KES {loss.total_cost.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {toast && <Toast message={toast.message} status={toast.status} onDismiss={() => setToast(null)} />}
    </div>
  );
}
