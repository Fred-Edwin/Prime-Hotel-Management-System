import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { nairobiToday } from "@/lib/calculations";
import { expenseSchema, adminExpenseSchema } from "@/lib/validation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { serverErrorResponse } from "@/lib/errors";
import { writeAuditLog } from "@/lib/audit";

/**
 * GET /api/expenses?date=YYYY-MM-DD
 * GET /api/expenses?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Staff: returns their own location's expenses for the given date/range.
 * Admin: returns every expense for the given date/range, across both
 * locations plus business-wide (location = null) rows — RLS
 * (expenses_select_scoped) already grants admin unrestricted select, so no
 * location filter is applied for that role. Most recent first — the
 * running list shown below the log form on /expenses (staff) or
 * /dashboard/expenses (admin).
 *
 * `from`/`to` (Admin Expenses' custom date range picker, same pattern as
 * /api/dashboard/ledger) is an inclusive range query — one request instead
 * of the admin client's old per-day fan-out for Week/Month. `date` still
 * works standalone for the staff screen's single-day lookup.
 *
 * Also bundles the active expense_categories catalog in the response —
 * same pattern GET /api/orders already uses for delivery_locations
 * (RLS's expense_categories_select_all already permits any authenticated
 * user to read it; this just saves the client a second request).
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || (user.role === "staff" && !user.location)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;

  let from: string;
  let to: string;
  if (fromParam || toParam) {
    if (!fromParam || !toParam || !isoDate.test(fromParam) || !isoDate.test(toParam) || fromParam > toParam) {
      return NextResponse.json({ error: "A valid date range is required" }, { status: 400 });
    }
    from = fromParam;
    to = toParam;
  } else {
    if (!date || !isoDate.test(date)) {
      return NextResponse.json({ error: "A valid date is required" }, { status: 400 });
    }
    from = date;
    to = date;
  }

  const supabase = await createServerSupabaseClient();
  const staffLocation = user.role === "staff" ? user.location : null;

  const expensesQuery = staffLocation
    ? supabase
        .from("expenses")
        .select("*, expense_categories(id, name)")
        .gte("expense_date", from)
        .lte("expense_date", to)
        .eq("location", staffLocation)
        .order("created_at", { ascending: false })
    : supabase
        .from("expenses")
        .select("*, expense_categories(id, name)")
        .gte("expense_date", from)
        .lte("expense_date", to)
        .order("created_at", { ascending: false });

  const categoriesQuery = supabase
    .from("expense_categories")
    .select("*")
    .eq("active", true)
    .order("name");

  const [{ data: expenses, error }, { data: expenseCategories, error: categoriesError }] = await Promise.all([
    expensesQuery,
    categoriesQuery,
  ]);

  if (error) return serverErrorResponse(error, "expenses");
  if (categoriesError) return serverErrorResponse(categoriesError, "expenses/categories");

  return NextResponse.json({ expenses, expenseCategories });
}

/**
 * POST /api/expenses
 * Logs a single expense (category, amount, optional note) — submitted one
 * at a time, not as a batch sheet like stock_entries, since expenses occur
 * sporadically rather than as a fixed daily set of rows (see
 * docs/phases/phase5_context.md for why this diverges from Phase 4's
 * till-strip batch-save pattern).
 *
 * Staff: `location`/`created_by`/`expense_date` are always server-derived
 * — never accepted from the client body, so a crafted cross-location
 * request has no field to spoof.
 *
 * Admin: can log an expense against a specific location OR business-wide
 * (location = null, e.g. rent, salaries — see
 * 20260721070000_admin_business_wide_expenses.sql). `location` is the one
 * field admin's request body supplies that staff's never can.
 *
 * `category_id` references the admin-managed expense_categories catalog
 * (20260721090000_expense_categories_catalog.sql) — both roles pick from
 * the same shared list, no hardcoded category set.
 *
 * Admin backdating (client feedback, 2026-07-24): admin may also supply
 * `expense_date` to log a missed expense against a past date (e.g. staff
 * forgot to log it on the day it happened) — defaults to today when
 * omitted. Staff's expenseSchema has no such field, so their POSTs always
 * use today's date, unaffected. A backdated write (date != today) is
 * audit-logged, same "non-obvious admin correction" bar the Ledger's own
 * admin-authored stock-consumption claims already use — an ordinary
 * same-day log stays unlogged, matching this route's existing behavior.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || (user.role === "staff" && !user.location)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const supabase = await createServerSupabaseClient();

  let insertResult;
  if (user.role === "admin") {
    const parsed = adminExpenseSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }
    const { category_id, amount, note, location, expense_date } = parsed.data;
    insertResult = await supabase
      .from("expenses")
      .insert({
        location,
        expense_date: expense_date ?? nairobiToday(),
        category_id,
        amount,
        note: note ?? null,
        created_by: user.id,
      })
      .select("*, expense_categories(id, name)")
      .single();
  } else {
    const parsed = expenseSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 },
      );
    }
    const { category_id, amount, note } = parsed.data;
    insertResult = await supabase
      .from("expenses")
      .insert({
        location: user.location,
        expense_date: nairobiToday(),
        category_id,
        amount,
        note: note ?? null,
        created_by: user.id,
      })
      .select("*, expense_categories(id, name)")
      .single();
  }

  const { data, error } = insertResult;

  if (error) {
    return NextResponse.json({ error: "Couldn't save the expense — please try again." }, { status: 500 });
  }

  if (user.role === "admin" && data.expense_date !== nairobiToday()) {
    await writeAuditLog(supabase, {
      actorId: user.id,
      action: "expense.admin_backdated_create",
      targetTable: "expenses",
      targetId: data.id,
      changes: { after: data },
    });
  }

  return NextResponse.json({ expense: data });
}
