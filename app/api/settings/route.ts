import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { appSettingsSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";

/**
 * GET/PATCH /api/settings — admin-only, single-row app_settings table
 * (docs/01_DATA_MODEL.md §3.11). Currently just estimated_cost_ratio, the
 * fallback cost-per-unit (as a fraction of selling_price) used for
 * wastage_estimated_value/estimated_value reporting figures when an
 * item's real buying_price is 0 (client feedback, 2026-07-23 — WaPrecious
 * zeroed buying_price on most ingredient-cooked menu items to avoid
 * double-counting COGS, §3.10, which correctly left wastage_value/
 * staff_meal value/etc. at 0 for those items too). Never touches
 * buying_price/cost_value/closing_stock_value/net profit — see
 * lib/calculations.ts's effectiveUnitCost() doc comment.
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("estimated_cost_ratio")
    .eq("id", true)
    .single();

  if (error) return serverErrorResponse(error, "settings");
  return NextResponse.json({ settings: data });
}

export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = appSettingsSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("app_settings")
    .update(parsed.data)
    .eq("id", true)
    .select("estimated_cost_ratio")
    .single();

  if (error) return serverErrorResponse(error, "settings");
  return NextResponse.json({ settings: data });
}
