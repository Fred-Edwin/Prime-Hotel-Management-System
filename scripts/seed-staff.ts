/**
 * Dev-only: seeds the real Prosper Hotel staff roster into Supabase Auth
 * + public.users. Needs the Auth admin API (service role key), so it
 * can't live in supabase/seed.sql (plain SQL can't hash passwords /
 * create auth.users rows correctly). Run against the LOCAL dev project
 * only — never production.
 *
 * Usage: pnpm tsx scripts/seed-staff.ts
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in
 * the environment (.env.local, loaded automatically by `dotenv/config`).
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type SeedStaff = {
  name: string;
  staffCode: string;
  pin: string;
  role: "admin" | "staff";
  location: "restaurant" | "canteen" | null;
  isStoreManager: boolean;
};

// Real Prosper Hotel roster, per CLAUDE.md. Dev-only PINs — never reused
// in production, where an admin sets real PINs at account creation.
const roster: SeedStaff[] = [
  { name: "WaPrecious", staffCode: "01", pin: "1234", role: "admin", location: null, isStoreManager: false },
  { name: "Janiffer Maina", staffCode: "02", pin: "1111", role: "staff", location: "restaurant", isStoreManager: true },
  { name: "Sarah Makena", staffCode: "03", pin: "2222", role: "staff", location: "restaurant", isStoreManager: false },
  { name: "Mercy Wanjohi", staffCode: "04", pin: "3333", role: "staff", location: "restaurant", isStoreManager: false },
  { name: "Anne Gitonga", staffCode: "05", pin: "4444", role: "staff", location: "canteen", isStoreManager: false },
];

async function main() {
  for (const person of roster) {
    const email = `user-${person.staffCode}@prosper.internal`;

    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password: person.pin,
      email_confirm: true,
    });

    if (createError || !created.user) {
      console.error(`Failed to create auth user for ${person.name}:`, createError?.message);
      continue;
    }

    const { error: profileError } = await supabase.from("users").insert({
      id: created.user.id,
      name: person.name,
      staff_code: person.staffCode,
      role: person.role,
      location: person.location,
      is_store_manager: person.isStoreManager,
    });

    if (profileError) {
      console.error(`Failed to create users row for ${person.name}:`, profileError.message);
      continue;
    }

    console.log(`Seeded ${person.name} (${person.staffCode}) — ${email}`);
  }
}

main().then(() => process.exit(0));
