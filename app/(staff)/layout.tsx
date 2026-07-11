import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { StaffShell } from "./StaffShell";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  // Belt-and-suspenders: middleware already redirects admin away from
  // staff routes, but this route group re-checks server-side too, same
  // pattern as app/(admin)/layout.tsx.
  if (!user || user.role !== "staff" || !user.location) {
    redirect("/login");
  }

  return (
    <StaffShell staffName={user.name} location={user.location} isStoreManager={user.is_store_manager}>
      {children}
    </StaffShell>
  );
}
