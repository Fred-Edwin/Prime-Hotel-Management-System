import { redirect } from "next/navigation";
import { getActingContext } from "@/lib/auth";
import { EntryClient } from "./EntryClient";
import { CanteenEntryClient } from "./CanteenEntryClient";

export default async function EntryPage() {
  const ctx = await getActingContext();

  if (!ctx) {
    redirect("/login");
  }

  if (ctx.location === "canteen") {
    return <CanteenEntryClient />;
  }

  return <EntryClient isStoreManager={ctx.isStoreManager} />;
}
