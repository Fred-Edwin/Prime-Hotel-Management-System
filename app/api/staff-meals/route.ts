import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { nairobiToday } from "@/lib/calculations";
import { staffMealSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { describeSaveError, serverErrorResponse } from "@/lib/errors";

/**
 * GET /api/staff-meals?date=YYYY-MM-DD
 * Returns the caller's own location's sellable items (for the picker),
 * today's already-logged staff meal claims (any staff member's, same
 * location — not just the caller's own), most recent first, and the
 * current period's stock_entries rows so the picker can show/cap
 * remaining stock per item (UX improvement matching OrdersClient.tsx's
 * remainingStockFor — see docs/design/02_PATTERNS_AND_CHECKLIST.md §6's
 * "oversell visually prevented before it's attempted" requirement, which
 * this screen didn't originally satisfy). Mirrors /api/expenses's GET
 * shape plus /api/orders' stockEntries addition. RLS
 * (staff_meal_entries_select_scoped) already restricts this to the
 * caller's location, but also filtered explicitly server-side per
 * CLAUDE.md's "check server-side, don't rely on RLS alone" rule.
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

  // Same location-eligibility filtering as /api/orders — a staff member
  // may only claim an item their own location actually sells.
  const supplyTypes =
    user.location === "restaurant"
      ? (["restaurant_only", "canteen_supplied"] as const)
      : (["canteen_supplied", "canteen_independent"] as const);

  // All three reads are independent — run them concurrently (mirrors
  // /api/orders' GET, which does the same for its own 3-4 reads) rather
  // than sequentially. Each round trip to the hosted dev project costs
  // real latency (docs/00_ARCHITECTURE.md §7's documented slow-connection
  // constraint), so awaiting them one at a time was needlessly multiplying
  // that cost — a real, measured contributor to this screen's load time,
  // found live-testing after the availableStock query was added as a
  // third sequential call.
  const [itemsRes, claimsRes, availableStockRes] = await Promise.all([
    supabase
      .from("items")
      .select("id, name, category, buying_price")
      .eq("active", true)
      .in("supply_type", supplyTypes)
      .order("category")
      .order("name"),
    supabase
      .from("staff_meal_entries")
      .select("*, items(name), users!staff_meal_entries_staff_id_fkey(name)")
      .eq("location", user.location)
      .eq("meal_date", date)
      .order("created_at", { ascending: false }),
    // Effective current stock per item, right now — not just "does
    // today's row exist" (most items won't have one yet if nobody's
    // logged a till sale today), via public.staff_meal_available_stock(),
    // which mirrors create_staff_meal_entry()'s own opening-stock-carry-
    // forward logic (bug found live: the picker previously showed no
    // availability cap at all whenever today's stock_entries row hadn't
    // been created yet, letting staff submit a quantity the server then
    // rejected — see 20260719160000_staff_meal_available_stock.sql).
    supabase.rpc("staff_meal_available_stock", { p_location: user.location, p_as_of_date: date }),
  ]);

  if (itemsRes.error) return serverErrorResponse(itemsRes.error, "staff-meals");
  if (claimsRes.error) return serverErrorResponse(claimsRes.error, "staff-meals");
  if (availableStockRes.error) return serverErrorResponse(availableStockRes.error, "staff-meals");

  return NextResponse.json({
    items: itemsRes.data,
    claims: claimsRes.data,
    availableStock: availableStockRes.data,
  });
}

/**
 * POST /api/staff-meals
 * Logs a single staff meal claim (item + quantity + optional note) for
 * the caller's own location and today's date, attributed to the caller
 * (staff_id = created_by = the logged-in user — see docs/01_DATA_MODEL.md
 * §3.5's confirmed design: self-service, per-staff attribution, not a
 * manager logging on someone else's behalf).
 *
 * Value is never accepted from the client — public.create_staff_meal_entry()
 * derives it server-side from the item's current buying_price, and
 * atomically re-derives the item's stock_entries row (closing_stock,
 * oversell re-check) in the same transaction, mirroring how
 * create_order()/apply_order_to_stock_entry() already do this for orders
 * (§3.4).
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "staff" || !user.location) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = staffMealSchema.safeParse(body);
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

  const { data, error } = await supabase.rpc("create_staff_meal_entry", {
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
