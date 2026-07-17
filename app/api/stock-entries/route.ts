import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  canteenStockEntriesSaveSchema,
  canteenStockEntryFieldSaveSchema,
  stockEntriesSaveSchema,
  stockEntryCashierLineSaveSchema,
  stockEntryLineSaveSchema,
} from "@/lib/validation";
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

  // First-writer oversell pre-check (docs/01_DATA_MODEL.md §3.4): if
  // today's added_stock is genuinely 0 for an item (no row yet, or a row
  // with added_stock = 0 — the store manager hasn't logged "Added stock"
  // today) and this line's till_quantity_sold alone exceeds
  // opening_stock, save_stock_entry() would reject it as a generic
  // oversell even though nothing was actually oversold — it's a
  // data-ordering issue, not user error. Diagnosed here at the route
  // layer (not inside save_stock_entry() itself, since that function is
  // also called by the admin ledger edit path where this framing
  // doesn't apply) so the batch save can surface the same
  // correctly-diagnosed message the cashier's own PUT autosave gives
  // (see 20260717130000_stock_entry_cashier_autosave.sql's errcode
  // P0002 for the single-line equivalent of this check).
  const existingQuery = supabase
    .from("stock_entries")
    .select("item_id, opening_stock, added_stock, sent_out, wastage")
    .eq("location", user.location)
    .eq("entry_date", entry_date)
    .in("item_id", itemIds);
  const { data: existingRows, error: existingError }: Awaited<typeof existingQuery> = await existingQuery;
  if (existingError) return serverErrorResponse(existingError, "stock-entries");

  const existingByItemId = new Map((existingRows ?? []).map((row) => [row.item_id, row]));

  // For any item with no row yet today, opening_stock isn't 0 by
  // default — it carries forward from the prior period's closing_stock
  // (§3.1), exactly like save_stock_entry() itself computes it. Without
  // this lookup, an item legitimately being sold purely against
  // yesterday's leftover stock (a normal, common case — no "Added
  // stock" needed today at all) would be wrongly flagged as "not yet
  // stocked."
  const itemsMissingToday = itemIds.filter((id) => !existingByItemId.has(id));
  const priorClosingByItemId = new Map<string, number>();
  if (itemsMissingToday.length > 0) {
    const priorQuery = supabase
      .from("stock_entries")
      .select("item_id, closing_stock, entry_date")
      .eq("location", user.location)
      .lt("entry_date", entry_date)
      .in("item_id", itemsMissingToday)
      .order("entry_date", { ascending: false });
    const { data: priorRows, error: priorError }: Awaited<typeof priorQuery> = await priorQuery;
    if (priorError) return serverErrorResponse(priorError, "stock-entries");
    for (const row of priorRows ?? []) {
      if (!priorClosingByItemId.has(row.item_id)) {
        priorClosingByItemId.set(row.item_id, row.closing_stock);
      }
    }
  }

  for (const line of lines) {
    const existing = existingByItemId.get(line.item_id);
    const addedStock = existing?.added_stock ?? 0;
    if (addedStock > 0) continue;
    const openingStock = existing?.opening_stock ?? priorClosingByItemId.get(line.item_id) ?? 0;
    const sentOut = existing?.sent_out ?? 0;
    const wastage = existing?.wastage ?? 0;
    if (sentOut + line.till_quantity_sold + wastage > openingStock) {
      return NextResponse.json(
        { error: "Ask the store manager to log today's added stock first." },
        { status: 409 },
      );
    }
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
 * Single-line autosave, dispatched by location/role — /entry's
 * restaurant store-manager and cashier views autosave their own field
 * per item (post-launch redesign, docs/backlog/
 * entry-store-manager-redesign-handover.md and
 * docs/backlog/entry-cashier-redesign-handover.md), and canteen's view
 * autosaves both of its own fields (post-launch redesign, docs/backlog/
 * entry-canteen-redesign-handover.md) — instead of batching behind a
 * Save button. The three branches below are kept explicitly separate —
 * different schema, different RPC, different RBAC/shape — rather than
 * merged into one undifferentiated handler: restaurant's store-manager
 * owns added_stock/sent_out, restaurant's cashier owns
 * till_quantity_sold, and canteen (one person, no role split) owns both
 * till_quantity_sold and added_stock through its own branch.
 */
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "staff" || !user.location) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const supabase = await createServerSupabaseClient();

  if (user.location === "canteen") {
    return putCanteenField(body, supabase, user.id);
  }

  if (user.is_store_manager) {
    return putStoreManagerField(body, supabase, user.id);
  }

  return putCashierField(body, supabase, user.id);
}

