import { redirect } from "next/navigation";
import { getActingContext } from "@/lib/auth";
import { StoreClient } from "./StoreClient";

export default async function StorePage() {
  const ctx = await getActingContext();

  // isStoreManager already covers both a real restaurant staff member's
  // own flag and an admin acting as Store Manager (getActingContext()
  // in lib/auth.ts forces that acting role's location to "restaurant").
  if (!ctx || ctx.location !== "restaurant" || !ctx.isStoreManager) {
    redirect("/entry");
  }

  return <StoreClient />;
}
