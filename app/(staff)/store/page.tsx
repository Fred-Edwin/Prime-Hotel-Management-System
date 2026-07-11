import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { StoreClient } from "./StoreClient";

export default async function StorePage() {
  const user = await getCurrentUser();

  if (!user || user.role !== "staff" || user.location !== "restaurant" || !user.is_store_manager) {
    redirect("/entry");
  }

  return <StoreClient />;
}
