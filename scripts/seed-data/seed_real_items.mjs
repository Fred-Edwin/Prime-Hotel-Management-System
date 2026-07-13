/**
 * One-off script: inserts scripts/seed-data/merged_items.json (built by
 * build_merged_items.py) into the `items` table of whichever Supabase
 * project NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY point at.
 *
 * Used once during Phase 8 to seed the production demo project with
 * Prime Hotel's real catalog (see docs/phases/phase8_context.md). Safe
 * to re-run against an EMPTY items table only -- does not check for or
 * skip existing rows, so running it twice will duplicate the catalog.
 * Confirm `select count(*) from items` is 0 first if reusing this.
 *
 * Usage: NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *        node scripts/seed-data/seed_real_items.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const items = JSON.parse(readFileSync(join(__dirname, "merged_items.json"), "utf-8"));

const { count } = await supabase.from("items").select("*", { count: "exact", head: true });
if (count > 0) {
  console.error(`items table already has ${count} rows -- refusing to insert (would duplicate). Aborting.`);
  process.exit(1);
}

const rows = items.map((i) => ({
  name: i.name,
  category: i.category,
  supply_type: i.supply_type,
  buying_price: i.buying_price,
  selling_price: i.selling_price,
  low_stock_threshold: 5,
  active: true,
}));

console.log(`Inserting ${rows.length} items...`);

const { data, error } = await supabase.from("items").insert(rows).select("id, name");

if (error) {
  console.error("Insert failed:", error);
  process.exit(1);
}

console.log(`Inserted ${data.length} items successfully.`);
