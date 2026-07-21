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
 *
 * Post-launch (2026-07-21, client request): the picker's last option is
 * "+ Add new item…", which reveals name + selling price fields inline.
 * Submitting first calls POST /api/items (category defaults to "others",
 * supply_type forced to "canteen_independent") to create the catalog
 * row, then logs the purchase against the new id — admin-only end to
 * end, same as the rest of this modal.
 */
const NEW_ITEM_VALUE = "__new__";

export function CanteenPurchaseModal({ open, onClose, items, fixedItem, onSaved }: CanteenPurchaseModalProps) {
  const [itemId, setItemId] = useState(fixedItem?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [supplierNote, setSupplierNote] = useState("");
  const [newName, setNewName] = useState("");
  const [newSellingPrice, setNewSellingPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isNew = itemId === NEW_ITEM_VALUE;
  const selected = fixedItem ?? items?.find((i) => i.id === itemId);

  useEffect(() => {
    if (!open) return;
    function resetForm() {
      setItemId(fixedItem?.id ?? "");
      setQuantity("");
      setUnitCost(selected ? String(selected.buying_price) : "");
      setSupplierNote("");
      setNewName("");
      setNewSellingPrice("");
      setError(null);
    }
    resetForm();
    // Only reset when the modal opens or the fixed item changes — not on
    // every `selected` recompute, which would wipe an in-progress unit
    // cost edit whenever the picker's selection triggers a rerender.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fixedItem?.id]);

  function selectItem(id: string) {
    setItemId(id);
    if (id === NEW_ITEM_VALUE) {
      setUnitCost("");
      return;
    }
    const next = items?.find((i) => i.id === id);
    if (next) setUnitCost(String(next.buying_price));
  }

  async function submit() {
    if (!itemId) {
      setError("Select an item first.");
      return;
    }
    if (isNew && !newName.trim()) {
      setError("Enter the new item's name.");
      return;
    }
    const parsedSellingPrice = Number(newSellingPrice);
    if (isNew && (newSellingPrice === "" || !(parsedSellingPrice >= 0))) {
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
      let targetItemId = itemId;

      if (isNew) {
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

  const itemOptions: SelectOption[] = [
    ...(items ?? []).map((i) => ({
      value: i.id,
      label: i.name,
    })),
    { value: NEW_ITEM_VALUE, label: "+ Add new item…" },
  ];

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

      {isNew && (
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
