import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/types";

const PUBLIC_PATHS = ["/login"];

export async function middleware(request: NextRequest) {
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
    "/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
