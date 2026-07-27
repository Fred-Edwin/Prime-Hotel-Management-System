import { NextResponse } from "next/server";
import { getActingContext, type ActingContext } from "@/lib/auth";
import { ingredientEntriesSaveSchema, ingredientEntryLineSaveSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { describeSaveError, serverErrorResponse } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";

// Only admin-in-acting-mode writes get an audit entry — same rationale
// as app/api/stock-entries/route.ts's identical helper.
async function auditActingAsWrite(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  ctx: ActingContext,
  action: string,
  targetId: string,
  changes?: Record<string, unknown> | null,
) {
  if (!ctx.actingAs) return;
  await writeAuditLog(supabase, {
    actorId: ctx.user.id,
    action,
    targetTable: "ingredient_entries",
    targetId,
    changes: { acting_as: ctx.actingAs.role, ...changes },
  });
}

// Keys off the resolved acting context (real store-manager staff, or an
// admin acting as Store Manager — getActingContext() in lib/auth.ts
// already forces that acting role's location to "restaurant") rather
// than raw session fields, so this stays correct for both.
function requireStoreManager(ctx: ActingContext | null): ctx is ActingContext {
  return !!ctx && ctx.location === "restaurant" && ctx.isStoreManager;
}

/**
 * GET /api/ingredient-entries?date=YYYY-MM-DD
 * Store-manager-only (docs/01_DATA_MODEL.md §3.2) — returns the active
 * ingredient catalog plus any existing ingredient_entries rows for that date.
 *
 * `opening_stock` (keyed by ingredient_id) is a computed carry-forward
 * figure for any ingredient with no row yet today — same rationale as
 * GET /api/stock-entries's identical field: without this lookup, the
 * store screen would show "Opening: 0" for an untouched ingredient on a
 * fresh day even though real stock carried forward from yesterday's
 * closing_stock, exactly like save_ingredient_entry() already derives at
 * write time (§3.2).
 */
export async function GET(request: Request) {
  const ctx = await getActingContext();
  if (!requireStoreManager(ctx)) {
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

  const entryByIngredientId = new Map((entries ?? []).map((row) => [row.ingredient_id, row]));
  const ingredientIdsMissingToday = (ingredients ?? [])
    .map((ingredient) => ingredient.id)
    .filter((id) => !entryByIngredientId.has(id));

  const openingStockByIngredientId: Record<string, number> = {};
  if (ingredientIdsMissingToday.length > 0) {
    const priorQuery = supabase
      .from("ingredient_entries")
      .select("ingredient_id, closing_stock, entry_date")
      .lt("entry_date", date)
      .in("ingredient_id", ingredientIdsMissingToday)
      .order("entry_date", { ascending: false });
    const { data: priorRows, error: priorError }: Awaited<typeof priorQuery> = await priorQuery;
    if (priorError) return serverErrorResponse(priorError, "ingredient-entries");
    for (const row of priorRows ?? []) {
      if (!(row.ingredient_id in openingStockByIngredientId)) {
        openingStockByIngredientId[row.ingredient_id] = row.closing_stock;
      }
    }
  }

  return NextResponse.json({ ingredients, entries, opening_stock: openingStockByIngredientId });
}

/**
 * POST /api/ingredient-entries
 * Store-manager-only batch save. Each line goes through
 * save_ingredient_entry(), which derives opening_stock and re-validates
 * the oversell check atomically (same rationale as stock-entries).
 */
export async function POST(request: Request) {
  const ctx = await getActingContext();
  if (!requireStoreManager(ctx)) {
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

  const batchLines = [];
  for (const line of lines) {
    const prices = priceById.get(line.ingredient_id);
    if (!prices) {
      return NextResponse.json({ error: "Unknown ingredient in save request" }, { status: 400 });
    }
    batchLines.push({
      ingredient_id: line.ingredient_id,
      received: line.received,
      quantity_used: line.quantity_used,
      wastage: line.wastage,
      wastage_note: line.wastage_note ?? null,
      buying_price_snapshot: prices.buying_price,
    });
  }

  // Single round trip: save_ingredient_entries_batch() loops server-side
  // over save_ingredient_entry() per line — same rationale as stock-entries.
  const { data, error } = await supabase.rpc("save_ingredient_entries_batch", {
    p_entry_date: entry_date,
    p_created_by: ctx.user.id,
    p_lines: batchLines,
  });

  if (error) {
    const { message, status } = describeSaveError(error);
    return NextResponse.json({ error: message }, { status });
  }

  // target_id is a not-null uuid column (audit_log) — a batch save has
  // no single natural target row, so this audits against the first
  // saved row's own id rather than entry_date, which isn't a uuid.
  if (data && data.length > 0) {
    await auditActingAsWrite(supabase, ctx, "ingredient_entry.admin_acting_as_create", data[0].id, {
      entry_date,
      ingredient_count: batchLines.length,
    });
  }

  return NextResponse.json({ entries: data });
}

/**
 * PUT /api/ingredient-entries
 * Store-manager-only single-line autosave — /store saves one ingredient's
 * received/quantity_used as soon as the store manager finishes editing
 * that field, instead of batching the whole day's sheet behind one Save
 * button (Phase 10 redesign). Calls save_ingredient_entry() directly
 * (skipping the batch RPC, which exists for the multi-line POST path)
 * with wastage hardcoded to 0 — wastage entry moved to admin, this route
 * never writes it.
 */
export async function PUT(request: Request) {
  const ctx = await getActingContext();
  if (!requireStoreManager(ctx)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = ingredientEntryLineSaveSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { entry_date, ingredient_id, received, quantity_used } = parsed.data;
  const supabase = await createServerSupabaseClient();

  const priceQuery = supabase
    .from("ingredients")
    .select("id, buying_price")
    .eq("id", ingredient_id)
    .single();
  const { data: ingredient, error: priceError }: Awaited<typeof priceQuery> = await priceQuery;

  if (priceError || !ingredient) {
    return NextResponse.json({ error: "Unknown ingredient in save request" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("save_ingredient_entry", {
    p_ingredient_id: ingredient_id,
    p_entry_date: entry_date,
    p_received: received,
    p_quantity_used: quantity_used,
    p_wastage: 0,
    p_buying_price_snapshot: ingredient.buying_price,
    p_created_by: ctx.user.id,
  });

  if (error) {
    const { message, status } = describeSaveError(error);
    return NextResponse.json({ error: message }, { status });
  }

  await auditActingAsWrite(supabase, ctx, "ingredient_entry.admin_acting_as_edit", ingredient_id, {
    entry_date,
    ingredient_id,
    received,
    quantity_used,
  });

  return NextResponse.json({ entry: data });
}
