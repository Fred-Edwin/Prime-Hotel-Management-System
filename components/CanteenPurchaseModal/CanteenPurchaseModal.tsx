"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Modal } from "@/components/Modal";
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
  /** Set when opened from a specific item's stock-on-hand row — shows a read-only identity line, quantity/unit cost/note only. */
  fixedItem?: CanteenPurchaseModalItem;
  /** Set when opened via a page-level "Add new item" action — no picker, straight to name + selling price + quantity + cost. Mutually exclusive with fixedItem. */
  forceNew?: boolean;
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
 *
 * Post-launch (2026-07-21, client request): forceNew reveals name +
 * selling price fields instead of an item picker. Submitting first
 * calls POST /api/items (category defaults to "others", supply_type
 * forced to "canteen_independent") to create the catalog row, then logs
 * the purchase against the new id — admin-only end to end, same as the
 * rest of this modal. Originally this was a picker with a "+ Add new
 * item…" option at the end of a long dropdown of every existing item;
 * real client feedback (screenshot of the live picker) was that this
 * made no sense for the "I'm adding something new" case, since an
 * *existing* item's purchase already has its own entry point (every
 * stock-on-hand row). Simplified to two clean paths instead of one
 * picker trying to serve both — see PurchaseModal's matching note.
 */
export function CanteenPurchaseModal({ open, onClose, fixedItem, forceNew, onSaved }: CanteenPurchaseModalProps) {
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [supplierNote, setSupplierNote] = useState("");
  const [newName, setNewName] = useState("");
  const [newSellingPrice, setNewSellingPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function resetForm() {
      setQuantity("");
      setUnitCost(fixedItem ? String(fixedItem.buying_price) : "");
      setSupplierNote("");
      setNewName("");
      setNewSellingPrice("");
      setError(null);
    }
    resetForm();
  }, [open, fixedItem]);

  async function submit() {
    if (forceNew && !newName.trim()) {
      setError("Enter the new item's name.");
      return;
    }
    const parsedSellingPrice = Number(newSellingPrice);
    if (forceNew && (newSellingPrice === "" || !(parsedSellingPrice >= 0))) {
      setError("Enter the new item's selling price.");
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
      let targetItemId = fixedItem?.id;

      if (forceNew) {
        const createRes = await fetch("/api/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newName.trim(),
            category: "others",
            supply_type: "canteen_independent",
            buying_price: parsedUnitCost,
            selling_price: parsedSellingPrice,
            low_stock_threshold: 5,
            active: true,
          }),
        });
        const createBody = await createRes.json().catch(() => ({}));
        if (!createRes.ok) {
          setError(createBody.error ?? "Couldn't create the new item — please try again.");
          return;
        }
        targetItemId = createBody.item.id;
      }

      const res = await fetch("/api/canteen-purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_id: targetItemId,
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={fixedItem ? `Log purchase — ${fixedItem.name}` : "Add new item"}
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

      {forceNew && (
        <>
          <Input
            label="New item name"
            type="text"
            value={newName}
            placeholder="e.g. Printing paper"
            onChange={(e) => setNewName(e.target.value)}
          />
          <Input
            label="Selling price (KES)"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            numeric
            value={newSellingPrice}
            placeholder="0"
            onChange={(e) => setNewSellingPrice(e.target.value)}
          />
        </>
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
