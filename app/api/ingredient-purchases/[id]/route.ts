import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { describeSaveError } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";

/**
 * DELETE /api/ingredient-purchases/[id]
 *
 * Admin-only — unlike logging a purchase (admin or store manager),
 * removing one is a correction only admin makes (matches the ledger
 * admin-edit route's admin-only scope). ingredient_purchases has no
 * delete RLS policy at all (20260719161000_ingredient_purchases.sql);
 * the only way a row is ever removed is through
 * delete_ingredient_purchase(), which also unwinds the purchase's two
 * side effects (ingredients.buying_price weighted average,
 * ingredient_entries.received) — see
 * 20260721060000_purchase_delete.sql.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: existing } = await supabase
    .from("ingredient_purchases")
    .select("*, ingredients(name)")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.rpc("delete_ingredient_purchase", { p_purchase_id: id });

  if (error) {
    const { message, status } = describeSaveError(error);
    if (error.code === "P0005") {
      return NextResponse.json({ error: "That purchase no longer exists." }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status });
  }

  await writeAuditLog(supabase, {
    actorId: admin.id,
    action: "ingredient_purchase.delete",
    targetTable: "ingredient_purchases",
    targetId: id,
    changes: { before: existing ?? null },
  });

  return NextResponse.json({ success: true });
}
