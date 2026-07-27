import { redirect } from "next/navigation";
import { getActingContext } from "@/lib/auth";
import { StaffShell } from "./StaffShell";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  // Belt-and-suspenders: middleware already redirects admin away from
  // staff routes (unless acting-as is active), but this route group
  // re-checks server-side too, same pattern as app/(admin)/layout.tsx.
  // getActingContext() (lib/auth.ts) resolves a real staff member's own
  // session, or an admin's chosen acting-mode cookie re-validated
  // server-side — null covers both "not logged in" and "admin, not
  // currently acting."
  const ctx = await getActingContext();
  if (!ctx) {
    redirect("/login");
  }

  return (
    <StaffShell
      staffName={ctx.user.name}
      location={ctx.location}
      isStoreManager={ctx.isStoreManager}
      actingAs={ctx.actingAs}
    >
      {children}
    </StaffShell>
  );
}
