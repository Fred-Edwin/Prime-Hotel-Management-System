import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";

/**
 * GET /api/audit-log?actor=<uuid>&action=<string>&from=YYYY-MM-DD&to=YYYY-MM-DD
 * Admin-only read of the audit trail (docs/backlog/03_audit_log.md).
 * RLS (audit_log_select_admin_only) is the real boundary here — this
 * route-level check is defense in depth, same pattern as every other
 * admin-only route in this codebase.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const actor = searchParams.get("actor");
  const action = searchParams.get("action");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from("audit_log")
    .select("id, actor_id, action, target_table, target_id, changes, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (actor) query = query.eq("actor_id", actor);
  if (action) query = query.eq("action", action);
  if (from) query = query.gte("created_at", `${from}T00:00:00`);
  if (to) query = query.lte("created_at", `${to}T23:59:59`);

  const { data, error }: Awaited<typeof query> = await query;

  if (error) return serverErrorResponse(error, "audit-log");

  // Actor names resolved separately (not an embedded PostgREST join) —
  // keeps this route consistent with how other admin routes in this
  // codebase build lookup maps in JS rather than relying on FK-name
  // guessing in a .select() string.
  const actorIds = [...new Set((data ?? []).map((row) => row.actor_id))];
  const { data: actors, error: actorsError } = await supabase
    .from("users")
    .select("id, name")
    .in("id", actorIds.length > 0 ? actorIds : ["00000000-0000-0000-0000-000000000000"]);

  if (actorsError) return serverErrorResponse(actorsError, "audit-log");

  const nameById = new Map((actors ?? []).map((row) => [row.id, row.name]));
  const entries = (data ?? []).map((row) => ({
    ...row,
    actor_name: nameById.get(row.actor_id) ?? "Unknown",
  }));

  return NextResponse.json({ entries });
}
