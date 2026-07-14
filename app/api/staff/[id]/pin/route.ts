import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { staffPinResetSchema } from "@/lib/validation";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * POST /api/staff/[id]/pin
 * Phase 9 — admin-initiated PIN reset. A staff member's "PIN" is the
 * password on their synthetic auth.users identity (see
 * docs/00_ARCHITECTURE.md's auth note) — updating it requires the
 * Supabase Auth admin API, same service-role pattern
 * app/api/staff/route.ts's POST already uses for account creation, not
 * a plain public.users table update (that table never stores the PIN
 * itself).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = staffPinResetSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const serviceClient = createServiceRoleClient();
  const { error } = await serviceClient.auth.admin.updateUserById(id, {
    password: parsed.data.pin,
  });

  if (error) {
    console.error("[staff/[id]/pin] updateUserById failed", error);
    return NextResponse.json(
      { error: "Something went wrong on our end — please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
