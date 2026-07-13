/**
 * One-off script: backdates ~4 days of realistic stock_entries/
 * expenses/orders history (both locations) into the production demo
 * project, so a recorded product-demo video shows a real dashboard/
 * ledger/trend instead of all zeros. TODAY is deliberately left
 * untouched -- videos of staff "saving today's entry" should be a real,
 * live first save, not a replay of already-seeded data.
 *
 * Written directly via the service-role client (bypasses the app's own
 * date-scoped RLS/write-path on purpose) -- this is the established,
 * correct way to manufacture backdated fixtures in this project (see
 * scripts/acceptance/_lib.mjs's psql() helper and its own doc comment
 * for why: the real write paths correctly reject non-today writes).
 *
 * Usage: NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *        node scripts/seed-data/seed_demo_history.mjs
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

function isoDate(daysAgo) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function weekStartMonday(daysAgo) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1) - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

const { data: users } = await supabase.from("users").select("id, staff_code, location");
const byCode = Object.fromEntries(users.map((u) => [u.staff_code, u]));
const sarah = byCode["03"]; // restaurant
const anne = byCode["05"]; // canteen
const janiffer = byCode["02"]; // restaurant, store manager

const { data: items } = await supabase
  .from("items")
  .select("id, name, category, supply_type, selling_price, buying_price, location:supply_type");

const restaurantItems = items.filter((i) => i.supply_type !== "canteen_independent");
const canteenItems = items.filter((i) => i.supply_type !== "restaurant_only");

// A representative slice for each location so the dashboard/ledger have
// varied categories, not just one item repeated.
const pick = (list, names) => names.map((n) => list.find((i) => i.name === n)).filter(Boolean);

const restaurantPicks = pick(restaurantItems, [
  "Black Tea", "Chapati", "Samosa", "Beef Stew", "Soda 500ml", "Chicken Stew",
]);
const canteenPicks = pick(canteenItems, [
  "Soda 500ml", "Chapati", "Bic Pen", "Fresh", "Bananas", "Bisc za 10/=",
]);

function calcRestaurantRow({ item, opening, added, sentOut, sold, wastage }) {
  const closing = opening + added - sentOut - sold - wastage;
  return {
    item_id: item.id,
    location: "restaurant",
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
    created_by: sarah.id,
  };
}

function calcCanteenRow({ item, opening, added, sold, wastage }) {
  const closing = opening + added - sold - wastage;
  return {
    item_id: item.id,
    location: "canteen",
    opening_stock: opening,
    added_stock: added,
    sent_out: 0,
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
    created_by: anne.id,
  };
}

console.log("Seeding restaurant daily stock_entries (last 4 days, not today)...");
let carryStock = Object.fromEntries(restaurantPicks.map((i) => [i.id, 40]));

for (let daysAgo = 4; daysAgo >= 1; daysAgo--) {
  const entryDate = isoDate(daysAgo);
  const rows = restaurantPicks.map((item, idx) => {
    const opening = carryStock[item.id];
    const added = 15 + (idx % 3) * 5;
    const sentOut = item.supply_type === "canteen_supplied" ? 5 + (idx % 2) * 3 : 0;
    const sold = 10 + (idx % 4) * 4;
    const wastage = idx === 0 ? 1 : 0;
    const row = calcRestaurantRow({ item, opening, added, sentOut, sold, wastage });
    carryStock[item.id] = row.closing_stock;
    return { ...row, entry_date: entryDate };
  });

  const { error } = await supabase.from("stock_entries").insert(rows);
  if (error) {
    console.error(`  ${entryDate}: FAILED`, error.message);
  } else {
    console.log(`  ${entryDate}: inserted ${rows.length} rows`);
  }
}

console.log("Seeding canteen weekly stock_entries (last week, not this week)...");
const lastWeekMonday = weekStartMonday(7);
{
  const rows = canteenPicks.map((item, idx) => {
    const opening = 20 + idx * 3;
    const added = item.supply_type === "canteen_supplied" ? 20 : 15;
    const sold = 12 + (idx % 3) * 5;
    const wastage = idx === 1 ? 2 : 0;
    return { ...calcCanteenRow({ item, opening, added, sold, wastage }), entry_date: lastWeekMonday };
  });
  const { error } = await supabase.from("stock_entries").insert(rows);
  if (error) console.error("  FAILED", error.message);
  else console.log(`  ${lastWeekMonday}: inserted ${rows.length} rows`);
}

console.log("Seeding expenses (last 4 days, both locations)...");
const expenseCategories = ["electricity", "gas", "charcoal", "other"];
for (let daysAgo = 4; daysAgo >= 1; daysAgo--) {
  const entryDate = isoDate(daysAgo);
  const rows = [
    { location: "restaurant", expense_date: entryDate, category: expenseCategories[daysAgo % 4], amount: 500 + daysAgo * 50, note: null, created_by: sarah.id },
    { location: "canteen", expense_date: entryDate, category: expenseCategories[(daysAgo + 1) % 4], amount: 300 + daysAgo * 30, note: null, created_by: anne.id },
  ];
  const { error } = await supabase.from("expenses").insert(rows);
  if (error) console.error(`  ${entryDate}: FAILED`, error.message);
  else console.log(`  ${entryDate}: inserted ${rows.length} rows`);
}

console.log("Seeding a couple of backdated orders (restaurant, 2 days ago)...");
{
  const { data: zones } = await supabase.from("delivery_locations").select("id, fee").limit(1);
  const zone = zones?.[0];
  const orderDate = isoDate(2);
  const item = restaurantPicks[0];

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      location: "restaurant",
      order_date: orderDate,
      customer_name: "Demo Customer",
      fulfillment_type: zone ? "delivery" : "pickup",
      delivery_location_id: zone?.id ?? null,
      delivery_fee_snapshot: zone?.fee ?? 0,
      total_amount: item.selling_price * 2 + (zone?.fee ?? 0),
      client_request_id: crypto.randomUUID(),
      created_by: sarah.id,
    })
    .select()
    .single();

  if (orderError) {
    console.error("  order FAILED", orderError.message);
  } else {
    await supabase.from("order_items").insert({
      order_id: order.id,
      item_id: item.id,
      quantity: 2,
      selling_price_snapshot: item.selling_price,
    });
    console.log(`  ${orderDate}: inserted 1 order`);
  }
}

console.log("Done. Today's date is untouched -- ready for a live 'save entry' demo.");
