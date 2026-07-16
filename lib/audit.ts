import "server-only";
import type { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/**
 * Writes one audit_log entry via the write_audit_log() security-definer
 * function (never a direct table insert — see supabase/migrations/
 * 20260716120000_audit_log.sql). Callers pass the actor performing the
 * action (from getCurrentUser()), not the target being acted on.
 *
 * First-pass scope is Staff edit/deactivate/PIN-reset only
 * (docs/backlog/03_audit_log.md) — call this from those three route
 * handlers, not speculatively elsewhere.
 */
export async function writeAuditLog(
  supabase: SupabaseClient,
  params: {
    actorId: string;
    action: string;
    targetTable: string;
    targetId: string;
    changes?: Record<string, unknown> | null;
  },
): Promise<void> {
  const { error } = await supabase.rpc("write_audit_log", {
    p_actor_id: params.actorId,
    p_action: params.action,
    p_target_table: params.targetTable,
    p_target_id: params.targetId,
    p_changes: (params.changes ?? null) as Json,
  });

  if (error) {
    console.error("[audit] write_audit_log failed", params.action, error);
  }
}
