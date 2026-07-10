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
