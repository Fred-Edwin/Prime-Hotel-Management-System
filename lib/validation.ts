import { z } from "zod";

/**
 * Login form: staff pick their name from a roster list and enter their
 * PIN. See docs/01_DATA_MODEL.md's auth note and lib/auth.ts for the
 * synthetic-email mapping this feeds into. Name collisions are handled
 * server-side (see app/api/auth/login/route.ts) — the login UX itself
 * is name-only, no staff_code shown or typed.
 */
export const loginSchema = z.object({
  name: z.string().min(1, "Select your name"),
  pin: z
    .string()
    .regex(/^\d{4,6}$/, "PIN must be 4–6 digits"),
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Shared money/quantity field: rejects negative values with a clear
 * message, per CLAUDE.md's "Prices/fees must be validated non-negative"
 * instruction (Phase 3). `selling_price`/`buying_price`/`fee` all use this.
 */
const nonNegativeAmount = z
  .number({ error: "Enter a valid number" })
  .nonnegative("Must be 0 or greater");

export const itemCategorySchema = z.enum([
  "beverages",
  "snacks",
  "meals",
  "fruits",
  "cyber",
  "retail",
  "ingredients",
]);

export const itemSupplyTypeSchema = z.enum([
  "restaurant_only",
  "canteen_supplied",
  "canteen_independent",
]);

/** Item Master form — see docs/01_DATA_MODEL.md §2 `items`. */
export const itemSchema = z.object({
  name: z.string().min(1, "Name is required"),
  category: itemCategorySchema,
  supply_type: itemSupplyTypeSchema,
  buying_price: nonNegativeAmount,
  selling_price: nonNegativeAmount,
  low_stock_threshold: nonNegativeAmount,
  active: z.boolean(),
});

export type ItemInput = z.infer<typeof itemSchema>;

/** Ingredient catalog form — see docs/01_DATA_MODEL.md §2 `ingredients`. */
export const ingredientSchema = z.object({
  name: z.string().min(1, "Name is required"),
  unit: z.string().min(1, "Unit is required"),
  buying_price: nonNegativeAmount,
  active: z.boolean(),
});

export type IngredientInput = z.infer<typeof ingredientSchema>;

/** Delivery Locations form — see docs/01_DATA_MODEL.md §2 `delivery_locations`. */
export const deliveryLocationSchema = z.object({
  name: z.string().min(1, "Name is required"),
  fee: nonNegativeAmount,
  active: z.boolean(),
});

export type DeliveryLocationInput = z.infer<typeof deliveryLocationSchema>;

/**
 * Staff account creation — see docs/01_DATA_MODEL.md §2 `users` and
 * scripts/seed-staff.ts for the synthetic-email/Auth-admin pattern this
 * feeds into. `location` is required for staff, absent (null) for admin.
 * `is_store_manager` only makes sense for restaurant staff — enforced in
 * the route handler, not here, since it's a cross-field business rule.
 */
export const staffCreateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  pin: z.string().regex(/^\d{4,6}$/, "PIN must be 4–6 digits"),
  role: z.enum(["admin", "staff"]),
  location: z.enum(["restaurant", "canteen"]).nullable(),
  is_store_manager: z.boolean(),
});

export type StaffCreateInput = z.infer<typeof staffCreateSchema>;

/**
 * Shared non-negative quantity field for stock/ingredient entry rows —
 * same rationale as nonNegativeAmount, but for quantities rather than money.
 */
const nonNegativeQuantity = z
  .number({ error: "Enter a valid number" })
  .nonnegative("Must be 0 or greater");

/**
 * One item's till/added/sent/wastage line on the daily restaurant entry
 * screen — see docs/01_DATA_MODEL.md §2 `stock_entries`, §3.4 (till_quantity_sold
 * is the only field this route writes; quantity_sold is server-derived).
 */
export const stockEntryLineSchema = z.object({
  item_id: z.string().uuid(),
  till_quantity_sold: nonNegativeQuantity,
  added_stock: nonNegativeQuantity,
  sent_out: nonNegativeQuantity,
  wastage: nonNegativeQuantity,
  wastage_note: z.string().trim().min(1).nullable().optional(),
});

export type StockEntryLineInput = z.infer<typeof stockEntryLineSchema>;

