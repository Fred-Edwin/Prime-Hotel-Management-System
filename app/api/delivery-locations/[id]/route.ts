import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { deliveryLocationSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = deliveryLocationSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();

  const { data: before } = await supabase
    .from("delivery_locations")
    .select("name, fee, active")
    .eq("id", id)
    .single();

  const { data, error } = await supabase
    .from("delivery_locations")
    .update(parsed.data)
    .eq("id", id)
    .select()
    .single();

  if (error) return serverErrorResponse(error, "delivery-locations/[id]");

  // Same gap-closing rationale as ingredients/items — a silent fee edit
  // here changes what future orders charge with no record of who/when.
  const action =
    before && before.active !== parsed.data.active
      ? parsed.data.active
        ? "delivery_location.reactivate"
        : "delivery_location.deactivate"
      : "delivery_location.edit";

  await writeAuditLog(supabase, {
    actorId: admin.id,
    action,
    targetTable: "delivery_locations",
    targetId: id,
    changes: { before, after: parsed.data },
  });

  return NextResponse.json({ deliveryLocation: data });
}
