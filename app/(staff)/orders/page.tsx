import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { OrdersClient } from "./OrdersClient";

export default async function OrdersPage() {
  const user = await getCurrentUser();

  if (!user || user.role !== "staff" || !user.location) {
    redirect("/login");
  }

  return <OrdersClient />;
}
