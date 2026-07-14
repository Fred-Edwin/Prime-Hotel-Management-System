import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canteenStockEntriesSaveSchema, stockEntriesSaveSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { describeSaveError, serverErrorResponse } from "@/lib/errors";
import { weekEndSunday, weekStartMonday } from "@/lib/calculations";

/**
 * GET /api/stock-entries?date=YYYY-MM-DD
 * Returns the sellable items for the caller's location plus any existing
 * stock_entries rows for that date, so the entry screen can render
 * opening stock / saved values without a second round trip.
 *
 * Restaurant: `date` is used as-is (daily cadence).
 * Canteen: `date` is normalized to the Monday of its week server-side
 * (docs/01_DATA_MODEL.md §3.1's weekly convention — never trusted
 * verbatim from the client), and canteen_supplied items also get a
 * `canteen_supplied_total` figure so the screen can show the read-only
 * aggregate before the staff member has saved anything yet.
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

  // Restaurant's entry screen sells restaurant_only + canteen_supplied
  // items (§3.1) — canteen_independent items never appear here.
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

  if (itemsError) return serverErrorResponse(itemsError, "stock-entries");

  const entryDate = user.location === "canteen" ? weekStartMonday(new Date(date)) : date;

  const entriesQuery = supabase
    .from("stock_entries")
    .select("*")
    .eq("location", user.location)
    .eq("entry_date", entryDate);
  const { data: entries, error: entriesError }: Awaited<typeof entriesQuery> = await entriesQuery;

  if (entriesError) return serverErrorResponse(entriesError, "stock-entries");

  if (user.location !== "canteen") {
    return NextResponse.json({ items, entries, entry_date: entryDate });
  }

  const weekEnd = weekEndSunday(entryDate);
  const suppliedItems = (items ?? []).filter((item) => item.supply_type === "canteen_supplied");

  const suppliedTotals: Record<string, number> = {};
  for (const item of suppliedItems) {
    const { data: total, error: totalError } = await supabase.rpc("canteen_supplied_total", {
      p_item_id: item.id,
      p_week_start: entryDate,
      p_week_end: weekEnd,
    });
    if (totalError) return serverErrorResponse(totalError, "stock-entries");
    suppliedTotals[item.id] = total ?? 0;
  }

  return NextResponse.json({
    items,
    entries,
    entry_date: entryDate,
    week_end: weekEnd,
    supplied_totals: suppliedTotals,
  });
}

/**
 * POST /api/stock-entries
 * Batch-saves the location's entries for the given date/week. Never
 * writes quantity_sold directly — each line goes through
 * save_stock_entry() (restaurant, daily) or save_canteen_stock_entry()
 * (canteen, weekly), which derive opening_stock, recompute quantity_sold
 * (till + orders), and re-validate the combined oversell check inside
 * one transaction (docs/01_DATA_MODEL.md §3.4).
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "staff" || !user.location) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const supabase = await createServerSupabaseClient();

  if (user.location === "canteen") {
    return saveCanteenEntries(body, supabase, user.id);
  }

  const parsed = stockEntriesSaveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { entry_date, lines } = parsed.data;

  const itemIds = lines.map((line) => line.item_id);
  const priceQuery = supabase.from("items").select("id, selling_price, buying_price").in("id", itemIds);
  const { data: priceRows, error: priceError }: Awaited<typeof priceQuery> = await priceQuery;

  if (priceError) return serverErrorResponse(priceError, "stock-entries");

  const priceById = new Map((priceRows ?? []).map((row) => [row.id, row]));

  const batchLines = [];
  for (const line of lines) {
    const prices = priceById.get(line.item_id);
    if (!prices) {
      return NextResponse.json({ error: "Unknown item in save request" }, { status: 400 });
    }
    batchLines.push({
      item_id: line.item_id,
      till_quantity_sold: line.till_quantity_sold,
      added_stock: line.added_stock,
      sent_out: line.sent_out,
      wastage: line.wastage,
      wastage_note: line.wastage_note ?? null,
      selling_price_snapshot: prices.selling_price,
      buying_price_snapshot: prices.buying_price,
    });
  }

  // Single round trip: save_stock_entries_batch() loops server-side over
  // save_stock_entry() per line (docs/01_DATA_MODEL.md §3.4 correctness
  // untouched — each line still gets its own row lock + oversell re-check).
  const { data, error } = await supabase.rpc("save_stock_entries_batch", {
    p_location: user.location,
    p_entry_date: entry_date,
    p_created_by: user.id,
    p_lines: batchLines,
  });

  if (error) {
    const { message, status } = describeSaveError(error);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ entries: data });
}

async function saveCanteenEntries(
  body: unknown,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  createdBy: string,
) {
  const parsed = canteenStockEntriesSaveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  // entry_date is normalized to the Monday of its week server-side —
  // never trusted verbatim from the client (§3.1).
  const entry_date = weekStartMonday(new Date(parsed.data.entry_date));
  const { lines } = parsed.data;

  const itemIds = lines.map((line) => line.item_id);
  const itemsQuery = supabase
    .from("items")
    .select("id, selling_price, buying_price, supply_type")
    .in("id", itemIds);
  const { data: itemRows, error: itemsError }: Awaited<typeof itemsQuery> = await itemsQuery;

  if (itemsError) return serverErrorResponse(itemsError, "stock-entries");

  const itemById = new Map((itemRows ?? []).map((row) => [row.id, row]));

  const batchLines = [];
  for (const line of lines) {
    const item = itemById.get(line.item_id);
    if (!item) {
      return NextResponse.json({ error: "Unknown item in save request" }, { status: 400 });
    }
    batchLines.push({
      item_id: line.item_id,
      is_canteen_supplied: item.supply_type === "canteen_supplied",
      added_stock_input: line.added_stock,
      till_quantity_sold: line.till_quantity_sold,
      wastage: line.wastage,
      wastage_note: line.wastage_note ?? null,
      selling_price_snapshot: item.selling_price,
      buying_price_snapshot: item.buying_price,
    });
  }

  const { data, error } = await supabase.rpc("save_canteen_stock_entries_batch", {
    p_entry_date: entry_date,
    p_created_by: createdBy,
    p_lines: batchLines,
  });

  if (error) {
    const { message, status } = describeSaveError(error);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ entries: data });
}
