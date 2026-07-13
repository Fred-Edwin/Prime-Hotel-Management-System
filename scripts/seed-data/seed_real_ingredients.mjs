/**
 * One-off script: production `ingredients` table was empty (no Phase 8
 * seed script had ever populated it), which blocked the store-manager
 * screen (/store) from having anything to show. Inserts a small
 * realistic restaurant ingredient catalog, then a "yesterday" (entry_date
 * = today - 1) ingredient_entries row per ingredient with a real
 * closing_stock, so save_ingredient_entry() (which derives today's
 * opening_stock from yesterday's closing_stock -- see
 * supabase/migrations/20260711100001_entry_write_functions.sql) has a
 * legitimate prior day to compute from, avoiding the same
 * opening-stock-resolves-to-0 oversell trap fixed for stock_entries
 * (see .claude/tools/playwright/fix_yesterday_rows.mjs).
 *
 * Safe to re-run only against an EMPTY ingredients table -- does not
 * check for or skip existing rows.
 *
 * Usage: node scripts/seed-data/seed_real_ingredients.mjs
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

const { count } = await supabase.from("ingredients").select("*", { count: "exact", head: true });
if (count > 0) {
  console.error(`ingredients table already has ${count} rows -- refusing to insert (would duplicate). Aborting.`);
  process.exit(1);
}

const ingredients = [
  { name: "Cooking oil", unit: "litre", buying_price: 280 },
  { name: "Rice", unit: "kg", buying_price: 150 },
  { name: "Wheat flour", unit: "kg", buying_price: 130 },
  { name: "Sugar", unit: "kg", buying_price: 180 },
  { name: "Tomatoes", unit: "kg", buying_price: 90 },
  { name: "Onions", unit: "kg", buying_price: 100 },
  { name: "Charcoal", unit: "bag", buying_price: 900 },
];

console.log(`Inserting ${ingredients.length} ingredients...`);
const { data: inserted, error: insErr } = await supabase
  .from("ingredients")
  .insert(ingredients.map((i) => ({ ...i, active: true })))
  .select("id, name, buying_price");
if (insErr) throw insErr;
console.log("Inserted:", inserted.map((i) => i.name).join(", "));

const { data: users, error: usersErr } = await supabase.from("users").select("id, staff_code");
if (usersErr) throw usersErr;
const janiffer = users.find((u) => u.staff_code === "02");

const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

const yesterdayRows = inserted.map((ing) => {
  const closing = 40;
  return {
    ingredient_id: ing.id,
    entry_date: yesterday,
    opening_stock: 0,
    received: closing,
    quantity_used: 0,
    wastage: 0,
    buying_price_snapshot: ing.buying_price,
    closing_stock: closing,
    closing_stock_value: closing * ing.buying_price,
    wastage_value: 0,
    created_by: janiffer.id,
  };
});

console.log(`Inserting ${yesterdayRows.length} yesterday (${yesterday}) ingredient_entries rows (closing_stock=40)...`);
const { error: rowsErr } = await supabase.from("ingredient_entries").insert(yesterdayRows);
if (rowsErr) throw rowsErr;

console.log("Done.");
