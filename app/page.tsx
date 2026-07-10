import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

/**
 * Root route: redirects to /login or the role-appropriate landing
 * page. middleware.ts already redirects most navigations before this
 * ever renders; this is the fallback for a direct request to "/".
 */
export default async function Home() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  redirect(user.role === "admin" ? "/dashboard" : "/entry");
}
