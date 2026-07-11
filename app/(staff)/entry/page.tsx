import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { EntryClient } from "./EntryClient";

export default async function EntryPage() {
  const user = await getCurrentUser();

  if (!user || user.role !== "staff" || !user.location) {
    redirect("/login");
  }

  return <EntryClient isStoreManager={user.is_store_manager} />;
}
