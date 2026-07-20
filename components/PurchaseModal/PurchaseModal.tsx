"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Modal } from "@/components/Modal";
import { Select, type SelectOption } from "@/components/Select";
import { nairobiToday } from "@/lib/calculations";

export interface PurchaseModalIngredient {
  id: string;
  name: string;
  unit: string;
  /** Current weighted-average cost — prefills unit cost as a starting guess, editable. */
  buying_price: number;
}

export interface PurchaseModalProps {
  open: boolean;
  onClose: () => void;
  /** Omit when the ingredient is fixed (e.g. opened from a specific /store row) — shows a read-only identity line instead of a picker. */
  ingredients?: PurchaseModalIngredient[];
  fixedIngredient?: PurchaseModalIngredient;
  onSaved: () => void;
}

/**
 * Shared "Log purchase" form — used by both the store manager's /store
 * screen (fixedIngredient set, opened from a specific row) and admin's
 * /dashboard/purchases screen (ingredients set, admin picks from a list).
 * Both call the same POST /api/ingredient-purchases, which folds the
 * quantity into today's ingredient_entries.received and recalculates
 * ingredients.buying_price as a fresh weighted-average cost — see
 * docs/01_DATA_MODEL.md §3.2's purchases section and
 * 20260719160000_ingredient_purchases.sql.
 */
export function PurchaseModal({ open, onClose, ingredients, fixedIngredient, onSaved }: PurchaseModalProps) {
  const [ingredientId, setIngredientId] = useState(fixedIngredient?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [supplierNote, setSupplierNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = fixedIngredient ?? ingredients?.find((i) => i.id === ingredientId);

  useEffect(() => {
    if (!open) return;
    function resetForm() {
      setIngredientId(fixedIngredient?.id ?? "");
      setQuantity("");
      setUnitCost(selected ? String(selected.buying_price) : "");
      setSupplierNote("");
      setError(null);
    }
    resetForm();
    // Only reset when the modal opens or the fixed ingredient changes —
    // not on every `selected` recompute, which would wipe an in-progress
    // unit cost edit whenever the picker's selection triggers a rerender.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fixedIngredient?.id]);

  function selectIngredient(id: string) {
    setIngredientId(id);
    const next = ingredients?.find((i) => i.id === id);
    if (next) setUnitCost(String(next.buying_price));
  }

  async function submit() {
    if (!ingredientId) {
      setError("Select an ingredient first.");
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
      const res = await fetch("/api/ingredient-purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredient_id: ingredientId,
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

  const ingredientOptions: SelectOption[] = (ingredients ?? []).map((i) => ({
    value: i.id,
    label: `${i.name} (${i.unit})`,
  }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={fixedIngredient ? `Log purchase — ${fixedIngredient.name}` : "Log purchase"}
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

      {!fixedIngredient && (
        <Select
          label="Ingredient"
          placeholder="Select an ingredient"
          value={ingredientId}
          options={ingredientOptions}
          onChange={(e) => selectIngredient(e.target.value)}
        />
      )}

      <Input
        label={`Quantity${selected ? ` (${selected.unit})` : ""}`}
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
