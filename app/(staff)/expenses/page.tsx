import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ExpensesClient } from "./ExpensesClient";

export default async function ExpensesPage() {
  const user = await getCurrentUser();

  if (!user || user.role !== "staff" || !user.location) {
    redirect("/login");
  }

  return <ExpensesClient />;
}
