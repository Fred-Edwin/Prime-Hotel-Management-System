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
  "stationery",
  "dawa",
  "sweets",
  "biscuits",
  "packing_supplies",
  "others",
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
  low_stock_threshold: nonNegativeAmount,
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
  // Exactly 6 digits, matching Supabase Auth's minimum_password_length=6
  // (config.toml, mirrored in the production project) — a shorter PIN
  // passes this schema but fails at the Auth layer, which for
  // admin.createUser fails silently on account creation (Phase 8 hit
  // this: production PINs were all reset to 6 characters) and for
  // admin.updateUserById (Phase 9's PIN reset) throws an
  // AuthWeakPasswordError. Matching the real constraint here means
  // staff creation/PIN reset fail fast with a clear message instead of
  // a confusing 500 three steps later.
  pin: z.string().regex(/^\d{6}$/, "PIN must be exactly 6 digits"),
  role: z.enum(["admin", "staff"]),
  location: z.enum(["restaurant", "canteen"]).nullable(),
  is_store_manager: z.boolean(),
});

export type StaffCreateInput = z.infer<typeof staffCreateSchema>;

/**
 * Phase 9 — editing an existing staff account (name/role/location/
 * store-manager flag, and active status). `pin` is intentionally
 * excluded here: a PIN reset is a distinct, separate action
 * (staffPinResetSchema below) so the edit form can never accidentally
 * clear/overwrite a PIN as a side effect of an unrelated field edit.
 */
export const staffUpdateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  role: z.enum(["admin", "staff"]),
  location: z.enum(["restaurant", "canteen"]).nullable(),
  is_store_manager: z.boolean(),
  active: z.boolean(),
});

export type StaffUpdateInput = z.infer<typeof staffUpdateSchema>;

/**
 * Phase 9 — admin-initiated PIN reset for an existing staff account.
 * Exactly 6 digits — see staffCreateSchema's comment for why.
 */
export const staffPinResetSchema = z.object({
  pin: z.string().regex(/^\d{6}$/, "PIN must be exactly 6 digits"),
});

export type StaffPinResetInput = z.infer<typeof staffPinResetSchema>;

/**
 * Shared non-negative quantity field for stock/ingredient entry rows —
 * same rationale as nonNegativeAmount, but for quantities rather than money.
 */
const nonNegativeQuantity = z
  .number({ error: "Enter a valid number" })
  .nonnegative("Must be 0 or greater");

/**
 * One item's till-sale line on the daily restaurant entry screen — see
 * docs/01_DATA_MODEL.md §2 `stock_entries`, §3.4 (till_quantity_sold is
 * the only field this route writes; quantity_sold is server-derived).
 * No added_stock/sent_out: those moved to the store manager's own PUT
 * autosave (see stockEntryLineSaveSchema below) — this is regular
 * (non-store-manager) staff's field only, and their client-side
 * added_stock/sent_out would otherwise be a stale page-load snapshot
 * that could clobber a concurrent store-manager edit (post-launch
 * correction, see 20260717093000_preserve_wastage_on_stock_entry_save.sql).
 * No wastage/wastage_note either: /entry no longer collects wastage
 * (post-launch correction to §3.3, same precedent as
 * ingredient_entries.wastage) — the route always preserves whatever
 * wastage the row already has.
 */
export const stockEntryLineSchema = z.object({
  item_id: z.string().uuid(),
  till_quantity_sold: nonNegativeQuantity,
});

export type StockEntryLineInput = z.infer<typeof stockEntryLineSchema>;

/** Batch save payload for POST /api/stock-entries — one save per day's sheet. */
export const stockEntriesSaveSchema = z.object({
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  lines: z.array(stockEntryLineSchema).min(1, "No items to save"),
});

export type StockEntriesSaveInput = z.infer<typeof stockEntriesSaveSchema>;

/**
 * Single-line autosave payload for PUT /api/stock-entries — the
 * store-manager's "Added stock"/"Sent to canteen" fields on /entry
 * autosave per field (post-launch redesign) instead of batching behind
 * the day's Save button, mirroring PUT /api/ingredient-entries. No
 * till_quantity_sold here: that field stays on the batch POST path,
 * written only by the till-entry flow (docs/01_DATA_MODEL.md §3.4). No
 * wastage/wastage_note: removed from /entry entirely (post-launch
 * correction to §3.3, same precedent as ingredient_entries.wastage) —
 * this route always saves wastage as 0.
 */
