"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Modal } from "@/components/Modal";
import { nairobiToday } from "@/lib/calculations";

export interface AssetEventModalAsset {
  id: string;
  name: string;
  unit_cost: number;
}

export interface AssetEventModalProps {
  open: boolean;
  onClose: () => void;
  asset: AssetEventModalAsset | null;
  /**
   * 'purchase' — admin/restaurant-store-manager only (POST /api/asset-events
   * enforces this server-side too, this prop only decides which form the
   * modal renders). 'loss' — any staff member, at their own location.
   * See 20260728120000_assets.sql's scope note.
   */
  eventType: "purchase" | "loss";
  onSaved: () => void;
}

/**
 * Shared "Log purchase"/"Log loss" form for the asset register
 * (docs/01_DATA_MODEL.md's asset-register subsection) — always opened
 * already knowing which asset and which event type, mirroring
 * PurchaseModal's fixedIngredient shape but for assets, which have two
 * event types instead of one. Calls POST /api/asset-events, which
 * delegates to record_asset_event() (quantity-on-hand derived, no daily
 * row to fold into — see that migration's comment for why this is
 * simpler than ingredient purchases).
 */
export function AssetEventModal({ open, onClose, asset, eventType, onSaved }: AssetEventModalProps) {
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function resetForm() {
      setQuantity("");
      setUnitCost(asset ? String(asset.unit_cost) : "");
      setNote("");
      setError(null);
    }
    resetForm();
  }, [open, asset]);

  async function submit() {
    if (!asset) return;
    const parsedQuantity = Number(quantity);
    if (!quantity || !(parsedQuantity > 0)) {
      setError("Enter a quantity greater than 0.");
      return;
    }
    const parsedUnitCost = Number(unitCost);
    if (eventType === "purchase" && (unitCost === "" || parsedUnitCost < 0)) {
      setError("Enter a valid unit cost.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/asset-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset_id: asset.id,
          event_type: eventType,
          event_date: nairobiToday(),
          quantity: parsedQuantity,
          unit_cost: eventType === "purchase" ? parsedUnitCost : undefined,
          note: note.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Couldn't save — please try again.");
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const title = asset
    ? eventType === "purchase"
      ? `Log purchase — ${asset.name}`
      : `Log loss — ${asset.name}`
    : "Log asset event";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      {error && <p role="alert">{error}</p>}

      <Input
        label="Quantity"
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        numeric
        value={quantity}
        placeholder="0"
        onChange={(e) => setQuantity(e.target.value)}
      />

      {eventType === "purchase" && (
        <Input
          label="Unit cost (KES)"
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          numeric
          value={unitCost}
          placeholder="0"
          onChange={(e) => setUnitCost(e.target.value)}
        />
      )}

      <Input
        label={eventType === "purchase" ? "Supplier / note (optional)" : "Reason / note (optional)"}
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
    </Modal>
  );
}
