import { createServerSupabaseClient } from "@/lib/supabase/server";
import { DeliveryLocationsClient } from "./DeliveryLocationsClient";

export default async function DeliveryLocationsPage() {
  const supabase = await createServerSupabaseClient();
  const { data: deliveryLocations } = await supabase
    .from("delivery_locations")
    .select("*")
    .order("name");

  return <DeliveryLocationsClient initialLocations={deliveryLocations ?? []} />;
}
