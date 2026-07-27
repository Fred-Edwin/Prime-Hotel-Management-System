import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAdmin } from "@/lib/auth";
import { ADMIN_ACTING_AS_COOKIE, normalizeActingAs } from "@/lib/actingAs";

// A work-shift length, not indefinite — so a forgotten "exit" doesn't
// silently leave admin able to act as staff for days.
const MAX_AGE_SECONDS = 8 * 60 * 60;

/** GET /api/admin/acting-as — current acting-mode state, or null. Lets the sidebar restore its selection after a reload. */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const cookieStore = await cookies();
  const actingAs = normalizeActingAs(
    (() => {
      try {
        return JSON.parse(cookieStore.get(ADMIN_ACTING_AS_COOKIE)?.value ?? "");
      } catch {
        return null;
      }
    })(),
  );
  return NextResponse.json({ actingAs });
}

/**
 * POST /api/admin/acting-as — enter or exit acting mode.
 * Body: { role: "cashier"|"store_manager"|null, location?: "restaurant"|"canteen" }
 * role: null clears the cookie (exit, back to plain admin).
 */
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const cookieStore = await cookies();

  if (!body || body.role === null) {
    cookieStore.delete(ADMIN_ACTING_AS_COOKIE);
    return NextResponse.json({ actingAs: null });
  }

  const actingAs = normalizeActingAs(body);
  if (!actingAs) {
    return NextResponse.json({ error: "Invalid role/location combination" }, { status: 400 });
  }

  cookieStore.set(ADMIN_ACTING_AS_COOKIE, JSON.stringify(actingAs), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_SECONDS,
    path: "/",
  });

  return NextResponse.json({ actingAs });
}
