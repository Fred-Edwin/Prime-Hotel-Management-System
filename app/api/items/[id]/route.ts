import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { itemSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { describeSaveError, serverErrorResponse } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = itemSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("items")
    .update(parsed.data)
    .eq("id", id)
    .select()
    .single();

  if (error) return serverErrorResponse(error, "items/[id]");
  return NextResponse.json({ item: data });
}

/**
 * DELETE /api/items/[id]
 *
 * Admin-only, permanent — unlike ingredients/delivery_locations, which
 * stay deactivate-only (see docs/01_DATA_MODEL.md §5), items support a
 * real hard delete per direct client confirmation (2026-07-21): deleting
 * an item also deletes every stock_entries/order_items (and orphaned
 * orders)/canteen_stock_purchases/staff_meal_entries row that references
 * it, permanently changing already-closed days' Ledger/dashboard/profit
 * figures. The client was shown this consequence and confirmed it twice
 * before this was built — see supabase/migrations/20260721070000_item_hard_delete.sql.
 * The UI must call GET .../delete-impact first and show the real
 * before-you-confirm counts; this route does not re-warn, it deletes.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: existing } = await supabase.from("items").select("*").eq("id", id).maybeSingle();
  const { data: impact } = await supabase.rpc("item_delete_impact", { p_item_id: id }).maybeSingle();

  const { error } = await supabase.rpc("delete_item", { p_item_id: id });

  if (error) {
    if (error.code === "P0005") {
      return NextResponse.json({ error: "That item no longer exists." }, { status: 404 });
    }
    const { message, status } = describeSaveError(error);
    return NextResponse.json({ error: message }, { status });
  }

  await writeAuditLog(supabase, {
    actorId: admin.id,
    action: "item.delete",
    targetTable: "items",
    targetId: id,
    changes: { before: existing ?? null, impact: impact ?? null },
  });

  return NextResponse.json({ success: true });
}
