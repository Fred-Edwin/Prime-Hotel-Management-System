import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { ledgerEntryAdminEditSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { describeSaveError, serverErrorResponse } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";

/**
 * PATCH /api/dashboard/ledger/entry
 *
 * Admin direct ledger-row edit (docs/backlog/04_admin_ledger_edit.md), the
 * entry point built into the Ledger screen. Covers both stock_entries and
 * ingredient_entries. Three resolved design decisions this route enforces:
 *
 * 1. Block, don't cascade: only the most-recent row per item(+location)/
 *    ingredient is editable — rejected if a later entry_date row already
 *    exists, since that later row's opening_stock was derived from this
 *    one's closing_stock.
 * 2. Price snapshots are permanently immutable — this route never accepts
 *    or writes selling_price_snapshot/buying_price_snapshot; the existing
 *    row's stored snapshot is fetched and passed straight back into the
 *    save function unchanged.
 * 3. quantity_sold/closing_stock are never directly writable — always via
 *    save_stock_entry()/save_canteen_stock_entry()/save_ingredient_entry(),
 *    so the derivation and oversell re-check stay correct.
 *
 * created_by is preserved as the row's original author when editing an
 * existing row (fetched first, passed back in as p_created_by) — these
 * save functions only set created_by on the initial INSERT, so passing it
 * back unchanged on an update is a no-op for an existing row. A brand-new
 * "today" row (no existing entry — this is also how admin logs today's
 * entry herself) legitimately gets created_by = the admin's own id.
 * The audit log separately records which admin made the edit.
 */
export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = ledgerEntryAdminEditSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();

  if (parsed.data.table === "stock_entries") {
    return editStockEntry(parsed.data, supabase, admin.id);
  }
  return editIngredientEntry(parsed.data, supabase, admin.id);
}

async function editStockEntry(
  input: Extract<ReturnType<typeof ledgerEntryAdminEditSchema.parse>, { table: "stock_entries" }>,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  adminId: string,
) {
  const { item_id, location, entry_date } = input;

  const laterRowQuery = supabase
    .from("stock_entries")
    .select("id", { count: "exact", head: true })
    .eq("item_id", item_id)
    .eq("location", location)
    .gt("entry_date", entry_date);
  const { count: laterCount, error: laterError } = await laterRowQuery;
  if (laterError) return serverErrorResponse(laterError, "dashboard/ledger/entry");

  if ((laterCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "This isn't the latest entry for this item — edit forward from the most recent one instead.",
      },
      { status: 409 },
    );
  }

  const existingQuery = supabase
    .from("stock_entries")
    .select("created_by, selling_price_snapshot, buying_price_snapshot")
    .eq("item_id", item_id)
    .eq("location", location)
    .eq("entry_date", entry_date)
    .maybeSingle();
  const { data: existing, error: existingError } = await existingQuery;
  if (existingError) return serverErrorResponse(existingError, "dashboard/ledger/entry");

  let createdBy: string;
  let sellingPriceSnapshot: number;
  let buyingPriceSnapshot: number;

  const itemQuery = supabase
    .from("items")
    .select("selling_price, buying_price, supply_type")
    .eq("id", item_id)
    .single();
  const { data: item, error: itemError } = await itemQuery;
  if (itemError || !item) {
    return NextResponse.json({ error: "Unknown item" }, { status: 400 });
  }

  if (existing) {
    createdBy = existing.created_by;
    sellingPriceSnapshot = existing.selling_price_snapshot;
    buyingPriceSnapshot = existing.buying_price_snapshot;
  } else {
    // No row yet for this item/location/date — this is "log today's entry
    // as admin," a special case of the same edit form (scope item 5).
    // Prices come from the current catalog since there's no prior snapshot
    // to preserve, same as the ordinary staff save path.
    createdBy = adminId;
    sellingPriceSnapshot = item.selling_price;
    buyingPriceSnapshot = item.buying_price;
  }

  const { data, error } =
    location === "canteen"
      ? await supabase.rpc("save_canteen_stock_entry", {
          p_item_id: item_id,
          p_entry_date: entry_date,
          // canteen_supplied items derive added_stock server-side via
          // canteen_supplied_total() regardless of p_added_stock_input
          // (§3.1) — the real supply_type must be passed, not assumed.
          p_is_canteen_supplied: item.supply_type === "canteen_supplied",
          p_added_stock_input: input.added_stock,
          p_till_quantity_sold: input.till_quantity_sold,
          p_wastage: input.wastage,
          p_selling_price_snapshot: sellingPriceSnapshot,
          p_buying_price_snapshot: buyingPriceSnapshot,
          p_created_by: createdBy,
          p_wastage_note: input.wastage_note ?? undefined,
        })
      : await supabase.rpc("save_stock_entry", {
          p_item_id: item_id,
          p_location: location,
          p_entry_date: entry_date,
          p_till_quantity_sold: input.till_quantity_sold,
          p_added_stock: input.added_stock,
          p_sent_out: input.sent_out,
          p_wastage: input.wastage,
          p_selling_price_snapshot: sellingPriceSnapshot,
          p_buying_price_snapshot: buyingPriceSnapshot,
          p_created_by: createdBy,
          p_wastage_note: input.wastage_note ?? undefined,
        });
  if (error) {
    const { message, status } = describeSaveError(error);
    return NextResponse.json({ error: message }, { status });
  }

  await writeAuditLog(supabase, {
    actorId: adminId,
    action: "stock_entry.admin_edit",
    targetTable: "stock_entries",
    targetId: data.id,
    changes: {
      before: existing ?? null,
      after: {
        till_quantity_sold: input.till_quantity_sold,
        added_stock: input.added_stock,
        sent_out: input.sent_out,
        wastage: input.wastage,
        wastage_note: input.wastage_note ?? null,
      },
    },
  });

  return NextResponse.json({ entry: data });
}

