import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { assetEventSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { dashboardPeriodRange, type DashboardPeriod } from "@/lib/calculations";
import { describeSaveError, serverErrorResponse } from "@/lib/errors";

/** Same population as app/api/assets/route.ts's canManageAssets(). */
function canManageAssets(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  if (!user) return false;
  if (user.role === "admin") return true;
  return user.role === "staff" && user.location === "restaurant" && user.is_store_manager;
}

/**
 * GET /api/asset-events?period=today|week|month
 *
 * Event history — RLS (asset_events_select_own_location_or_admin) already
 * scopes to own-location/shared/admin, so no extra filter is needed here
 * beyond requiring a session.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") ?? "today";
  if (!["today", "week", "month"].includes(period)) {
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  }
  const { from, to } = dashboardPeriodRange(period as DashboardPeriod);

  const supabase = await createServerSupabaseClient();
  const query = supabase
    .from("asset_events")
    .select("*, assets(name, category, location), users!asset_events_created_by_fkey(name)")
    .gte("event_date", from)
    .lte("event_date", to)
    .order("created_at", { ascending: false });
  const { data, error }: Awaited<typeof query> = await query;

  if (error) return serverErrorResponse(error, "asset-events/GET");
  return NextResponse.json({ period, from, to, events: data ?? [] });
}

/**
 * POST /api/asset-events
 *
 * Logs one purchase or loss event via record_asset_event(). A 'loss' may
 * be logged by ANY staff member (Anne logging a broken canteen cup needs
 * no store-manager flag — see 20260728120000_assets.sql's scope note); a
 * 'purchase' requires canManageAssets() (admin or restaurant store
 * manager), same population as who can edit the catalog itself. RLS
 * (asset_events_insert_scoped) enforces the same split at the database
 * layer — this route-level check exists because RLS has no concept of
 * is_store_manager specifically (00_ARCHITECTURE.md §5.1).
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = assetEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { asset_id, event_type, event_date, quantity, unit_cost, note } = parsed.data;

  if (event_type === "purchase" && !canManageAssets(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // 'loss' is open to any authenticated staff member — RLS still confines
  // them to an asset visible at their own location.

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("record_asset_event", {
    p_asset_id: asset_id,
    p_event_type: event_type,
    p_event_date: event_date,
    p_quantity: quantity,
    p_created_by: user!.id,
    p_unit_cost: event_type === "purchase" ? unit_cost : undefined,
    p_note: note ?? undefined,
  });

  if (error) {
    const { message, status } = describeSaveError(error);
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ event: data }, { status: 201 });
}
