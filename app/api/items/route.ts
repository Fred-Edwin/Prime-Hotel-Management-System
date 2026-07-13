import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { itemSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = await createServerSupabaseClient();
  const query = supabase.from("items").select("*").order("category").order("name");
  const { data, error }: Awaited<typeof query> = await query;

  if (error) return serverErrorResponse(error, "items");
  return NextResponse.json({ items: data });
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = itemSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from("items").insert(parsed.data).select().single();

  if (error) return serverErrorResponse(error, "items");
  return NextResponse.json({ item: data }, { status: 201 });
}
