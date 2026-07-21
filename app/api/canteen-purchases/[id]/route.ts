import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { describeSaveError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";

/**
 * DELETE /api/canteen-purchases/[id]
 *
 * Admin-only, same as logging one (canteen has no store-manager
 * equivalent — see 20260720110000_canteen_stock_purchases.sql).
 * canteen_stock_purchases has no delete RLS policy at all; the only way
 * a row is ever removed is through delete_canteen_stock_purchase(),
 * which also unwinds the purchase's two side effects
 * (items.buying_price weighted average, stock_entries.added_stock) —
 * see 20260721060000_purchase_delete.sql.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: existing } = await supabase
    .from("canteen_stock_purchases")
    .select("*, items(name)")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.rpc("delete_canteen_stock_purchase", { p_purchase_id: id });

  if (error) {
    const { message, status } = describeSaveError(error);
    if (error.code === "P0005") {
      return NextResponse.json({ error: "That purchase no longer exists." }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status });
  }

  await writeAuditLog(supabase, {
    actorId: admin.id,
    action: "canteen_stock_purchase.delete",
    targetTable: "canteen_stock_purchases",
    targetId: id,
    changes: { before: existing ?? null },
  });

  return NextResponse.json({ success: true });
}
