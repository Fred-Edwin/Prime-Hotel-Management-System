import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";

/**
 * GET /api/items/[id]/on-hand
 *
 * Read-only lookup for the Items edit drawer's price-edit warning
 * (docs/01_DATA_MODEL.md §3.20, companion to §3.19's Cost of Goods Sold /
 * Stock Revaluation split) — how many units of this item currently exist
 * across BOTH locations, so the drawer can warn before a buying_price edit
 * shows up as a Stock Revaluation swing on today's dashboard.
 *
 * Same "latest row per item" pattern dashboard_low_stock_items() already
 * uses (20260712121500_dashboard_aggregation_functions.sql), just scoped
 * to one item_id via a plain query instead of a whole-table RPC — this is
 * a single-row admin lookup with no aggregation-across-items need, so a
 * new dashboard_*() function would be overkill for what it's used for.
 * Summed across restaurant + canteen: a single catalog buying_price edit
 * applies regardless of which location holds the stock.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("stock_entries")
    .select("location, closing_stock, entry_date")
    .eq("item_id", id)
    .order("entry_date", { ascending: false });

  if (error) return serverErrorResponse(error, "items/[id]/on-hand");

  const latestByLocation = new Map<string, number>();
  for (const row of data ?? []) {
    if (!latestByLocation.has(row.location)) {
      latestByLocation.set(row.location, row.closing_stock);
    }
  }

  const quantityOnHand = [...latestByLocation.values()].reduce((sum, qty) => sum + qty, 0);

  return NextResponse.json({ quantityOnHand });
}
