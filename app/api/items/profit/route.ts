import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";

/**
 * GET /api/items/profit?from=YYYY-MM-DD&to=YYYY-MM-DD&location=restaurant|canteen
 *
 * Item Master page (/items) profit-by-date-range column (client request,
 * WaPrecious, 2026-07-21) — per-item profit over a picked date range,
 * distinct from the table's existing static Margin % column. Backed by
 * public.items_profit_by_range(), which sums each stock_entries row's
 * already-snapshotted sales_value/cost_value/wastage_value — never today's
 * item.buying_price/selling_price — so the figure stays correct even if a
 * price changed partway through the range. See
 * supabase/migrations/20260721100000_items_profit_by_range.sql and
 * docs/01_DATA_MODEL.md §3.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  if (!from || !to || !isoDate.test(from) || !isoDate.test(to) || from > to) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  const locationParam = searchParams.get("location");
  if (locationParam && locationParam !== "restaurant" && locationParam !== "canteen") {
    return NextResponse.json({ error: "Invalid location" }, { status: 400 });
  }
  const location = (locationParam ?? undefined) as "restaurant" | "canteen" | undefined;

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("items_profit_by_range", {
    p_from: from,
    p_to: to,
    p_location: location,
  });

  if (error) return serverErrorResponse(error, "items/profit");
  return NextResponse.json({ from, to, profit: data ?? [] });
}
