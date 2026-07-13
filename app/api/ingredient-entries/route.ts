import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ingredientEntriesSaveSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { describeSaveError, serverErrorResponse } from "@/lib/errors";

function requireStoreManager(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  return !!user && user.role === "staff" && user.location === "restaurant" && user.is_store_manager;
}

/**
 * GET /api/ingredient-entries?date=YYYY-MM-DD
 * Store-manager-only (docs/01_DATA_MODEL.md §3.2) — returns the active
 * ingredient catalog plus any existing ingredient_entries rows for that date.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!requireStoreManager(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "A valid date is required" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  const ingredientsQuery = supabase.from("ingredients").select("*").eq("active", true).order("name");
  const { data: ingredients, error: ingredientsError }: Awaited<typeof ingredientsQuery> =
    await ingredientsQuery;

  if (ingredientsError) return serverErrorResponse(ingredientsError, "ingredient-entries");

  const entriesQuery = supabase.from("ingredient_entries").select("*").eq("entry_date", date);
  const { data: entries, error: entriesError }: Awaited<typeof entriesQuery> = await entriesQuery;

  if (entriesError) return serverErrorResponse(entriesError, "ingredient-entries");

  return NextResponse.json({ ingredients, entries });
}

/**
 * POST /api/ingredient-entries
 * Store-manager-only batch save. Each line goes through
 * save_ingredient_entry(), which derives opening_stock and re-validates
 * the oversell check atomically (same rationale as stock-entries).
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!requireStoreManager(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = ingredientEntriesSaveSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { entry_date, lines } = parsed.data;
  const supabase = await createServerSupabaseClient();

  const ingredientIds = lines.map((line) => line.ingredient_id);
  const priceQuery = supabase.from("ingredients").select("id, buying_price").in("id", ingredientIds);
  const { data: priceRows, error: priceError }: Awaited<typeof priceQuery> = await priceQuery;

  if (priceError) return serverErrorResponse(priceError, "ingredient-entries");

  const priceById = new Map((priceRows ?? []).map((row) => [row.id, row]));

  const savedRows = [];
  for (const line of lines) {
    const prices = priceById.get(line.ingredient_id);
    if (!prices) {
      return NextResponse.json({ error: "Unknown ingredient in save request" }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("save_ingredient_entry", {
      p_ingredient_id: line.ingredient_id,
      p_entry_date: entry_date,
      p_received: line.received,
      p_quantity_used: line.quantity_used,
      p_wastage: line.wastage,
      p_wastage_note: line.wastage_note ?? undefined,
      p_buying_price_snapshot: prices.buying_price,
      p_created_by: user!.id,
    });

    if (error) {
      const { message, status } = describeSaveError(error);
      return NextResponse.json({ error: message }, { status });
    }

    savedRows.push(data);
  }

  return NextResponse.json({ entries: savedRows });
}
