/**
 * One-off script: production `delivery_locations` table was empty
 * (no Phase 8 seed script had populated it), which blocked the orders
 * screen's delivery-zone selection from having anything to show.
 * Inserts a small realistic set of Nyeri-area delivery zones with fixed
 * fees (staff select a zone, never type a fee -- docs/01_DATA_MODEL.md §6).
 *
 * Safe to re-run only against an EMPTY delivery_locations table -- does
 * not check for or skip existing rows.
 *
 * Usage: node scripts/seed-data/seed_delivery_locations.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(join(__dirname, "../../.env.local"), "utf8");
const env = {};
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

const supabaseUrl = "https://mqtlxuwbjzsjtywhjjtf.supabase.co";
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceRoleKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { count } = await supabase.from("delivery_locations").select("*", { count: "exact", head: true });
if (count > 0) {
  console.error(`delivery_locations already has ${count} rows -- refusing to insert (would duplicate). Aborting.`);
  process.exit(1);
}

const zones = [
  { name: "Nyeri Town", fee: 100 },
  { name: "Kamakwa", fee: 150 },
  { name: "Ruring'u", fee: 150 },
  { name: "Kiganjo", fee: 250 },
];

console.log(`Inserting ${zones.length} delivery zones...`);
const { data, error } = await supabase
  .from("delivery_locations")
  .insert(zones.map((z) => ({ ...z, active: true })))
  .select("id, name, fee");
if (error) throw error;
console.log("Inserted:", data.map((z) => `${z.name} (KES ${z.fee})`).join(", "));
