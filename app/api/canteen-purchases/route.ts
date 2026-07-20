import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canteenStockPurchaseSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { dashboardPeriodRange, type DashboardPeriod } from "@/lib/calculations";
import { describeSaveError, serverErrorResponse } from "@/lib/errors";

/**
 * GET /api/canteen-purchases?period=today|week|month
 *
 * Admin-only (unlike ingredient purchases, canteen has no store-manager
 * equivalent who also buys stock — see 20260720110000_canteen_stock_purchases.sql).
 * Returns purchase history plus current stock-on-hand (quantity, running
 * weighted-average cost, value) for canteen_independent items only —
 * canteen_supplied items are excluded entirely, since their added_stock
 * only ever comes from the restaurant's sent_out (§3.1), never a
 * purchase logged here.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") ?? "today";
  if (!["today", "week", "month"].includes(period)) {
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  }
  const { from, to } = dashboardPeriodRange(period as DashboardPeriod);

  const supabase = await createServerSupabaseClient();

  const purchasesQuery = supabase
    .from("canteen_stock_purchases")
    .select("*, items(name), users!canteen_stock_purchases_created_by_fkey(name)")
    .gte("purchase_date", from)
    .lte("purchase_date", to)
    .order("created_at", { ascending: false });
  const { data: purchases, error: purchasesError }: Awaited<typeof purchasesQuery> = await purchasesQuery;
  if (purchasesError) return serverErrorResponse(purchasesError, "canteen-purchases/GET/purchases");

  // Stock on hand = each canteen_independent item's latest
  // stock_entries.closing_stock (already the running balance kept up to
  // date by save_stock_entry_canteen_field()/record_canteen_stock_purchase())
  // alongside its current weighted-average buying_price.
  const itemsQuery = supabase
    .from("items")
    .select("id, name, buying_price")
    .eq("active", true)
    .eq("supply_type", "canteen_independent")
    .order("name");
  const { data: items, error: itemsError }: Awaited<typeof itemsQuery> = await itemsQuery;
  if (itemsError) return serverErrorResponse(itemsError, "canteen-purchases/GET/items");

  const itemIds = (items ?? []).map((i) => i.id);
  const entriesQuery = supabase
    .from("stock_entries")
    .select("item_id, entry_date, closing_stock")
    .eq("location", "canteen")
    .in("item_id", itemIds.length > 0 ? itemIds : ["00000000-0000-0000-0000-000000000000"])
    .order("entry_date", { ascending: false });
  const { data: entries, error: entriesError }: Awaited<typeof entriesQuery> = await entriesQuery;
  if (entriesError) return serverErrorResponse(entriesError, "canteen-purchases/GET/entries");

  const latestClosingByItem = new Map<string, number>();
  for (const entry of entries ?? []) {
    if (!latestClosingByItem.has(entry.item_id)) {
      latestClosingByItem.set(entry.item_id, entry.closing_stock);
    }
  }

  const stockOnHand = (items ?? []).map((item) => {
    const quantity = latestClosingByItem.get(item.id) ?? 0;
    return {
      item_id: item.id,
      name: item.name,
      quantity,
      average_cost: item.buying_price,
      value: quantity * item.buying_price,
    };
  });

  return NextResponse.json({ period, from, to, purchases: purchases ?? [], stockOnHand });
}

/**
 * POST /api/canteen-purchases
 *
 * Logs one purchase event via record_canteen_stock_purchase() — quantity
 * folds additively into that week's stock_entries.added_stock and
 * items.buying_price is recalculated as a fresh weighted-average cost.
 * See 20260720110000_canteen_stock_purchases.sql for the full mechanics.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = canteenStockPurchaseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { item_id, purchase_date, quantity, unit_cost, supplier_note } = parsed.data;
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.rpc("record_canteen_stock_purchase", {
    p_item_id: item_id,
    p_purchase_date: purchase_date,
    p_quantity: quantity,
    p_unit_cost: unit_cost,
    p_created_by: user.id,
    p_supplier_note: supplier_note ?? undefined,
  });

  if (error) {
    const { message, status } = describeSaveError(error);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ purchase: data });
}
