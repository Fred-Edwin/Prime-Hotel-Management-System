import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { assetSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";

/**
 * Catalog management (create/edit an asset, set its unit cost) is admin
 * or the restaurant store manager only — same population as
 * canCreateIngredient()/canLogPurchases() (app/api/ingredients/route.ts,
 * app/api/ingredient-purchases/route.ts), since that's who actually buys
 * equipment in practice. RLS (assets_admin_or_restaurant_insert/_update,
 * 20260728120000_assets.sql) enforces the same population at the
 * database layer; this is the second, application-layer check that
 * narrows non-admin further to is_store_manager specifically (RLS has no
 * concept of that flag, 00_ARCHITECTURE.md §5.1).
 */
function canManageAssets(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  if (!user) return false;
  if (user.role === "admin") return true;
  return user.role === "staff" && user.location === "restaurant" && user.is_store_manager;
}

/**
 * GET /api/assets
 *
 * Own-location + shared(null) + admin-sees-all, per
 * assets_select_own_location_or_admin — any authenticated staff member
 * may read the catalog (needed for the loss-logging flow, which is open
 * to any staff member at their own location, not just admin/store
 * manager). Also returns each asset's derived quantity-on-hand/value via
 * dashboard_assets_on_hand(), so the client never has to re-derive it
 * from raw asset_events.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = await createServerSupabaseClient();

  const assetsQuery = supabase.from("assets").select("*").order("name");
  const { data: assets, error: assetsError }: Awaited<typeof assetsQuery> = await assetsQuery;
  if (assetsError) return serverErrorResponse(assetsError, "assets/GET/assets");

  const { data: onHand, error: onHandError } = await supabase.rpc("dashboard_assets_on_hand");
  if (onHandError) return serverErrorResponse(onHandError, "assets/GET/on-hand");

  const onHandByAsset = new Map((onHand ?? []).map((row) => [row.asset_id, row]));
  const assetsWithOnHand = (assets ?? []).map((asset) => ({
    ...asset,
    quantity_on_hand: onHandByAsset.get(asset.id)?.quantity_on_hand ?? 0,
    value: onHandByAsset.get(asset.id)?.value ?? 0,
  }));

  return NextResponse.json({ assets: assetsWithOnHand });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!canManageAssets(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = assetSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("assets")
    .insert(parsed.data)
    .select()
    .single();

  if (error) return serverErrorResponse(error, "assets/POST");
  return NextResponse.json({ asset: { ...data, quantity_on_hand: 0, value: 0 } }, { status: 201 });
}
