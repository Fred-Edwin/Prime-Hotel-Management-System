import { createServerSupabaseClient } from "@/lib/supabase/server";
import { IngredientsClient } from "./IngredientsClient";

export default async function IngredientsPage() {
  const supabase = await createServerSupabaseClient();
  const { data: ingredients } = await supabase.from("ingredients").select("*").order("name");

  return <IngredientsClient initialIngredients={ingredients ?? []} />;
}
