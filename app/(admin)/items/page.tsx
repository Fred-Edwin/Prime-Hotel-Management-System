import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ItemsClient } from "./ItemsClient";

export default async function ItemsPage() {
  const supabase = await createServerSupabaseClient();
  const { data: items } = await supabase.from("items").select("*").order("category").order("name");

  return <ItemsClient initialItems={items ?? []} />;
}