export const stockEntryLineSaveSchema = z.object({
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  item_id: z.string().uuid(),
  added_stock: nonNegativeQuantity,
  sent_out: nonNegativeQuantity,
});

export type StockEntryLineSaveInput = z.infer<typeof stockEntryLineSaveSchema>;

/**
 * Single-line autosave payload for the cashier's own PUT /api/stock-entries
 * branch — regular (non-store-manager) restaurant staff's "quantity sold"
 * field on /entry autosaves per item (post-launch redesign) instead of
 * batching behind the day's Save button, mirroring the store manager's
 * own autosave above. No added_stock/sent_out here: those stay
 * store-manager-only (stockEntryLineSaveSchema above); this route only
 * ever owns till_quantity_sold.
 */
export const stockEntryCashierLineSaveSchema = z.object({
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  item_id: z.string().uuid(),
  till_quantity_sold: nonNegativeQuantity,
});

export type StockEntryCashierLineSaveInput = z.infer<typeof stockEntryCashierLineSaveSchema>;

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
 * Single-line autosave payload for PUT /api/ingredient-entries — /store's
 * per-field autosave (received or used-in-cooking blurred) saves one
 * ingredient's line at a time rather than the whole day's sheet. No
 * wastage/wastage_note here: wastage entry moved to admin (see
 * docs/01_DATA_MODEL.md §3.3's Phase 10 correction) — this route always
 * saves wastage as 0 for the store manager's own edits.
 */
export const ingredientEntryLineSaveSchema = z.object({
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  ingredient_id: z.string().uuid(),
  received: nonNegativeQuantity,
  quantity_used: nonNegativeQuantity,
});

export type IngredientEntryLineSaveInput = z.infer<typeof ingredientEntryLineSaveSchema>;

/**
 * POST /api/ingredient-purchases — logged by admin or the store manager
 * (docs/01_DATA_MODEL.md §3.2's purchases section). quantity must be > 0
 * (a purchase always adds stock, unlike received/quantity_used which can
 * legitimately be 0 on a day with no activity) — matches the
 * ingredient_purchases table's `check (quantity > 0)` constraint.
 */
export const ingredientPurchaseSchema = z.object({
  ingredient_id: z.string().uuid(),
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  quantity: z.number({ error: "Enter a valid number" }).positive("Must be greater than 0"),
  unit_cost: nonNegativeAmount,
  supplier_note: z.string().trim().min(1).nullable().optional(),
});

export type IngredientPurchaseInput = z.infer<typeof ingredientPurchaseSchema>;

/**
 * Admin's canteen stock purchase log — mirrors ingredientPurchaseSchema
 * exactly, for canteen_independent items only (enforced server-side by
 * record_canteen_stock_purchase()'s own item.supply_type check, not
 * re-validated here — this schema only shapes the input).
 */
export const canteenStockPurchaseSchema = z.object({
  item_id: z.string().uuid(),
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  quantity: z.number({ error: "Enter a valid number" }).positive("Must be greater than 0"),
  unit_cost: nonNegativeAmount,
  supplier_note: z.string().trim().min(1).nullable().optional(),
});

export type CanteenStockPurchaseInput = z.infer<typeof canteenStockPurchaseSchema>;

/**
 * One item's line on the canteen weekly reconciliation screen — see
 * docs/01_DATA_MODEL.md §3.1. No sent_out (canteen never forwards stock).
 * added_stock is only accepted from the client for canteen_independent
 * items; the route ignores it for canteen_supplied items and derives the
 * value server-side via canteen_supplied_total() instead (never trusted
 * from the client, same principle as opening_stock). No wastage/wastage_note:
 * /entry no longer collects wastage (post-launch correction to §3.3) —
 * the route always saves wastage as 0 for its own writes.
 */
export const canteenStockEntryLineSchema = z.object({
  item_id: z.string().uuid(),
  till_quantity_sold: nonNegativeQuantity,
  added_stock: nonNegativeQuantity,
});

export type CanteenStockEntryLineInput = z.infer<typeof canteenStockEntryLineSchema>;

/** Batch save payload for POST /api/stock-entries when called by canteen staff. */
export const canteenStockEntriesSaveSchema = z.object({
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  lines: z.array(canteenStockEntryLineSchema).min(1, "No items to save"),
});

export type CanteenStockEntriesSaveInput = z.infer<typeof canteenStockEntriesSaveSchema>;

/**
 * Single-field autosave payload for the canteen branch of
 * PUT /api/stock-entries (post-launch redesign) — Anne's weekly
 * reconciliation screen autosaves "Quantity sold" (every item) and
 * "Added stock" (canteen_independent items only) independently, each on
 * its own debounce timer, unlike the restaurant's role-gated split.
 * Exactly one of the two quantity fields is required per call — the
 * route only ever autosaves whichever field the staffer just edited,
 * passing the other as omitted (preserve semantics in
 * save_stock_entry_canteen_field()). `entry_date` is whatever date the
 * client has loaded; the route re-normalizes it to that week's Monday
 * server-side, same as the GET/POST canteen paths (§3.1) — never
 * trusted verbatim.
 */
export const canteenStockEntryFieldSaveSchema = z
  .object({
    entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
    item_id: z.string().uuid(),
    till_quantity_sold: nonNegativeQuantity.optional(),
    added_stock: nonNegativeQuantity.optional(),
  })
  .refine((data) => data.till_quantity_sold !== undefined || data.added_stock !== undefined, {
    message: "Provide either till_quantity_sold or added_stock",
  });

export type CanteenStockEntryFieldSaveInput = z.infer<typeof canteenStockEntryFieldSaveSchema>;

/**
 * Admin direct ledger-row edit (docs/backlog/04_admin_ledger_edit.md) —
 * PATCH /api/dashboard/ledger/entry. Quantities only: price snapshots are
 * permanently immutable through this feature (resolved design decision #2),
 * and quantity_sold/closing_stock are never accepted from the client —
 * they're re-derived server-side by the same save_stock_entry()/
 * save_canteen_stock_entry()/save_ingredient_entry() functions staff
 * writes already use.
 */
export const stockEntryAdminEditSchema = z.object({
  table: z.literal("stock_entries"),
  item_id: z.string().uuid(),
  location: z.enum(["restaurant", "canteen"]),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  till_quantity_sold: nonNegativeQuantity,
  added_stock: nonNegativeQuantity,
  sent_out: nonNegativeQuantity,
  wastage: nonNegativeQuantity,
  wastage_note: z.string().trim().min(1).nullable().optional(),
});

export type StockEntryAdminEditInput = z.infer<typeof stockEntryAdminEditSchema>;

export const ingredientEntryAdminEditSchema = z.object({
  table: z.literal("ingredient_entries"),
  ingredient_id: z.string().uuid(),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  received: nonNegativeQuantity,
  quantity_used: nonNegativeQuantity,
  wastage: nonNegativeQuantity,
  wastage_note: z.string().trim().min(1).nullable().optional(),
});

export type IngredientEntryAdminEditInput = z.infer<typeof ingredientEntryAdminEditSchema>;

export const ledgerEntryAdminEditSchema = z.discriminatedUnion("table", [
  stockEntryAdminEditSchema,
  ingredientEntryAdminEditSchema,
]);

export type LedgerEntryAdminEditInput = z.infer<typeof ledgerEntryAdminEditSchema>;

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

/**
 * Expense log entry — see docs/01_DATA_MODEL.md §2 `expenses`. Submitted
 * one at a time (not a batch sheet like stock_entries), scoped server-side
 * to the caller's own location — see app/api/expenses/route.ts.
 *
 * `category_id` references the admin-managed public.expense_categories
 * catalog (post-launch addition, 2026-07-21 — see
 * 20260721090000_expense_categories_catalog.sql) — no longer a fixed
 * enum. Same "live FK, not a snapshot" choice as stock_entries.item_id:
 * renaming a category should relabel past entries consistently.
 */
export const expenseSchema = z.object({
  category_id: z.string().uuid("Choose a category"),
  amount: nonNegativeAmount,
  note: z.string().trim().min(1).nullable().optional(),
});

export type ExpenseInput = z.infer<typeof expenseSchema>;

/**
 * Admin expense log entry — same shape as expenseSchema, plus an explicit
 * location choice: 'restaurant' | 'canteen' | null (business-wide, e.g.
 * rent, salaries — see 20260721070000_admin_business_wide_expenses.sql).
 * Staff never send `location`; it stays server-derived from their session.
 */
export const adminExpenseSchema = z.object({
  category_id: z.string().uuid("Choose a category"),
  amount: nonNegativeAmount,
  note: z.string().trim().min(1).nullable().optional(),
  location: z.enum(["restaurant", "canteen"]).nullable(),
});

export type AdminExpenseInput = z.infer<typeof adminExpenseSchema>;

/**
 * Admin edit of an existing expense — every field optional/independent
 * (a PATCH, not a full replace), all admin-only per expenses_update_admin_only
 * RLS. location follows the same 'restaurant' | 'canteen' | null
 * business-wide convention as adminExpenseSchema.
 */
export const expenseUpdateSchema = z.object({
  category_id: z.string().uuid("Choose a category").optional(),
  amount: nonNegativeAmount.optional(),
  note: z.string().trim().min(1).nullable().optional(),
  location: z.enum(["restaurant", "canteen"]).nullable().optional(),
  expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date").optional(),
});

export type ExpenseUpdateInput = z.infer<typeof expenseUpdateSchema>;

/**
 * Expense category catalog entry — admin-managed (add/rename/retire),
 * shared by both staff's and admin's /expenses category pickers. See
 * 20260721090000_expense_categories_catalog.sql.
 */
export const expenseCategorySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60, "Keep it under 60 characters"),
  active: z.boolean().optional(),
});

