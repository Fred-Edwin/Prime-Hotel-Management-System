import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/types";

// Unauthenticated-only: signed-in users get redirected away to their
// role landing page (doesn't make sense to see the login screen while
// already logged in).
const PUBLIC_PATHS = ["/login"];

// Always accessible, regardless of auth state — dev-only, no business
// data, not part of the product's own navigation. See
// app/style-guide/page.tsx.
//
// /manifest.webmanifest is here for a different reason: browsers fetch
// it anonymously to evaluate PWA installability, before any auth
// cookie exists. Redirecting it to /login breaks "Add to Home Screen".
const ALWAYS_ACCESSIBLE_PATHS = ["/style-guide", "/manifest.webmanifest"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublicPath = PUBLIC_PATHS.includes(pathname);
  const isAlwaysAccessible = ALWAYS_ACCESSIBLE_PATHS.includes(pathname);

  if (isAlwaysAccessible) {
    return response;
  }

  // /api/* only needs the auth.getUser() call above for its cookie-refresh
  // side effect (see lib/supabase/server.ts's createServerSupabaseClient()
  // doc comment: it relies on the proxy refreshing the session on every
  // request). None of the page-routing logic below applies to an API
  // call — an expired/missing session on a route handler must stay a JSON
  // 401/403 the route itself returns, not a redirect to /login, which
  // would hand fetch() callers an HTML response instead of JSON. Bug
  // found 2026-07-24: /api was previously excluded from the matcher
  // entirely, so API route sessions were never refreshed at all — every
  // staff write silently started failing with a bare "Forbidden" once the
  // 1-hour JWT (supabase/config.toml's jwt_expiry) expired mid-session,
  // regardless of location; canteen surfaced it first only because Anne's
  // /entry autosave keeps a session open longest.
  if (pathname.startsWith("/api")) {
    return response;
  }

  if (!authUser) {
    if (!isPublicPath) {
      const loginUrl = new URL("/login", request.url);
      return NextResponse.redirect(loginUrl);
    }
    return response;
  }

  // Authenticated: keep staff/admin off each other's route groups and
  // off /login. Role comes from public.users, not just auth session.
  const profileQuery = supabase.from("users").select("role").eq("id", authUser.id).single();
  const { data: profile }: Awaited<typeof profileQuery> = await profileQuery;

  const isAdmin = (profile as { role: string } | null)?.role === "admin";
  const isAdminRoute = ADMIN_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const isStaffRoute = STAFF_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (isPublicPath) {
    const destination = isAdmin ? "/dashboard" : "/entry";
    return NextResponse.redirect(new URL(destination, request.url));
  }

  if (isAdminRoute && !isAdmin) {
    return NextResponse.redirect(new URL("/entry", request.url));
  }

  if (isStaffRoute && isAdmin) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

const ADMIN_ROUTE_PREFIXES = [
  "/dashboard",
  "/items",
  "/ingredients",
  "/delivery-locations",
  "/staff",
];

const STAFF_ROUTE_PREFIXES = ["/entry", "/store", "/expenses", "/orders", "/summary"];

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
