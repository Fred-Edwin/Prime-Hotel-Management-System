import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { customerSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";

/**
 * GET /api/customers
 * POST /api/customers
 *
 * Customer catalog (docs/01_DATA_MODEL.md §6's "Credit sales and
 * customer payments" subsection, Phase 11). Both staff and admin can
 * read the full catalog (customers_select_all — not location-scoped,
 * per the same doc: "a customer isn't necessarily tied to one
 * location") and create a new customer (customers_insert_any_authenticated) —
 * a cashier meeting a new credit customer at the till shouldn't need
 * to find an admin first. Editing an existing customer stays
 * admin-only (customers_update_admin_only) — not built in this route,
 * see /dashboard/debtors if that ever needs a UI.
 *
 * created_by is always server-derived from the session, never accepted
 * from the client body — same principle as every other write path in
 * this codebase (stock_entries, expenses, orders).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = await createServerSupabaseClient();
  const query = supabase.from("customers").select("*").order("name");
  const { data, error }: Awaited<typeof query> = await query;

  if (error) return serverErrorResponse(error, "customers");
  return NextResponse.json({ customers: data ?? [] });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = customerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("customers")
    .insert({
      name: parsed.data.name,
      phone: parsed.data.phone ?? null,
      location: parsed.data.location ?? null,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return serverErrorResponse(error, "customers");
  return NextResponse.json({ customer: data }, { status: 201 });
}
