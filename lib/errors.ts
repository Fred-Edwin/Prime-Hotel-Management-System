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
      message: "The restaurant hasn't sent today's supply yet for this item.",
      status: 409,
    };
  }

  if (error.message.includes("oversell")) {
    return { message: "That's more than the available stock available.", status: 409 };
  }

  // create_staff_meal_entry() — the referenced item is inactive or was
  // deleted between the client loading the item picker and submitting
  // the claim. See docs/01_DATA_MODEL.md §3.5 (errcode P0004).
  if (error.code === "P0004" || error.message.includes("unknown_item")) {
    return { message: "That item is no longer available — refresh and try again.", status: 400 };
  }

  // record_order_payment()'s overpayment guard (Phase 11, credit ledger)
  // — a payment that would push an order's total paid beyond its
  // total_amount. See docs/01_DATA_MODEL.md §6, errcode P0005.
  if (error.code === "P0005" || error.message.includes("overpayment")) {
    return {
      message: "That payment is more than what's still owed on this order.",
      status: 409,
    };
  }

  // record_order_payment() — the referenced order doesn't exist or
  // isn't visible to the caller's own location (Phase 11). Distinct
  // from P0004's 'unknown_item' meaning above. See docs/01_DATA_MODEL.md
  // §6, errcode P0006.
  if (error.code === "P0006" || error.message.includes("unknown_order")) {
    return { message: "That order couldn't be found — refresh and try again.", status: 404 };
  }

  // record_canteen_stock_purchase()'s item-type guard (errcode 23514,
  // check_violation) — the item picker should already only offer
  // canteen_independent items, so this is a defensive fallback, not the
  // expected path. See 20260720110000_canteen_stock_purchases.sql.
  if (error.code === "23514" || error.message.includes("canteen_independent item")) {
    return {
      message: "That item can't have a canteen purchase logged — it's not a canteen-independent item.",
      status: 400,
    };
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
