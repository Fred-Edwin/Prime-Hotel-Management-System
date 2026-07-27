import { redirect } from "next/navigation";
import { getActingContext } from "@/lib/auth";
import { OrdersClient } from "./OrdersClient";

export default async function OrdersPage() {
  const ctx = await getActingContext();

  if (!ctx) {
    redirect("/login");
  }

  return <OrdersClient />;
}
