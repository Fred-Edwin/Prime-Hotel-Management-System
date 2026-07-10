import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AdminShell } from "./AdminShell";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  // Belt-and-suspenders: middleware already redirects staff away from
  // admin route prefixes, but this route group re-checks server-side too,
  // per CLAUDE.md's "admin routes gated both by RLS and server-side" rule.
  if (!user || user.role !== "admin") {
    redirect("/entry");
  }

  return <AdminShell staffName={user.name}>{children}</AdminShell>;
}
