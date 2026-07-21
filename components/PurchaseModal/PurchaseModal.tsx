"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Modal } from "@/components/Modal";
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
  /** Set when opened from a specific ingredient's row (e.g. /store, or a /dashboard/purchases stock-on-hand row) — shows a read-only identity line, quantity/unit cost/note only. */
  fixedIngredient?: PurchaseModalIngredient;
  /** Set when opened via a page-level "Add new ingredient" action — no picker, straight to name + unit + quantity + cost. Mutually exclusive with fixedIngredient. */
  forceNew?: boolean;
  onSaved: () => void;
}

/**
 * Shared "Log purchase" form — used by both the store manager's /store
 * screen and admin's /dashboard/purchases screen, always opened already
 * knowing which ingredient it's for (fixedIngredient, from a specific
 * row) or that it's for a brand-new one (forceNew). Calls
 * POST /api/ingredient-purchases, which folds the quantity into today's
 * ingredient_entries.received and recalculates ingredients.buying_price
 * as a fresh weighted-average cost — see docs/01_DATA_MODEL.md §3.2's
 * purchases section and 20260719160000_ingredient_purchases.sql.
 *
 * Post-launch (2026-07-21, client request): forceNew reveals name + unit
 * fields instead of an ingredient picker. Submitting first calls
 * POST /api/ingredients to create the catalog row (allowed for the store
 * manager too, not just admin — see that route's canCreateIngredient()),
 * then logs the purchase against the new id. Originally this was a
 * picker with a "+ Add new ingredient…" option buried at the end of a
 * long dropdown of every existing ingredient — real client feedback
 * (2026-07-21, screenshot of the live picker) was that this made no
 * sense for the "I'm adding something new" case, since logging a
 * purchase for an *existing* ingredient already has its own entry point
 * (every stock-on-hand/store row). Simplified to two clean paths instead
 * of one picker trying to serve both.
 */
export function PurchaseModal({ open, onClose, fixedIngredient, forceNew, onSaved }: PurchaseModalProps) {
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [supplierNote, setSupplierNote] = useState("");
  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function resetForm() {
      setQuantity("");
      setUnitCost(fixedIngredient ? String(fixedIngredient.buying_price) : "");
      setSupplierNote("");
      setNewName("");
      setNewUnit("");
      setError(null);
    }
    resetForm();
  }, [open, fixedIngredient]);

  async function submit() {
    if (forceNew && !newName.trim()) {
      setError("Enter the new ingredient's name.");
      return;
    }
    if (forceNew && !newUnit.trim()) {
      setError("Enter the new ingredient's unit (e.g. kg, litre, piece).");
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
      let targetIngredientId = fixedIngredient?.id;

      if (forceNew) {
        const createRes = await fetch("/api/ingredients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newName.trim(),
            unit: newUnit.trim(),
            buying_price: parsedUnitCost,
            low_stock_threshold: 5,
            active: true,
          }),
        });
        const createBody = await createRes.json().catch(() => ({}));
        if (!createRes.ok) {
          setError(createBody.error ?? "Couldn't create the new ingredient — please try again.");
          return;
        }
        targetIngredientId = createBody.ingredient.id;
      }

      const res = await fetch("/api/ingredient-purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredient_id: targetIngredientId,
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
      title={fixedIngredient ? `Log purchase — ${fixedIngredient.name}` : "Add new ingredient"}
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
            label="New ingredient name"
            type="text"
            value={newName}
            placeholder="e.g. Cooking oil"
            onChange={(e) => setNewName(e.target.value)}
          />
          <Input
            label="Unit"
            type="text"
            value={newUnit}
            placeholder="e.g. kg, litre, piece"
            onChange={(e) => setNewUnit(e.target.value)}
          />
        </>
      )}

      <Input
        label={`Quantity${fixedIngredient ? ` (${fixedIngredient.unit})` : forceNew && newUnit.trim() ? ` (${newUnit.trim()})` : ""}`}
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
