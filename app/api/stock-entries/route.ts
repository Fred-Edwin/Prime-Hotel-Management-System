import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canteenStockEntriesSaveSchema, stockEntriesSaveSchema, stockEntryLineSaveSchema } from "@/lib/validation";
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
      selling_price_snapshot: prices.selling_price,
      buying_price_snapshot: prices.buying_price,
    });
  }

  // Single round trip: save_stock_entries_batch() loops server-side over
  // save_stock_entry() per line (docs/01_DATA_MODEL.md §3.4 correctness
  // untouched — each line still gets its own row lock + oversell re-check).
  // No added_stock/sent_out/wastage keys in each line: this route is now
  // regular (non-store-manager) staff's till_quantity_sold ONLY — the
  // store manager's added_stock/sent_out moved to their own PUT autosave
  // (save_stock_entry_store_manager_fields()), and /entry no longer
  // collects wastage at all (post-launch correction to §3.3). Omitting
  // these keys means save_stock_entry()'s p_added_stock/p_sent_out/
  // p_wastage stay null, which preserves whatever the row already has
  // instead of overwriting it with this staff member's stale
  // page-load snapshot of fields they don't even see in their own UI.
  // See 20260717093000_preserve_wastage_on_stock_entry_save.sql.
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
      selling_price_snapshot: item.selling_price,
      buying_price_snapshot: item.buying_price,
    });
  }

  // No wastage key: same "preserve, don't zero" rationale as the
  // restaurant batch above.
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

/**
 * PUT /api/stock-entries
 * Store-manager-only single-line autosave for "Added stock"/"Sent to
 * canteen" — /entry's store-manager view autosaves per field
 * (post-launch redesign, docs/backlog/entry-store-manager-redesign-handover.md)
 * instead of batching behind the day's TillStrip Save button. Regular
 * staff's till_quantity_sold field is unaffected and keeps using the
 * batch POST above.
 *
 * Calls save_stock_entry_store_manager_fields() (see
 * 20260717090000_stock_entry_store_manager_autosave.sql), NOT
 * save_stock_entry() — that function always overwrites
 * till_quantity_sold wholesale on every call, which is safe for its one
 * existing caller (the till-entry batch save, the only writer of that
 * field) but would silently revert a concurrent till save if this route
 * called it too. The dedicated function instead preserves
 * till_quantity_sold/wastage/wastage_note from whatever the row already
 * has and only ever writes added_stock/sent_out — see the migration's
 * header comment for the full race it avoids. Same
 * lock_stock_entry_row() advisory lock as every other stock_entries
 * writer (docs/01_DATA_MODEL.md §3.4).
 *
 * wastage/wastage_note are not part of this payload at all — /entry no
 * longer collects wastage (post-launch correction to §3.3), and the
 * underlying function preserves whatever wastage value already exists
 * (e.g. set via the admin ledger edit path) rather than zeroing it.
 */
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "staff" || user.location !== "restaurant" || !user.is_store_manager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = stockEntryLineSaveSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { entry_date, item_id, added_stock, sent_out } = parsed.data;
  const supabase = await createServerSupabaseClient();

  const priceQuery = supabase
    .from("items")
    .select("id, selling_price, buying_price")
    .eq("id", item_id)
    .single();
  const { data: item, error: priceError }: Awaited<typeof priceQuery> = await priceQuery;

  if (priceError || !item) {
    return NextResponse.json({ error: "Unknown item in save request" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("save_stock_entry_store_manager_fields", {
    p_item_id: item_id,
    p_location: "restaurant",
    p_entry_date: entry_date,
    p_added_stock: added_stock,
    p_sent_out: sent_out,
    p_selling_price_snapshot: item.selling_price,
    p_buying_price_snapshot: item.buying_price,
    p_created_by: user.id,
  });

  if (error) {
    const { message, status } = describeSaveError(error);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ entry: data });
}
