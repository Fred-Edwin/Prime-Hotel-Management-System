import { createServerSupabaseClient } from "@/lib/supabase/server";
import { StaffClient } from "./StaffClient";

export default async function StaffPage() {
  const supabase = await createServerSupabaseClient();
  const { data: staff } = await supabase
    .from("users")
    .select("id, name, staff_code, role, location, is_store_manager, created_at")
    .order("staff_code");

  return <StaffClient initialStaff={staff ?? []} />;
}
