import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Standard response for an unexpected database/server error. Never surface
 * error.message (a raw Postgres/PostgREST string) to the client — logged
 * server-side for diagnosis, but the UI only ever sees a plain-language
 * fallback.
 */
export function serverErrorResponse(error: PostgrestError, context: string) {
  console.error(`[${context}]`, error);
  return NextResponse.json(
    { error: "Something went wrong on our end — please try again." },
    { status: 500 },
  );
}

/**
 * Translates a Postgres/PostgREST error from the entry-save RPCs
 * (save_stock_entry/save_ingredient_entry) into a human-readable message
 * + status code. Never surface a raw Postgres error string to staff —
 * "new row violates row-level security policy" means nothing to someone
 * logging today's till sales.
 */
export function describeSaveError(error: PostgrestError): { message: string; status: number } {
  // Distinct from a genuine oversell (below): the store manager hasn't
  // logged today's "Added stock" for this item yet, so total_stock is
  // just opening_stock and any till sale looks like it exceeds it —
  // even though the cashier did nothing wrong. See
  // docs/01_DATA_MODEL.md §3.4's cashier-autosave writer and
  // 20260717130000_stock_entry_cashier_autosave.sql (errcode P0002).
  if (error.code === "P0002" || error.message.includes("not_yet_stocked")) {
    return {
      message: "Ask the store manager to log today's added stock first.",
      status: 409,
    };
  }

  // Canteen-only equivalent of the case above, but the upstream actor is
  // the restaurant's daily sends, not a same-screen store-manager field
  // — see docs/01_DATA_MODEL.md §3.4's canteen autosave writer and
  // 20260717140000_stock_entry_canteen_autosave.sql (errcode P0003).
  if (error.code === "P0003" || error.message.includes("not_yet_supplied")) {
    return {
      message: "The restaurant hasn't sent this week's supply yet for this item.",
      status: 409,
    };
  }

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
