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
 * ingredient_entries. Resolved design decisions this route enforces:
 *
 * 1. Historical edits cascade, they don't block: editing any row — not
 *    just the most recent — is allowed. After the edited row itself saves
 *    (via the normal save_stock_entry()/save_canteen_stock_entry()/
 *    save_ingredient_entry() path), this route calls
 *    recompute_stock_entry_cascade() / recompute_ingredient_entry_chain()
 *    (supabase/migrations/20260720100000_historical_ledger_edit_cascade.sql)
 *    to walk every later row for that item/location (or ingredient)
 *    forward, re-deriving opening_stock/closing_stock/sales_value/
 *    cost_value/closing_stock_value/wastage_value from the edited row on.
 *    For a canteen_supplied item whose restaurant sent_out changed, this
 *    also re-derives the linked canteen week(s) and cascades those too
 *    (§3.1's added_stock-from-restaurant-sent_out link). If recomputing
 *    would make any downstream row's demand exceed its available stock
 *    (a historical correction revealing a would-be oversell), the whole
 *    cascade rolls back atomically and this route surfaces which
 *    item/date conflicted — the admin resolves the downstream row first
 *    rather than the system landing an impossible negative closing stock.
 * 2. Price snapshots are permanently immutable — this route never accepts
 *    or writes selling_price_snapshot/buying_price_snapshot; the existing
 *    row's stored snapshot is fetched and passed straight back into the
 *    save function unchanged. The cascade recompute reuses each row's own
 *    already-stored snapshot too — never touches prices.
 * 3. quantity_sold/closing_stock are never directly writable — always via
 *    the save_ and recompute_ functions, so the derivation and oversell
 *    re-check stay correct.
 *
 * created_by is preserved as the row's original author when editing an
 * existing row (fetched first, passed back in as p_created_by) — these
 * save functions only set created_by on the initial INSERT, so passing it
 * back unchanged on an update is a no-op for an existing row. A brand-new
 * "today" row (no existing entry — this is also how admin logs today's
 * entry herself) legitimately gets created_by = the admin's own id.
 * The audit log separately records which admin made the edit, including
 * the full cascade of rows the edit recomputed.
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
  if (parsed.data.table === "stock_consumption") {
    return createStockConsumptionEntry(parsed.data, supabase, admin.id);
  }
  return editIngredientEntry(parsed.data, supabase, admin.id);
}

const STOCK_CONSUMPTION_RPC = {
  staff_meal: "create_staff_meal_entry",
  complimentary_meal: "create_complimentary_meal_entry",
  stock_adjustment: "create_stock_adjustment_entry",
} as const;

/**
 * Admin-authored staff meal / complimentary meal / stock adjustment claim
 * from the Item Ledger's edit-row modal (client feedback, 2026-07-24 — see
 * stockConsumptionAdminEntrySchema's doc comment). Calls the exact same
 * create_*_entry() RPC the matching /expenses tab's POST route calls.
 * Admin picks who the claim is for (staff_id) — a same-location active
 * staff member, or the admin's own account for something she personally
 * consumed/gave away; the admin herself is always created_by. Requires
 * the widened staff_meal_entries_insert_scoped-family RLS policies
 * (20260724100000_admin_pick_staff_for_consumption_claims.sql) — without
 * them, an insert where staff_id != auth.uid() is rejected even for
 * admin. The picked staff_id is re-checked below, since the RLS policy
 * itself only enforces "any user" for admin, not "a real, active,
 * eligible person" — that's this route's job, same division of
 * responsibility as the item/supply_type checks the /expenses-tab routes
 * already do. Unlike
 * editStockEntry, this is always a fresh claim row (insert-only, no
 * existing row to update) — the same "New entry" shape already used for
 * admin-created ingredient entries, not an edit-in-place. No
 * historical-edit cascade call: these RPCs already force a
 * same-transaction stock_entries recompute for the affected item/
 * location/date themselves (§3.5/§3.10), same as when a staff member
 * submits one from /expenses.
 */