export type ExpenseCategoryInput = z.infer<typeof expenseCategorySchema>;

/**
 * Staff meal claim — see docs/01_DATA_MODEL.md §3.5,
 * docs/backlog/02_staff_meals.md. Item + quantity, not a free-text cash
 * amount (confirmed design) — value is always derived server-side from
 * the item's buying_price, never accepted from the client. Submitted one
 * at a time from the new "Staff meals" tab on /expenses, same cadence as
 * expenseSchema.
 */
export const staffMealSchema = z.object({
  item_id: z.string().uuid(),
  quantity: z.number({ error: "Enter a valid quantity" }).positive("Quantity must be greater than 0"),
  note: z.string().trim().min(1).nullable().optional(),
});

export type StaffMealInput = z.infer<typeof staffMealSchema>;

/**
 * Complimentary meal claim / stock adjustment claim — see
 * docs/backlog/05_stock_consumption.md. Identical shape to
 * staffMealSchema above (item + quantity, not a free-text cash amount or
 * a signed delta) — both are separate, distinctly-labeled reporting
 * categories under the same "Stock Consumption" umbrella, submitted from
 * their own tabs on /expenses, same cadence as staff meals.
 */
export const complimentaryMealSchema = z.object({
  item_id: z.string().uuid(),
  quantity: z.number({ error: "Enter a valid quantity" }).positive("Quantity must be greater than 0"),
  note: z.string().trim().min(1).nullable().optional(),
});

