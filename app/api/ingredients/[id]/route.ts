import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { ingredientSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = ingredientSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();

  const { data: before } = await supabase
    .from("ingredients")
    .select("name, unit, buying_price, low_stock_threshold, active")
    .eq("id", id)
    .single();

  const { data, error } = await supabase
    .from("ingredients")
    .update(parsed.data)
    .eq("id", id)
    .select()
    .single();

  if (error) return serverErrorResponse(error, "ingredients/[id]");

  // Mirrors staff.edit/deactivate/reactivate's convention (app/api/staff/
  // [id]/route.ts) — a plain buying-price/name/threshold edit is
  // "ingredient.edit"; a bare active flip gets its own distinct action
  // name so the audit trail reads directly without diffing `changes` by
  // hand. Added post-launch (2026-07-23) after a real investigation (a
  // Smokies ingredient buying_price_snapshot dropping from 560 to 63.61
  // between two ingredient_entries rows) hit a dead end: PATCH /api/
  // ingredients/[id] had never written to audit_log at all, so there was
  // no way to see who changed the catalog price or when. See
  // docs/01_DATA_MODEL.md's audit_log section.
  const action =
    before && before.active !== parsed.data.active
      ? parsed.data.active
        ? "ingredient.reactivate"
        : "ingredient.deactivate"
      : "ingredient.edit";

  await writeAuditLog(supabase, {
    actorId: admin.id,
    action,
    targetTable: "ingredients",
    targetId: id,
    changes: { before, after: parsed.data },
  });

  return NextResponse.json({ ingredient: data });
}