async function createStockConsumptionEntry(
  input: Extract<ReturnType<typeof ledgerEntryAdminEditSchema.parse>, { table: "stock_consumption" }>,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  adminId: string,
) {
  const { category, item_id, location, entry_date, quantity, note, staff_id } = input;

  const staffQuery = supabase
    .from("users")
    .select("id, active, location, role")
    .eq("id", staff_id)
    .single();
  const { data: staffMember, error: staffError }: Awaited<typeof staffQuery> = await staffQuery;
  // Valid picks: an active staff member at this claim's own location, or
  // the admin's own account (client feedback, 2026-07-24 — she may
  // personally consume/give away stock too, not just attribute claims to
  // staff; admin has no `location` of its own, so that check is skipped
  // for that branch).
  const isValidPick =
    staffMember?.active &&
    ((staffMember.role === "staff" && staffMember.location === location) ||
      staffMember.role === "admin");
  if (staffError || !staffMember || !isValidPick) {
    return NextResponse.json(
      { error: "Choose an active staff member at this location." },
      { status: 400 },
    );
  }

  const { data, error } = await supabase.rpc(STOCK_CONSUMPTION_RPC[category], {
    p_item_id: item_id,
    p_location: location,
    p_meal_date: entry_date,
    p_quantity: quantity,
    p_note: note ?? undefined,
    p_staff_id: staff_id,
    p_created_by: adminId,
  });

  if (error) {
    console.error("[dashboard/ledger/entry stock_consumption]", error);
    const { message, status } = describeSaveError(error);
    return NextResponse.json({ error: message }, { status });
  }

  const targetTable =
    category === "staff_meal"
      ? "staff_meal_entries"
      : category === "complimentary_meal"
        ? "complimentary_meal_entries"
        : "stock_adjustment_entries";

  await writeAuditLog(supabase, {
    actorId: adminId,
    action: `${targetTable}.admin_create`,
    targetTable,
    targetId: data.id,
    changes: { after: { item_id, location, entry_date, quantity, note: note ?? null, staff_id } },
  });

  return NextResponse.json({ entry: data }, { status: 201 });
}

async function editStockEntry(
  input: Extract<ReturnType<typeof ledgerEntryAdminEditSchema.parse>, { table: "stock_entries" }>,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  adminId: string,
) {
  const { item_id, location, entry_date } = input;

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

  // Historical edit cascade — recomputes opening_stock/closing_stock/
  // value fields for every later row this item/location chain (and, for
  // a canteen_supplied item, the linked canteen week) depends on. A no-op
  // when this was already the latest row (the cascade's own forward scan
  // finds nothing past entry_date). Runs after the edited row's own save
  // succeeds — if the cascade itself hits a downstream oversell, the
  // database rolls back the whole cascade automatically (same
  // transaction), but the already-committed edit above is not part of
  // that transaction, so on cascade failure we report the conflict
  // without pretending the edit itself didn't happen — see the response
  // below.
  const { data: cascadeRows, error: cascadeError } = await supabase.rpc(
    "recompute_stock_entry_cascade",
    {
      p_item_id: item_id,
      p_edited_location: location,
      p_edited_from_date: entry_date,
    },
  );
  if (cascadeError) {
    const { message } = describeSaveError(cascadeError);
    return NextResponse.json(
      {
        error: `Entry saved, but recalculating later entries failed: ${message} Fix the conflicting entry, then edit this one again to retry the recalculation.`,
      },
      { status: 409 },
    );
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
      cascade_recomputed: (cascadeRows ?? []).map((row) => ({
        item_id: row.item_id,
        location: row.location,
        entry_date: row.entry_date,
        opening_stock: row.opening_stock,
        closing_stock: row.closing_stock,
      })),
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

  // Same historical-edit cascade as editStockEntry above, ingredient-only
  // shape (no cross-location step — ingredients have no canteen link).
  const { data: cascadeRows, error: cascadeError } = await supabase.rpc(
    "recompute_ingredient_entry_chain",
    {
      p_ingredient_id: ingredient_id,
      p_from_date: entry_date,
    },
  );
  if (cascadeError) {
    const { message } = describeSaveError(cascadeError);
    return NextResponse.json(
      {
        error: `Entry saved, but recalculating later entries failed: ${message} Fix the conflicting entry, then edit this one again to retry the recalculation.`,
      },
      { status: 409 },
    );
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
      cascade_recomputed: (cascadeRows ?? []).map((row) => ({
        ingredient_id: row.ingredient_id,
        entry_date: row.entry_date,
        opening_stock: row.opening_stock,
        closing_stock: row.closing_stock,
      })),
    },
  });

  return NextResponse.json({ entry: data });
}