/**
 * Store-manager-only branch: "Added stock"/"Sent to canteen".
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
async function putStoreManagerField(
  body: unknown,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
) {
  const parsed = stockEntryLineSaveSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { entry_date, item_id, added_stock, sent_out } = parsed.data;

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
    p_created_by: userId,
  });

  if (error) {
    const { message, status } = describeSaveError(error);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ entry: data });
}

/**
 * Cashier-only branch (regular, non-store-manager restaurant staff):
 * "quantity sold" — /entry's cashier view (post-launch redesign,
 * docs/backlog/entry-cashier-redesign-handover.md).
 *
 * Calls save_stock_entry_cashier_field() (see
 * 20260717130000_stock_entry_cashier_autosave.sql), NOT
 * save_stock_entry() directly, for the same "don't clobber a concurrent
 * writer's field" reason the store-manager branch above uses its own
 * dedicated function — this one preserves added_stock/sent_out/wastage
 * and only ever writes till_quantity_sold. Distinguishes a genuine
 * oversell from the "store manager hasn't logged today's added stock
 * yet" false-rejection case via a distinct SQLSTATE (P0002), surfaced by
 * describeSaveError() (lib/errors.ts) as a specifically-diagnosed
 * message instead of the generic oversell error — see
 * docs/01_DATA_MODEL.md §3.4.
 */
async function putCashierField(
  body: unknown,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
) {
  const parsed = stockEntryCashierLineSaveSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { entry_date, item_id, till_quantity_sold } = parsed.data;

  const priceQuery = supabase
    .from("items")
    .select("id, selling_price, buying_price")
    .eq("id", item_id)
    .single();
  const { data: item, error: priceError }: Awaited<typeof priceQuery> = await priceQuery;

  if (priceError || !item) {
    return NextResponse.json({ error: "Unknown item in save request" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("save_stock_entry_cashier_field", {
    p_item_id: item_id,
    p_location: "restaurant",
    p_entry_date: entry_date,
    p_till_quantity_sold: till_quantity_sold,
    p_selling_price_snapshot: item.selling_price,
    p_buying_price_snapshot: item.buying_price,
    p_created_by: userId,
  });

  if (error) {
    const { message, status } = describeSaveError(error);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ entry: data });
}

/**
 * Canteen-only branch: one person (Anne) autosaves both her own fields —
 * "Quantity sold" (every item) and "Added stock" (canteen_independent
 * items only) — through this single branch, unlike the restaurant's
 * role-gated split. Calls save_stock_entry_canteen_field() (see
 * 20260717140000_stock_entry_canteen_autosave.sql), NOT
 * save_canteen_stock_entry() directly — same "don't clobber a concurrent
 * writer's field" rationale as the restaurant's two autosave functions:
 * two independent debounce timers on two different inputs are still two
 * independent writes that can interleave, even though both belong to the
 * same staffer. Exactly one of till_quantity_sold/added_stock is present
 * per call (canteenStockEntryFieldSaveSchema enforces this); the other
 * is passed as null so the RPC preserves whatever the row already has.
 *
 * entry_date is re-normalized to that week's Monday server-side (§3.1),
 * never trusted verbatim from the client — same as GET/POST's canteen
 * paths.
 */
async function putCanteenField(
  body: unknown,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
) {
  const parsed = canteenStockEntryFieldSaveSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { item_id, till_quantity_sold, added_stock } = parsed.data;
  const entry_date = weekStartMonday(new Date(parsed.data.entry_date));

  const itemQuery = supabase
    .from("items")
    .select("id, selling_price, buying_price, supply_type")
    .eq("id", item_id)
    .single();
  const { data: item, error: itemError }: Awaited<typeof itemQuery> = await itemQuery;

  if (itemError || !item) {
    return NextResponse.json({ error: "Unknown item in save request" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("save_stock_entry_canteen_field", {
    p_item_id: item_id,
    p_entry_date: entry_date,
    p_is_canteen_supplied: item.supply_type === "canteen_supplied",
    ...(till_quantity_sold !== undefined ? { p_till_quantity_sold: till_quantity_sold } : {}),
    ...(added_stock !== undefined ? { p_added_stock_input: added_stock } : {}),
    p_selling_price_snapshot: item.selling_price,
    p_buying_price_snapshot: item.buying_price,
    p_created_by: userId,
  });

  if (error) {
    const { message, status } = describeSaveError(error);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ entry: data });
}
