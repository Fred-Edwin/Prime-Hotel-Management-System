import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { ingredientPurchaseSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { dashboardPeriodRange, type DashboardPeriod } from "@/lib/calculations";
import { describeSaveError, serverErrorResponse } from "@/lib/errors";

/**
 * Shared by both purchase-logging entry points (docs/01_DATA_MODEL.md
 * §3.2's purchases section): admin's /dashboard/purchases and the store
 * manager's /store "Log purchase" action. Same population
 * ingredient_entries writes already restrict to — admin, or restaurant
 * staff flagged is_store_manager — not "any restaurant staff," since
 * ordinary cashiers/waiters have no reason to log a purchase.
 */
function canLogPurchases(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  if (!user) return false;
  if (user.role === "admin") return true;
  return user.role === "staff" && user.location === "restaurant" && user.is_store_manager;
}

/**
 * GET /api/ingredient-purchases?period=today|week|month
 *
 * Admin-and-store-manager-visible purchase history plus current
 * stock-on-hand per ingredient (quantity, running weighted-average
 * cost, value) — powers /dashboard/purchases and, for a lighter read,
 * could back a future /store stock-on-hand view too. RLS already
 * scopes ingredient_purchases/ingredient_entries to restaurant-or-admin
 * (docs/01_DATA_MODEL.md §4), so no extra location filter is needed
 * here beyond the role gate above.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!canLogPurchases(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") ?? "today";
  if (!["today", "week", "month"].includes(period)) {
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  }
  const { from, to } = dashboardPeriodRange(period as DashboardPeriod);

  const supabase = await createServerSupabaseClient();

  const purchasesQuery = supabase
    .from("ingredient_purchases")
    .select("*, ingredients(name, unit), users!ingredient_purchases_created_by_fkey(name)")
    .gte("purchase_date", from)
    .lte("purchase_date", to)
    .order("created_at", { ascending: false });
  const { data: purchases, error: purchasesError }: Awaited<typeof purchasesQuery> = await purchasesQuery;
  if (purchasesError) return serverErrorResponse(purchasesError, "ingredient-purchases/GET/purchases");

  // Stock on hand = each ingredient's latest ingredient_entries.closing_stock
  // (already the running balance kept up to date by save_ingredient_entry()/
  // record_ingredient_purchase()) alongside its current weighted-average
  // buying_price, so the value column reflects the same cost purchases
  // actually drive rather than a separately-fetched figure.
  const ingredientsQuery = supabase
    .from("ingredients")
    .select("id, name, unit, buying_price")
    .eq("active", true)
    .order("name");
  const { data: ingredients, error: ingredientsError }: Awaited<typeof ingredientsQuery> =
    await ingredientsQuery;
  if (ingredientsError) return serverErrorResponse(ingredientsError, "ingredient-purchases/GET/ingredients");

  const ingredientIds = (ingredients ?? []).map((i) => i.id);
  const entriesQuery = supabase
    .from("ingredient_entries")
    .select("ingredient_id, entry_date, closing_stock")
    .in("ingredient_id", ingredientIds.length > 0 ? ingredientIds : ["00000000-0000-0000-0000-000000000000"])
    .order("entry_date", { ascending: false });
  const { data: entries, error: entriesError }: Awaited<typeof entriesQuery> = await entriesQuery;
  if (entriesError) return serverErrorResponse(entriesError, "ingredient-purchases/GET/entries");

  const latestClosingByIngredient = new Map<string, number>();
  for (const entry of entries ?? []) {
    if (!latestClosingByIngredient.has(entry.ingredient_id)) {
      latestClosingByIngredient.set(entry.ingredient_id, entry.closing_stock);
    }
  }

  const stockOnHand = (ingredients ?? []).map((ingredient) => {
    const quantity = latestClosingByIngredient.get(ingredient.id) ?? 0;
    return {
      ingredient_id: ingredient.id,
      name: ingredient.name,
      unit: ingredient.unit,
      quantity,
      average_cost: ingredient.buying_price,
      value: quantity * ingredient.buying_price,
    };
  });

  return NextResponse.json({ period, from, to, purchases: purchases ?? [], stockOnHand });
}

/**
 * POST /api/ingredient-purchases
 *
 * Logs one purchase event via record_ingredient_purchase() — quantity
 * folds additively into today's ingredient_entries.received and
 * ingredients.buying_price is recalculated as a fresh weighted-average
 * cost across current stock + this purchase. See
 * 20260719160000_ingredient_purchases.sql for the full mechanics.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!canLogPurchases(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = ingredientPurchaseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { ingredient_id, purchase_date, quantity, unit_cost, supplier_note } = parsed.data;
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.rpc("record_ingredient_purchase", {
    p_ingredient_id: ingredient_id,
    p_purchase_date: purchase_date,
    p_quantity: quantity,
    p_unit_cost: unit_cost,
    p_created_by: user!.id,
    p_supplier_note: supplier_note ?? undefined,
  });

  if (error) {
    const { message, status } = describeSaveError(error);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ purchase: data });
}