export type ComplimentaryMealInput = z.infer<typeof complimentaryMealSchema>;

/**
 * Signed (docs/backlog/05_stock_consumption.md, 2026-07-22 — client
 * feedback that recounts sometimes find MORE stock than the system
 * shows, not just less): positive quantity = shortfall (missing stock,
 * same direction as every other consumption category), negative =
 * surplus (found extra, added back). Only complimentaryMealSchema/
 * staffMealSchema stay strictly positive — stock adjustments are the one
 * category that can go either direction.
 */
export const stockAdjustmentSchema = z.object({
  item_id: z.string().uuid(),
  quantity: z
    .number({ error: "Enter a valid quantity" })
    .refine((n) => n !== 0, "Quantity can't be zero"),
  note: z.string().trim().min(1).nullable().optional(),
});

export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;

/**
 * App settings (docs/01_DATA_MODEL.md §3.11, post-launch addition
 * 2026-07-23): a single business-wide, admin-editable ratio used ONLY as
 * the fallback cost-per-unit for wastage_estimated_value/estimated_value
 * reporting figures when an item's real buying_price is 0 — see
 * lib/calculations.ts's effectiveUnitCost(). Stored as a 0–1 fraction
 * (0.60 = 60% of selling price), matching app_settings.estimated_cost_ratio's
 * numeric(4,3) check constraint.
 */
export const appSettingsSchema = z.object({
  estimated_cost_ratio: z
    .number({ error: "Enter a valid number" })
    .min(0, "Must be 0 or greater")
    .max(1, "Must be 1 or less (enter 0.6 for 60%, not 60)"),
});

export type AppSettingsInput = z.infer<typeof appSettingsSchema>;
