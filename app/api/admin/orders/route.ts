import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { dashboardPeriodRange, type DashboardPeriod } from "@/lib/calculations";
import { serverErrorResponse } from "@/lib/errors";

/**
 * GET /api/admin/orders?period=today|week|month&location=restaurant|canteen
 *
 * Admin-only order list with line-item detail (Phase 9 — the admin
 * dashboard/ledger only ever showed aggregate stock_entries figures;
 * there was no way to see what an individual delivery/pickup order
 * actually contained). orders/order_items already have admin-scoped
 * RLS read access across both locations (is_admin() bypasses the
 * location boundary — docs/01_DATA_MODEL.md §4) — this route just adds
 * the period filter and joins order_items + the delivery zone name in
 * one round trip, same "no N+1" discipline as every other admin list.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") ?? "today";
  if (!["today", "week", "month"].includes(period)) {
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  }
  const locationParam = searchParams.get("location");
  if (locationParam && locationParam !== "restaurant" && locationParam !== "canteen") {
    return NextResponse.json({ error: "Invalid location" }, { status: 400 });
  }

  const { from, to } = dashboardPeriodRange(period as DashboardPeriod);

  const supabase = await createServerSupabaseClient();

  let query = supabase
    .from("orders")
    .select("*, order_items(*, items(name)), delivery_locations(name)")
    .gte("order_date", from)
    .lte("order_date", to)
    .order("created_at", { ascending: false });

  if (locationParam) {
    query = query.eq("location", locationParam as "restaurant" | "canteen");
  }

  const { data, error }: Awaited<typeof query> = await query;
  if (error) return serverErrorResponse(error, "admin/orders");

  return NextResponse.json({ period, from, to, orders: data ?? [] });
}
