import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { ingredientSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
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
    .update(parsed.data)
    .eq("id", id)
    .select()
    .single();

  if (error) return serverErrorResponse(error, "ingredients/[id]");
  return NextResponse.json({ ingredient: data });
}