async function editIngredientEntry(
  input: Extract<ReturnType<typeof ledgerEntryAdminEditSchema.parse>, { table: "ingredient_entries" }>,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  adminId: string,
) {
  const { ingredient_id, entry_date } = input;

  const laterRowQuery = supabase
    .from("ingredient_entries")
    .select("id", { count: "exact", head: true })
    .eq("ingredient_id", ingredient_id)
    .gt("entry_date", entry_date);
  const { count: laterCount, error: laterError } = await laterRowQuery;
  if (laterError) return serverErrorResponse(laterError, "dashboard/ledger/entry");

  if ((laterCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "This isn't the latest entry for this ingredient — edit forward from the most recent one instead.",
      },
      { status: 409 },
    );
  }

  const existingQuery = supabase
    .from("ingredient_entries")
    .select("created_by, buying_price_snapshot")
    .eq("ingredient_id", ingredient_id)
    .eq("entry_date", entry_date)
    .maybeSingle();
  const { data: existing, error: existingError } = await existingQuery;
  if (existingError) return serverErrorResponse(existingError, "dashboard/ledger/entry");

  let createdBy: string;
  let buyingPriceSnapshot: number;

  if (existing) {
    createdBy = existing.created_by;
    buyingPriceSnapshot = existing.buying_price_snapshot;
  } else {
    const ingredientQuery = supabase
      .from("ingredients")
      .select("buying_price")
      .eq("id", ingredient_id)
      .single();
    const { data: ingredient, error: ingredientError } = await ingredientQuery;
    if (ingredientError || !ingredient) {
      return NextResponse.json({ error: "Unknown ingredient" }, { status: 400 });
    }
    createdBy = adminId;
    buyingPriceSnapshot = ingredient.buying_price;
  }

  const { data, error } = await supabase.rpc("save_ingredient_entry", {
    p_ingredient_id: ingredient_id,
    p_entry_date: entry_date,
    p_received: input.received,
    p_quantity_used: input.quantity_used,
    p_wastage: input.wastage,
    p_buying_price_snapshot: buyingPriceSnapshot,
    p_created_by: createdBy,
    p_wastage_note: input.wastage_note ?? undefined,
  });

  if (error) {
    const { message, status } = describeSaveError(error);
    return NextResponse.json({ error: message }, { status });
  }

  await writeAuditLog(supabase, {
    actorId: adminId,
    action: "ingredient_entry.admin_edit",
    targetTable: "ingredient_entries",
    targetId: data.id,
    changes: {
      before: existing ?? null,
      after: {
        received: input.received,
        quantity_used: input.quantity_used,
        wastage: input.wastage,
        wastage_note: input.wastage_note ?? null,
      },
    },
  });

  return NextResponse.json({ entry: data });
}
