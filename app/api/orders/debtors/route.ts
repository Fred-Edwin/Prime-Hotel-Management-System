import { NextResponse } from "next/server";
import { getActingContext } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";

/**
 * GET /api/orders/debtors
 *
 * Staff-facing equivalent of GET /api/admin/debtors (client feedback,
 * 2026-07-28 — "allow staff to record debtor payments"). Recording a
 * payment (POST /api/orders/[id]/payments) already worked for any
 * authenticated staff/admin user since Phase 11 — only the admin
 * debtors screen ever surfaced a way to find which order/customer to
 * pay against. This route gives staff that same lookup, scoped to
 * their own location rather than admin's both-locations view.
 *
 * Deliberately NOT a thin wrapper around /api/admin/debtors: that route
 * is gated by requireAdmin() and calls dashboard_debtors() with no
 * location filter at all, relying on admin's RLS bypass
 * (orders_select_scoped: `is_admin() or location = my_location()`) to
 * see both locations. Calling the same security-invoker
 * dashboard_debtors() as a real staff session instead naturally scopes
 * the underlying `orders` join to that staff member's own location via
 * the same RLS policy — no new SQL function needed, no location filter
 * to build here by hand. Gated with getActingContext() (not
 * requireAdmin()) so a real staff session AND an admin using the
 * acting-as switcher both resolve a location the same way every other
 * staff-facing route in this codebase already does.
 *
 * No period filter (unlike /api/admin/debtors, which supports one) —
 * a cashier looking up a debtor to record a payment wants "everyone
 * who still owes us something," not a date-scoped view; the admin
 * screen's period toggle is a reporting feature this lookup doesn't
 * need to duplicate.
 */
export async function GET() {
  const ctx = await getActingContext();
  if (!ctx) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.rpc("dashboard_debtors", {});

  if (error) return serverErrorResponse(error, "orders/debtors");

  return NextResponse.json({ debtors: data ?? [] });
}
