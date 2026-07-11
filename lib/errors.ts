import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Translates a Postgres/PostgREST error from the entry-save RPCs
 * (save_stock_entry/save_ingredient_entry) into a human-readable message
 * + status code. Never surface a raw Postgres error string to staff —
 * "new row violates row-level security policy" means nothing to someone
 * logging today's till sales.
 */
export function describeSaveError(error: PostgrestError): { message: string; status: number } {
  if (error.message.includes("oversell")) {
    return { message: "That's more than the available stock available.", status: 409 };
  }

  // Postgres RLS violation (42501 = insufficient_privilege) — most
  // commonly hit here when trying to save an entry for a date that
  // isn't today, which only an admin can edit (see
  // 01_DATA_MODEL.md §4 and the same-day-owner update policies).
  if (error.code === "42501" || error.message.includes("row-level security policy")) {
    return {
      message: "You can only save today's entry. Ask an admin to correct an earlier date.",
      status: 403,
    };
  }

  return { message: "Couldn't save — please try again.", status: 500 };
}
