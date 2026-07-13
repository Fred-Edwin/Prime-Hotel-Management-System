/**
 * One-off script: seeds a small TODAY baseline (a handful of items NOT
 * touched by the recorded demo videos) so the dashboard's "Week" view
 * has real numbers even before the live "save entry" recording happens
 * -- today's server date (2026-07-13) is a Monday, so "last 4 days"
 * fixtures (seed_demo_history.mjs) all land in the prior week.
 *
 * Deliberately uses a DIFFERENT item set than the ones the recorded
 * flows will interact with (African Tea, Ice cream, Sweetpotatoes,
 * Nescafe, Lollipop), so Sarah/Anne's /entry screens still look
 * genuinely untouched for the items the video actually saves.
 *
 * Usage: NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *        node scripts/seed-data/seed_today_baseline.mjs
 */
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const today = new Date().toISOString().slice(0, 10);

const { data: users } = await supabase.from("users").select("id, staff_code");
const byCode = Object.fromEntries(users.map((u) => [u.staff_code, u]));
const sarah = byCode["03"];
const anne = byCode["05"];

const { data: items } = await supabase
  .from("items")
  .select("id, name, supply_type, selling_price, buying_price")
  .in("name", ["African Tea", "Ice cream", "Sweetpotatoes", "Nescafe", "Lollipop"]);

function row({ item, opening, added, sentOut, sold, wastage, location, createdBy }) {
  const closing = opening + added - sentOut - sold - wastage;
  return {
    item_id: item.id,
    location,
    entry_date: today,
    opening_stock: opening,
    added_stock: added,
    sent_out: sentOut,
    till_quantity_sold: sold,
    quantity_sold: sold,
    wastage,
    selling_price_snapshot: item.selling_price,
    buying_price_snapshot: item.buying_price,
    closing_stock: closing,
    sales_value: sold * item.selling_price,
    cost_value: sold * item.buying_price,
    closing_stock_value: closing * item.buying_price,
    wastage_value: wastage * item.buying_price,
    created_by: createdBy,
  };
}

const restaurantItems = items.filter((i) => i.supply_type !== "canteen_independent");
const canteenItems = items.filter((i) => i.supply_type !== "restaurant_only");

const rows = [
  ...restaurantItems.map((item, idx) =>
    row({
      item,
      opening: 30,
      added: 10,
      sentOut: item.supply_type === "canteen_supplied" ? 5 : 0,
      sold: 8 + idx * 2,
      wastage: 0,
      location: "restaurant",
      createdBy: sarah.id,
    }),
  ),
  ...canteenItems
    .filter((i) => i.supply_type === "canteen_independent")
    .map((item, idx) =>
      row({
        item,
        opening: 20,
        added: 10,
        sentOut: 0,
        sold: 5 + idx * 2,
        wastage: 0,
        location: "canteen",
        createdBy: anne.id,
      }),
    ),
];

console.log(`Seeding ${rows.length} today-dated baseline rows (${today})...`);
const { error } = await supabase.from("stock_entries").insert(rows);
if (error) {
  console.error("FAILED", error.message);
  process.exit(1);
}
console.log("Done.");
