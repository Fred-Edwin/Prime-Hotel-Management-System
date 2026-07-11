import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { stockEntriesSaveSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { describeSaveError } from "@/lib/errors";

/**
 * GET /api/stock-entries?date=YYYY-MM-DD
 * Returns the sellable items for the caller's location plus any existing
 * stock_entries rows for that date, so the entry screen can render
 * opening stock / saved values without a second round trip.
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

  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 });

  const entriesQuery = supabase
    .from("stock_entries")
    .select("*")
    .eq("location", user.location)
    .eq("entry_date", date);
  const { data: entries, error: entriesError }: Awaited<typeof entriesQuery> = await entriesQuery;

  if (entriesError) return NextResponse.json({ error: entriesError.message }, { status: 500 });

  return NextResponse.json({ items, entries });
}

/**
 * POST /api/stock-entries
 * Batch-saves today's till/added/sent/wastage lines. Never writes
 * quantity_sold directly — each line goes through save_stock_entry(),
 * which derives opening_stock, recomputes quantity_sold (till + orders),
 * and re-validates the combined oversell check inside one transaction
 * (docs/01_DATA_MODEL.md §3.4).
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "staff" || !user.location) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = stockEntriesSaveSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { entry_date, lines } = parsed.data;
  const supabase = await createServerSupabaseClient();

  const itemIds = lines.map((line) => line.item_id);
  const priceQuery = supabase.from("items").select("id, selling_price, buying_price").in("id", itemIds);
  const { data: priceRows, error: priceError }: Awaited<typeof priceQuery> = await priceQuery;

  if (priceError) return NextResponse.json({ error: priceError.message }, { status: 500 });

  const priceById = new Map((priceRows ?? []).map((row) => [row.id, row]));

  const savedRows = [];
  for (const line of lines) {
    const prices = priceById.get(line.item_id);
    if (!prices) {
      return NextResponse.json({ error: "Unknown item in save request" }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("save_stock_entry", {
      p_item_id: line.item_id,
      p_location: user.location,
      p_entry_date: entry_date,
      p_till_quantity_sold: line.till_quantity_sold,
      p_added_stock: line.added_stock,
      p_sent_out: line.sent_out,
      p_wastage: line.wastage,
      p_wastage_note: line.wastage_note ?? undefined,
      p_selling_price_snapshot: prices.selling_price,
      p_buying_price_snapshot: prices.buying_price,
      p_created_by: user.id,
    });

    if (error) {
      const { message, status } = describeSaveError(error);
      return NextResponse.json({ error: message }, { status });
    }

    savedRows.push(data);
  }

  return NextResponse.json({ entries: savedRows });
}
