import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { orderSchema } from "@/lib/validation";
import { nairobiToday, orderTotal } from "@/lib/calculations";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { describeSaveError, serverErrorResponse } from "@/lib/errors";

/**
 * GET /api/orders?date=YYYY-MM-DD
 * Returns everything the order-entry screen needs in one round trip:
 * sellable items for the caller's location (same supply_type filtering
 * rule as /api/stock-entries — restaurant sells restaurant_only +
 * canteen_supplied, canteen sells canteen_supplied + canteen_independent,
 * per docs/01_DATA_MODEL.md §3.4's location-eligibility rule), active
 * delivery zones (delivery orders only — canteen still gets these since
 * §6 doesn't restrict delivery to one location), and the caller's own
 * location's orders already logged for the given date (the receipt list
 * below the entry form).
 *
 * items/delivery_locations both have RLS policies that already allow
 * read access to any authenticated user (items_select_all,
 * delivery_locations_select_all) — this route just narrows what a staff
 * member needs for their own location, same "server-side, not just
 * RLS" discipline as every other route in this codebase.
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

  const itemsQuery = supabase
    .from("items")
    .select("*")
    .eq("active", true)
    .in("supply_type", supplyTypes)
    .order("category")
    .order("name");
  const { data: items, error: itemsError }: Awaited<typeof itemsQuery> = await itemsQuery;
  if (itemsError) return serverErrorResponse(itemsError, "orders");

  const zonesQuery = supabase
    .from("delivery_locations")
    .select("*")
    .eq("active", true)
    .order("name");
  const { data: deliveryLocations, error: zonesError }: Awaited<typeof zonesQuery> = await zonesQuery;
  if (zonesError) return serverErrorResponse(zonesError, "orders");

  const ordersQuery = supabase
    .from("orders")
    .select("*, order_items(*)")
    .eq("location", user.location)
    .eq("order_date", date)
    .order("created_at", { ascending: false });
  const { data: orders, error: ordersError }: Awaited<typeof ordersQuery> = await ordersQuery;
  if (ordersError) return serverErrorResponse(ordersError, "orders");

  // Today's stock_entries row (both locations, daily cadence) -- lets the
  // screen show remaining stock per item and cap the quantity stepper at
  // the real limit, same "prevent oversell before it's attempted" rule
  // Entry's screen already follows (docs/design/02_PATTERNS_AND_CHECKLIST.md
  // §6). This is a read-only convenience for the UI; the server-side
  // oversell re-check in apply_order_to_stock_entry() is still the real
  // enforcement (§3.4) — a stale client-side cap can never let an
  // oversell actually persist.
  const entryDate = date;
  const stockEntriesQuery = supabase
    .from("stock_entries")
    .select("*")
    .eq("location", user.location)
    .eq("entry_date", entryDate);
  const { data: stockEntries, error: stockEntriesError }: Awaited<typeof stockEntriesQuery> =
    await stockEntriesQuery;
  if (stockEntriesError) return serverErrorResponse(stockEntriesError, "orders");

  return NextResponse.json({ items, deliveryLocations, orders, stockEntries });
}

/**
 * POST /api/orders
 * Creates a delivery/pickup order. Validates: item shape (Zod), that
 * every item is sellable at the caller's own location (§3.4 "Validation:
 * an order's items must belong to its own location" — checked here
 * against real item data, not assumed from the client), and delegates
 * the actual atomic write (order + order_items + the stock_entries
 * upsert for each item) to public.create_order(), which also handles
 * duplicate-submission protection via client_request_id (§3.4).
 *
 * location/order_date/created_by are always server-derived, never
 * accepted from the client body — same principle as /api/expenses.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "staff" || !user.location) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = orderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { customer_name, fulfillment_type, delivery_location_id, items, client_request_id } = parsed.data;
  const supabase = await createServerSupabaseClient();

  const itemIds = items.map((line) => line.item_id);
  const itemsQuery = supabase
    .from("items")
    .select("id, selling_price, buying_price, supply_type, active")
    .in("id", itemIds);
  const { data: itemRows, error: itemsError }: Awaited<typeof itemsQuery> = await itemsQuery;
  if (itemsError) return serverErrorResponse(itemsError, "orders");

  const itemById = new Map((itemRows ?? []).map((row) => [row.id, row]));

  const eligibleSupplyTypes =
    user.location === "restaurant"
      ? new Set(["restaurant_only", "canteen_supplied"])
      : new Set(["canteen_supplied", "canteen_independent"]);

  for (const line of items) {
    const item = itemById.get(line.item_id);
    if (!item || !item.active) {
      return NextResponse.json({ error: "Unknown item in order" }, { status: 400 });
    }
    if (!eligibleSupplyTypes.has(item.supply_type)) {
      return NextResponse.json(
        { error: `${item.id} isn't sold at your location — remove it and try again.` },
        { status: 400 },
      );
    }
  }

  let deliveryFeeSnapshot = 0;
  if (fulfillment_type === "delivery") {
    const zoneQuery = supabase
      .from("delivery_locations")
      .select("id, fee, active")
      .eq("id", delivery_location_id as string)
      .single();
    const { data: zone, error: zoneError }: Awaited<typeof zoneQuery> = await zoneQuery;
    if (zoneError || !zone || !zone.active) {
      return NextResponse.json({ error: "Select a valid delivery zone" }, { status: 400 });
    }
    deliveryFeeSnapshot = zone.fee;
  }

  const orderItemsForTotal = items.map((line) => ({
    quantity: line.quantity,
    sellingPriceSnapshot: itemById.get(line.item_id)!.selling_price,
  }));
  const totalAmount = orderTotal({ items: orderItemsForTotal, deliveryFeeSnapshot });

  const orderDate = nairobiToday();

  const itemsPayload = items.map((line) => ({
    item_id: line.item_id,
    quantity: line.quantity,
    selling_price_snapshot: itemById.get(line.item_id)!.selling_price,
  }));

  const buyingPrices: Record<string, number> = {};
  for (const line of items) {
    buyingPrices[line.item_id] = itemById.get(line.item_id)!.buying_price;
  }

  const { data, error } = await supabase.rpc("create_order", {
    p_location: user.location,
    p_order_date: orderDate,
    p_customer_name: customer_name,
    p_fulfillment_type: fulfillment_type,
    p_total_amount: totalAmount,
    p_client_request_id: client_request_id,
    p_created_by: user.id,
    p_items: itemsPayload,
    p_buying_prices: buyingPrices,
    ...(fulfillment_type === "delivery" ? { p_delivery_location_id: delivery_location_id! } : {}),
    p_delivery_fee_snapshot: deliveryFeeSnapshot,
  });

  if (error) {
    const { message, status } = describeSaveError(error);
    return NextResponse.json({ error: message }, { status });
  }

  const orderItemsQuery = supabase.from("order_items").select("*").eq("order_id", data.id);
  const { data: savedItems, error: savedItemsError }: Awaited<typeof orderItemsQuery> =
    await orderItemsQuery;
  if (savedItemsError) return serverErrorResponse(savedItemsError, "orders");

  return NextResponse.json({ order: { ...data, order_items: savedItems } }, { status: 201 });
}
