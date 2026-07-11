import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { expenseSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * GET /api/expenses?date=YYYY-MM-DD
 * Returns the caller's own location's expenses for the given date, most
 * recent first — the running list shown below the log form on /expenses.
 * RLS (expenses_select_scoped) already restricts this to the caller's
 * location, but we also filter explicitly server-side per CLAUDE.md's
 * "check server-side, don't rely on RLS alone" rule.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "staff" || !user.location) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "A valid date is required" }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  const expensesQuery = supabase
    .from("expenses")
    .select("*")
    .eq("location", user.location)
    .eq("expense_date", date)
    .order("created_at", { ascending: false });
  const { data: expenses, error }: Awaited<typeof expensesQuery> = await expensesQuery;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ expenses });
}

/**
 * POST /api/expenses
 * Logs a single expense (category, amount, optional note) for the
 * caller's own location and today's date — submitted one at a time, not
 * as a batch sheet like stock_entries, since expenses occur sporadically
 * rather than as a fixed daily set of rows (see docs/phases/phase5_context.md
 * for why this diverges from Phase 4's till-strip batch-save pattern).
 * `location`/`created_by`/`expense_date` are always server-derived —
 * never accepted from the client body, so a crafted cross-location
 * request has no field to spoof.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "staff" || !user.location) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = expenseSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { category, amount, note } = parsed.data;
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("expenses")
    .insert({
      location: user.location,
      expense_date: new Date().toISOString().slice(0, 10),
      category,
      amount,
      note: note ?? null,
      created_by: user.id,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: "Couldn't save the expense — please try again." }, { status: 500 });
  }

  return NextResponse.json({ expense: data });
}
