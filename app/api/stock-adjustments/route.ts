import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { nairobiToday } from "@/lib/calculations";
import { stockAdjustmentSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { describeSaveError, serverErrorResponse } from "@/lib/errors";

/**
 * GET /api/stock-adjustments?date=YYYY-MM-DD
 * Mirrors GET /api/staff-meals exactly (docs/backlog/05_stock_consumption.md)
 * — the caller's own location's sellable items (for the picker), today's
 * already-logged stock-adjustment claims (any staff member's, same
 * location), and the current period's effective stock so the picker can
 * show/cap remaining stock per item.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "staff" || !user.location) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "A valid date is required" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  const supplyTypes =
    user.location === "restaurant"
      ? (["restaurant_only", "canteen_supplied"] as const)
      : (["canteen_supplied", "canteen_independent"] as const);

  const [itemsRes, claimsRes, availableStockRes] = await Promise.all([
    supabase
      .from("items")
      .select("id, name, category, buying_price")
      .eq("active", true)
      .in("supply_type", supplyTypes)
      .order("category")
      .order("name"),
    supabase
      .from("stock_adjustment_entries")
      .select("*, items(name), users!stock_adjustment_entries_staff_id_fkey(name)")
      .eq("location", user.location)
      .eq("meal_date", date)
      .order("created_at", { ascending: false }),
    supabase.rpc("stock_adjustment_available_stock", { p_location: user.location, p_as_of_date: date }),
  ]);

  if (itemsRes.error) return serverErrorResponse(itemsRes.error, "stock-adjustments");
  if (claimsRes.error) return serverErrorResponse(claimsRes.error, "stock-adjustments");
  if (availableStockRes.error) return serverErrorResponse(availableStockRes.error, "stock-adjustments");

  return NextResponse.json({
    items: itemsRes.data,
    claims: claimsRes.data,
    availableStock: availableStockRes.data,
  });
}

/**
 * POST /api/stock-adjustments
 * Logs a single stock-adjustment claim (item + quantity + optional note)
 * for the caller's own location and today's date, attributed to the
 * caller. Mirrors POST /api/staff-meals exactly — value is never accepted
 * from the client, public.create_stock_adjustment_entry() derives it
 * server-side and atomically re-derives the item's stock_entries row
 * (closing_stock, oversell re-check) in the same transaction.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "staff" || !user.location) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = stockAdjustmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { item_id, quantity, note } = parsed.data;
  const supabase = await createServerSupabaseClient();

  const itemQuery = supabase
    .from("items")
    .select("id, active, supply_type")
    .eq("id", item_id)
    .single();
  const { data: item, error: itemError }: Awaited<typeof itemQuery> = await itemQuery;
  if (itemError || !item || !item.active) {
    return NextResponse.json({ error: "That item is no longer available." }, { status: 400 });
  }

  const eligibleSupplyTypes =
    user.location === "restaurant"
      ? new Set(["restaurant_only", "canteen_supplied"])
      : new Set(["canteen_supplied", "canteen_independent"]);

  if (!eligibleSupplyTypes.has(item.supply_type)) {
    return NextResponse.json(
      { error: "That item isn't sold at your location." },
      { status: 400 },
    );
  }

  const { data, error } = await supabase.rpc("create_stock_adjustment_entry", {
    p_item_id: item_id,
    p_location: user.location,
    p_meal_date: nairobiToday(),
    p_quantity: quantity,
    p_note: note ?? undefined,
    p_staff_id: user.id,
    p_created_by: user.id,
  });

  if (error) {
    const { message, status } = describeSaveError(error);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ claim: data }, { status: 201 });
}
