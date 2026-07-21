import { NextResponse } from "next/server";
import { getCurrentUser, requireAdmin } from "@/lib/auth";
import { ingredientSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = await createServerSupabaseClient();
  const query = supabase.from("ingredients").select("*").order("name");
  const { data, error }: Awaited<typeof query> = await query;

  if (error) return serverErrorResponse(error, "ingredients");
  return NextResponse.json({ ingredients: data });
}

/**
 * Creation is also allowed for the restaurant store manager, not just
 * admin — matching who can log an ingredient purchase
 * (app/api/ingredient-purchases/route.ts's canLogPurchases()). This lets
 * PurchaseModal's inline "add new ingredient" flow work for whichever of
 * the two actually opens it; full catalog management (edit/deactivate)
 * on /ingredients stays admin-only via requireAdmin() elsewhere.
 */
function canCreateIngredient(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  if (!user) return false;
  if (user.role === "admin") return true;
  return user.role === "staff" && user.location === "restaurant" && user.is_store_manager;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!canCreateIngredient(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = ingredientSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("ingredients")
    .insert(parsed.data)
    .select()
    .single();

  if (error) return serverErrorResponse(error, "ingredients");
  return NextResponse.json({ ingredient: data }, { status: 201 });
}
