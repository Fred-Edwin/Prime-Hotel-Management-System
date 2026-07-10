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
