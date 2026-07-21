import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { expenseCategorySchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";

/**
 * GET/POST /api/expense-categories — the category-management screen
 * (admin's "+ Manage" modal on /dashboard/expenses). Admin-only, same
 * shape as /api/delivery-locations. Staff never call this route
 * directly — their /expenses category picker reads the catalog via
 * GET /api/expenses, which bundles it in (same pattern GET /api/orders
 * already uses for delivery_locations: RLS's expense_categories_select_all
 * already permits any authenticated user to read the table, this route
 * is just where the CRUD form lives).
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = await createServerSupabaseClient();
  const query = supabase.from("expense_categories").select("*").order("name");
  const { data, error }: Awaited<typeof query> = await query;

  if (error) return serverErrorResponse(error, "expense-categories");
  return NextResponse.json({ expenseCategories: data });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = expenseCategorySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("expense_categories")
    .insert({ name: parsed.data.name })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "A category with that name already exists." }, { status: 409 });
    }
    return serverErrorResponse(error, "expense-categories");
  }
  return NextResponse.json({ expenseCategory: data }, { status: 201 });
}
