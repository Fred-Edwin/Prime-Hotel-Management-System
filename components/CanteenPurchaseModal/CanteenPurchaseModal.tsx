"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Modal } from "@/components/Modal";
import { Select, type SelectOption } from "@/components/Select";
import { nairobiToday } from "@/lib/calculations";

export interface CanteenPurchaseModalItem {
  id: string;
  name: string;
  /** Current weighted-average cost — prefills unit cost as a starting guess, editable. */
  buying_price: number;
}

export interface CanteenPurchaseModalProps {
  open: boolean;
  onClose: () => void;
  /** Omit when the item is fixed (opened from a specific stock-on-hand row) — shows a read-only identity line instead of a picker. */
  items?: CanteenPurchaseModalItem[];
  fixedItem?: CanteenPurchaseModalItem;
  onSaved: () => void;
}

/**
 * Admin's "Log purchase" form for canteen_independent items — same
 * shape as components/PurchaseModal (ingredients), kept as a separate
 * component rather than a generalized one because items have no `unit`
 * field the way ingredients do. Calls POST /api/canteen-purchases, which
 * folds the quantity into this week's stock_entries.added_stock and
 * recalculates items.buying_price as a fresh weighted-average cost —
 * see docs/01_DATA_MODEL.md §3.1/§13 and 20260720110000_canteen_stock_purchases.sql.
 */
export function CanteenPurchaseModal({ open, onClose, items, fixedItem, onSaved }: CanteenPurchaseModalProps) {
  const [itemId, setItemId] = useState(fixedItem?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [supplierNote, setSupplierNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = fixedItem ?? items?.find((i) => i.id === itemId);

  useEffect(() => {
    if (!open) return;
    setItemId(fixedItem?.id ?? "");
    setQuantity("");
    setUnitCost(selected ? String(selected.buying_price) : "");
    setSupplierNote("");
    setError(null);
    // Only reset when the modal opens or the fixed item changes — not on
    // every `selected` recompute, which would wipe an in-progress unit
    // cost edit whenever the picker's selection triggers a rerender.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fixedItem?.id]);

  function selectItem(id: string) {
    setItemId(id);
    const next = items?.find((i) => i.id === id);
    if (next) setUnitCost(String(next.buying_price));
  }

  async function submit() {
    if (!itemId) {
      setError("Select an item first.");
      return;
    }
    const parsedQuantity = Number(quantity);
    const parsedUnitCost = Number(unitCost);
    if (!quantity || !(parsedQuantity > 0)) {
      setError("Enter a quantity greater than 0.");
      return;
    }
    if (unitCost === "" || parsedUnitCost < 0) {
      setError("Enter a valid unit cost.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/canteen-purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_id: itemId,
          purchase_date: nairobiToday(),
          quantity: parsedQuantity,
          unit_cost: parsedUnitCost,
          supplier_note: supplierNote.trim() || null,
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

  const itemOptions: SelectOption[] = (items ?? []).map((i) => ({
    value: i.id,
    label: i.name,
  }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={fixedItem ? `Log purchase — ${fixedItem.name}` : "Log purchase"}
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

      {!fixedItem && (
        <Select
          label="Item"
          placeholder="Select an item"
          value={itemId}
          options={itemOptions}
          onChange={(e) => selectItem(e.target.value)}
        />
      )}

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
      <Input
        label="Supplier / note (optional)"
        type="text"
        value={supplierNote}
        onChange={(e) => setSupplierNote(e.target.value)}
      />
    </Modal>
  );
}
