import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";

/**
 * GET /api/dashboard/ledger/entry/impact
 *
 * Cascade preview for the historical-edit confirmation step in
 * LedgerClient's edit modal (resolved design decision: show "count + date
 * range only" before an edit that isn't the latest row commits — see
 * PATCH /api/dashboard/ledger/entry's own docstring for the actual
 * recompute mechanism this previews). Read-only: counts later rows and
 * their max entry_date, does not call recompute_stock_entry_cascade() or
 * touch any data — the ledger table is often filtered to a period
 * narrower than an item's full history, so this can't just be derived
 * from rows LedgerClient already has loaded.
 *
 * A count of 0 means the edited row is already the latest — the client
 * skips the confirmation step in that case, matching today's no-cascade
 * behavior exactly.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const table = searchParams.get("table");
  const entryDate = searchParams.get("entry_date");
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  if (!entryDate || !isoDate.test(entryDate)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  if (table === "stock_entries") {
    const itemId = searchParams.get("item_id");
    const location = searchParams.get("location");
    if (!itemId || (location !== "restaurant" && location !== "canteen")) {
      return NextResponse.json({ error: "Invalid item/location" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("stock_entries")
      .select("entry_date")
      .eq("item_id", itemId)
      .eq("location", location)
      .gt("entry_date", entryDate)
      .order("entry_date", { ascending: false })
      .limit(1);
    if (error) return serverErrorResponse(error, "dashboard/ledger/entry/impact");

    const laterCountQuery = supabase
      .from("stock_entries")
      .select("id", { count: "exact", head: true })
      .eq("item_id", itemId)
      .eq("location", location)
      .gt("entry_date", entryDate);
    const { count, error: countError } = await laterCountQuery;
    if (countError) return serverErrorResponse(countError, "dashboard/ledger/entry/impact");

    return NextResponse.json({ count: count ?? 0, through: data[0]?.entry_date ?? null });
  }

  if (table === "ingredient_entries") {
    const ingredientId = searchParams.get("ingredient_id");
    if (!ingredientId) {
      return NextResponse.json({ error: "Invalid ingredient" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("ingredient_entries")
      .select("entry_date")
      .eq("ingredient_id", ingredientId)
      .gt("entry_date", entryDate)
      .order("entry_date", { ascending: false })
      .limit(1);
    if (error) return serverErrorResponse(error, "dashboard/ledger/entry/impact");

    const laterCountQuery = supabase
      .from("ingredient_entries")
      .select("id", { count: "exact", head: true })
      .eq("ingredient_id", ingredientId)
      .gt("entry_date", entryDate);
    const { count, error: countError } = await laterCountQuery;
    if (countError) return serverErrorResponse(countError, "dashboard/ledger/entry/impact");

    return NextResponse.json({ count: count ?? 0, through: data[0]?.entry_date ?? null });
  }

  return NextResponse.json({ error: "Invalid table" }, { status: 400 });
}