/** Batch save payload for POST /api/stock-entries — one save per day's sheet. */
export const stockEntriesSaveSchema = z.object({
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  lines: z.array(stockEntryLineSchema).min(1, "No items to save"),
});

export type StockEntriesSaveInput = z.infer<typeof stockEntriesSaveSchema>;

/**
 * One ingredient's received/used/wastage line on the store manager's
 * ingredient entry screen — see docs/01_DATA_MODEL.md §2 `ingredient_entries`.
 */
export const ingredientEntryLineSchema = z.object({
  ingredient_id: z.string().uuid(),
  received: nonNegativeQuantity,
  quantity_used: nonNegativeQuantity,
  wastage: nonNegativeQuantity,
  wastage_note: z.string().trim().min(1).nullable().optional(),
});

export type IngredientEntryLineInput = z.infer<typeof ingredientEntryLineSchema>;

/** Batch save payload for POST /api/ingredient-entries. */
export const ingredientEntriesSaveSchema = z.object({
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  lines: z.array(ingredientEntryLineSchema).min(1, "No ingredients to save"),
});

export type IngredientEntriesSaveInput = z.infer<typeof ingredientEntriesSaveSchema>;

/**
 * One item's line on the canteen weekly reconciliation screen — see
 * docs/01_DATA_MODEL.md §3.1. No sent_out (canteen never forwards stock).
 * added_stock is only accepted from the client for canteen_independent
 * items; the route ignores it for canteen_supplied items and derives the
 * value server-side via canteen_supplied_total() instead (never trusted
 * from the client, same principle as opening_stock).
 */
export const canteenStockEntryLineSchema = z.object({
  item_id: z.string().uuid(),
  till_quantity_sold: nonNegativeQuantity,
  added_stock: nonNegativeQuantity,
  wastage: nonNegativeQuantity,
  wastage_note: z.string().trim().min(1).nullable().optional(),
});

export type CanteenStockEntryLineInput = z.infer<typeof canteenStockEntryLineSchema>;

/** Batch save payload for POST /api/stock-entries when called by canteen staff. */
export const canteenStockEntriesSaveSchema = z.object({
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  lines: z.array(canteenStockEntryLineSchema).min(1, "No items to save"),
});

export type CanteenStockEntriesSaveInput = z.infer<typeof canteenStockEntriesSaveSchema>;

/**
 * Delivery/pickup order — see docs/01_DATA_MODEL.md §6, §3.4. `items` mirrors
 * a receipt's line items; `client_request_id` is the idempotency key the
 * client generates once per submit attempt and resends unchanged on retry
 * (§3.4 "Duplicate-submission protection"). Per-item location eligibility
 * (an item must be sellable at the order's own location) is checked in the
 * route handler against real item data, not here — this schema only
 * validates shape.
 */
export const orderItemLineSchema = z.object({
  item_id: z.string().uuid(),
  quantity: z.number({ error: "Enter a valid quantity" }).positive("Quantity must be greater than 0"),
});

export const orderFulfillmentTypeSchema = z.enum(["delivery", "pickup"]);

export const orderSchema = z
  .object({
    customer_name: z.string().trim().min(1, "Customer name is required"),
    fulfillment_type: orderFulfillmentTypeSchema,
    delivery_location_id: z.string().uuid().nullable(),
    items: z.array(orderItemLineSchema).min(1, "Add at least one item"),
    client_request_id: z.string().uuid(),
  })
  .refine((data) => data.fulfillment_type !== "delivery" || data.delivery_location_id !== null, {
    message: "Select a delivery zone",
    path: ["delivery_location_id"],
  });

export type OrderInput = z.infer<typeof orderSchema>;

export const expenseCategorySchema = z.enum(["electricity", "gas", "charcoal", "other"]);

/**
 * Expense log entry — see docs/01_DATA_MODEL.md §2 `expenses`. Submitted
 * one at a time (not a batch sheet like stock_entries), scoped server-side
 * to the caller's own location — see app/api/expenses/route.ts.
 */
export const expenseSchema = z.object({
  category: expenseCategorySchema,
  amount: nonNegativeAmount,
  note: z.string().trim().min(1).nullable().optional(),
});

export type ExpenseInput = z.infer<typeof expenseSchema>;
