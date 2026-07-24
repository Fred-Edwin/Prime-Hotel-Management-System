#!/usr/bin/env node
/**
 * Phase 11 acceptance checks — Credit/Debtor Ledger
 * (docs/04_PHASE_PLAN.md's Phase 11 section, docs/01_DATA_MODEL.md §6's
 * "Credit sales and customer payments" subsection).
 *
 * Environment note (same as post-launch-staff-meals.mjs /
 * post-launch-canteen-daily-cadence.mjs — read before "fixing" this
 * script to use psql()): this repo's .env.local points at the HOSTED
 * prosper-hotel-dev Supabase project, not local Docker. This script does
 * NOT use psql() at all — fixture setup/teardown goes through a direct
 * service-role Supabase client (supabaseAdmin below), and every
 * correctness assertion goes through real HTTP calls (login()/api())
 * against the live dev server. No backdated-row fixtures are needed for
 * any check here (every scenario below happens "today"), so this script
 * doesn't have the same "missing psql-based fixture" gap those two
 * scripts flag for themselves — it's a complete HTTP-level suite.
 *
 * Covers:
 *  - customer creation (staff-originated, any authenticated role can
 *    create one — customers_insert_any_authenticated)
 *  - a walk-in counter/credit order (fulfillment_type='counter') is
 *    created exactly like a pickup order for stock-deduction purposes,
 *    with customer_id attached and no delivery fee
 *  - that order's stock deduction goes through the existing
 *    apply_order_to_stock_entry() path unchanged (quantity_sold
 *    increments correctly, same mechanism as any other order)
 *  - record_order_payment(): a legitimate partial payment succeeds
 *    (this is the actual regression target — an earlier version of this
 *    migration shipped record_order_payment() as `security invoker`,
 *    which RLS silently blocked on its own INSERT into order_payments
 *    since that table deliberately has no INSERT policy; found via
 *    direct curl testing against prosper-hotel-dev and fixed by
 *    switching to `security definer` — see docs/01_DATA_MODEL.md §4's
 *    ORDER_PAYMENTS note and docs/phases/phase11_context.md)
 *  - an overpayment attempt (more than the remaining outstanding
 *    balance) is rejected with 409 / errcode P0005, and does NOT get
 *    inserted (the order's outstanding balance is unchanged after the
 *    rejected attempt)
 *  - GET /api/orders/[id]/payments derives totalPaid/outstanding
 *    correctly from the payments actually recorded
 *  - GET /api/admin/debtors aggregates the right customer with the
 *    right outstanding/total_paid/order_count
 *  - GET /api/admin/debtors/[customerId]/orders drills into exactly
 *    that customer's orders
 *  - GET /api/admin/debtors is admin-only (403 for staff)
 *  - cross-location boundary: a canteen staff member cannot record a
 *    payment against a restaurant-location order (or vice versa) — even
 *    though `customers` itself is deliberately not location-scoped, sees
 *    a 404 (P0006 'unknown_order') from record_order_payment()'s own
 *    `is_admin() or location = my_location()` check, same boundary
 *    orders_select_scoped already applies everywhere else in this schema
 *  - GET /api/dashboard/summary's outstandingTotal reflects the real
 *    outstanding balance after a partial payment
 *
 * Usage: node scripts/acceptance/phase11-credit-ledger.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { api, check, login, ROSTER, summarizeAndExit } from "./_lib.mjs";

config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const today = new Date().toISOString().slice(0, 10);

// Every customer/order/item this script creates uses this name prefix, so
// cleanup can target exactly (and only) this run's own data.
const MARKER = "[acceptance-test] Phase11";

async function cleanup() {
  const { data: customers } = await supabaseAdmin.from("customers").select("id").like("name", `${MARKER}%`);
  const customerIds = (customers ?? []).map((c) => c.id);
  if (customerIds.length > 0) {
    const { data: orders } = await supabaseAdmin.from("orders").select("id").in("customer_id", customerIds);
    const orderIds = (orders ?? []).map((o) => o.id);
    if (orderIds.length > 0) {
      await supabaseAdmin.from("order_payments").delete().in("order_id", orderIds);
      await supabaseAdmin.from("order_items").delete().in("order_id", orderIds);
      await supabaseAdmin.from("orders").delete().in("id", orderIds);
    }
    await supabaseAdmin.from("customers").delete().in("id", customerIds);
  }
  // Orders/customers this script creates for the cross-location test are
  // also name-prefixed, but may not carry customer_id if the location
  // check rejects before insert — belt-and-braces sweep on order name too.
  await supabaseAdmin.from("orders").delete().like("customer_name", `${MARKER}%`);

  const { data: fixtureItems } = await supabaseAdmin.from("items").select("id").like("name", `${MARKER}%`);
  const fixtureItemIds = (fixtureItems ?? []).map((i) => i.id);
  if (fixtureItemIds.length > 0) {
    await supabaseAdmin.from("stock_entries").delete().in("item_id", fixtureItemIds);
    await supabaseAdmin.from("order_items").delete().in("item_id", fixtureItemIds);
    await supabaseAdmin.from("items").delete().in("id", fixtureItemIds);
  }
}

async function main() {
  await cleanup();

  const sarahCookie = await login("sarah"); // restaurant
  const anneCookie = await login("anne"); // canteen
  const adminCookie = await login("admin");

  const sarahOrders = await api(sarahCookie, "GET", `/api/orders?date=${today}`);
  check("Sarah's GET /api/orders succeeds", sarahOrders.status === 200, sarahOrders);
  const restaurantItem = (sarahOrders.body.items ?? []).find((i) => i.supply_type === "restaurant_only");
  if (!restaurantItem) throw new Error("No restaurant_only item found in seed data");

  // ---------------------------------------------------------------
  // TEST 1: Customer creation — any authenticated staff can create one.
  // ---------------------------------------------------------------
  console.log("\n=== TEST 1: Customer creation ===");
  const customerName = `${MARKER} Debtor A`;
  const createCustomerRes = await api(sarahCookie, "POST", "/api/customers", {
    name: customerName,
    phone: "0700000001",
  });
  check("Staff can create a customer", createCustomerRes.status === 201, createCustomerRes);
  const customerId = createCustomerRes.body?.customer?.id;
  check("Created customer has an id", Boolean(customerId), createCustomerRes.body);

  // ---------------------------------------------------------------
  // TEST 2: Counter/credit order — fulfillment_type='counter', linked
  // to the customer, no delivery fee, stock deducted via the existing
  // apply_order_to_stock_entry() path (unchanged by this phase).
  // ---------------------------------------------------------------
  console.log("\n=== TEST 2: Counter/credit order creation + stock deduction ===");
  // Use a dedicated fixture item (service-role insert) rather than reading
  // a real seed item's shared, cumulative quantity_sold before/after —
  // comparing two separate GETs of a field every other concurrent order/
  // till-sale in this dev project can also touch is inherently racy (a
  // stale/out-of-order read on either side produces a false negative
  // unrelated to this feature's own correctness). A fixture item this
  // script fully owns makes the increment check exact and non-flaky.
  const fixtureItemId = randomUUID();
  const { error: fixtureItemError } = await supabaseAdmin.from("items").insert({
    id: fixtureItemId,
    name: `${MARKER} Fixture Item`,
    category: "others",
    supply_type: "restaurant_only",
    buying_price: 10,
    selling_price: 30,
    active: true,
  });
  check("Fixture item created for stock-deduction test", !fixtureItemError, fixtureItemError);

  // A brand-new item has no stock_entries row yet, so ordering against it
  // correctly 409s as an oversell (V1 behavior — items need opening stock
  // before they can be sold, same as any other item). Seed today's row
  // directly (service role), same pattern post-launch-staff-meals.mjs
  // uses, so this order has real stock to sell against.
  const sarahUser = await supabaseAdmin.from("users").select("id").eq("name", ROSTER.sarah.name).single();
  const { error: fixtureStockError } = await supabaseAdmin.from("stock_entries").insert({
    item_id: fixtureItemId,
    location: "restaurant",
    entry_date: today,
    opening_stock: 0,
    added_stock: 10,
    sent_out: 0,
    till_quantity_sold: 0,
    quantity_sold: 0,
    wastage: 0,
    selling_price_snapshot: 30,
    buying_price_snapshot: 10,
    closing_stock: 10,
    sales_value: 0,
    cost_value: 0,
    closing_stock_value: 100,
    wastage_value: 0,
    created_by: sarahUser.data.id,
  });
  check("Fixture stock_entries row created (10 in stock)", !fixtureStockError, fixtureStockError);

  const orderQty = 1;
  const orderRes = await api(sarahCookie, "POST", "/api/orders", {
    customer_name: customerName,
    customer_id: customerId,
    fulfillment_type: "counter",
    delivery_location_id: null,
    items: [{ item_id: fixtureItemId, quantity: orderQty }],
    client_request_id: randomUUID(),
  });
  check("Counter order created (201)", orderRes.status === 201, orderRes);
  check("Order fulfillment_type is 'counter'", orderRes.body?.order?.fulfillment_type === "counter", orderRes.body?.order);
  check("Order customer_id matches the created customer", orderRes.body?.order?.customer_id === customerId, orderRes.body?.order);
  check("No delivery fee on a counter order", orderRes.body?.order?.delivery_fee_snapshot === 0, orderRes.body?.order);
  const expectedTotal = orderQty * 30;
  check(`Order total = item price only (expected ${expectedTotal})`, orderRes.body?.order?.total_amount === expectedTotal, orderRes.body?.order);
  const orderId = orderRes.body?.order?.id;

  const afterStock = await api(sarahCookie, "GET", `/api/orders?date=${today}`);
  const afterRow = (afterStock.body.stockEntries ?? []).find((e) => e.item_id === fixtureItemId);
  check(
    `quantity_sold on the fixture item (brand new today, 0 -> ${orderQty}) reflects the counter order alone`,
    afterRow?.quantity_sold === orderQty,
    afterRow,
  );

  // ---------------------------------------------------------------
  // TEST 3 (REGRESSION — the actual bug this script exists to catch):
  // A legitimate partial payment must succeed. An earlier version of
  // record_order_payment() was `security invoker`, which RLS silently
  // rejected (order_payments has no INSERT policy at all) — every
  // payment attempt failed with a 403 even though the order/caller/
  // amount were all valid. Fixed by making the function `security
  // definer`. This test is the permanent guard against that regressing.
  // ---------------------------------------------------------------
  console.log("\n=== TEST 3 (REGRESSION): Legitimate partial payment succeeds ===");
  const partialAmount = Math.round((expectedTotal / 2) * 100) / 100;
  const paymentRes = await api(sarahCookie, "POST", `/api/orders/${orderId}/payments`, {
    amount: partialAmount,
    note: `${MARKER} partial payment`,
  });
  check(
    `Partial payment of ${partialAmount} succeeds (201) — NOT a 403 RLS rejection`,
    paymentRes.status === 201,
    paymentRes,
  );
  check("Payment amount echoed back correctly", paymentRes.body?.payment?.amount === partialAmount, paymentRes.body);

  // ---------------------------------------------------------------
  // TEST 4: Overpayment is rejected (409, P0005-derived message), and
  // does NOT get inserted — outstanding balance unchanged after.
  // ---------------------------------------------------------------
  console.log("\n=== TEST 4: Overpayment rejected, no partial insert ===");
  const overpayRes = await api(sarahCookie, "POST", `/api/orders/${orderId}/payments`, {
    amount: 999999,
  });
  check("Overpayment attempt rejected with 409", overpayRes.status === 409, overpayRes);

  const paymentsAfterOverpay = await api(sarahCookie, "GET", `/api/orders/${orderId}/payments`);
  check(
    `Outstanding balance unchanged by the rejected overpayment (still ${expectedTotal - partialAmount})`,
    paymentsAfterOverpay.body?.outstanding === Math.round((expectedTotal - partialAmount) * 100) / 100,
    paymentsAfterOverpay.body,
  );
  check(
    "totalPaid reflects only the one legitimate payment, not the rejected overpayment",
    paymentsAfterOverpay.body?.totalPaid === partialAmount,
    paymentsAfterOverpay.body,
  );

  // ---------------------------------------------------------------
  // TEST 5: Admin debtors list aggregates this customer correctly.
  // ---------------------------------------------------------------
  console.log("\n=== TEST 5: Admin debtors list ===");
  const debtorsRes = await api(adminCookie, "GET", "/api/admin/debtors");
  check("Admin debtors list succeeds", debtorsRes.status === 200, debtorsRes);
  const debtorRow = (debtorsRes.body.debtors ?? []).find((d) => d.customer_id === customerId);
  check("Debtors list includes this customer", Boolean(debtorRow), debtorsRes.body.debtors);
  check(`Debtor's outstanding = ${expectedTotal - partialAmount}`, debtorRow?.outstanding === Math.round((expectedTotal - partialAmount) * 100) / 100, debtorRow);
  check(`Debtor's total_paid = ${partialAmount}`, debtorRow?.total_paid === partialAmount, debtorRow);
  check("Debtor's order_count = 1", debtorRow?.order_count === 1 || debtorRow?.order_count === "1", debtorRow);

  // ---------------------------------------------------------------
  // TEST 6: Admin drill-in shows exactly this customer's orders.
  // ---------------------------------------------------------------
  console.log("\n=== TEST 6: Admin drill-in ===");
  const drillInRes = await api(adminCookie, "GET", `/api/admin/debtors/${customerId}/orders`);
  check("Drill-in succeeds", drillInRes.status === 200, drillInRes);
  check(
    "Drill-in returns exactly the one order created above",
    (drillInRes.body.orders ?? []).length === 1 && drillInRes.body.orders[0].id === orderId,
    drillInRes.body,
  );

  // ---------------------------------------------------------------
  // TEST 7: Admin-only route — staff gets 403.
  // ---------------------------------------------------------------
  console.log("\n=== TEST 7: Non-admin gets 403 on /api/admin/debtors ===");
  const staffDebtorsRes = await api(sarahCookie, "GET", "/api/admin/debtors");
  check("Staff (non-admin) forbidden from admin debtors route", staffDebtorsRes.status === 403, staffDebtorsRes);

  // ---------------------------------------------------------------
  // TEST 8: Cross-location boundary — canteen staff cannot record a
  // payment against a restaurant-location order, even though customers
  // themselves aren't location-scoped. This is a confirmed product
  // decision (see docs/phases/phase11_context.md), not an oversight —
  // this test guards it from silently changing.
  // ---------------------------------------------------------------
  console.log("\n=== TEST 8: Cross-location payment recording is blocked ===");
  const crossLocationRes = await api(anneCookie, "POST", `/api/orders/${orderId}/payments`, {
    amount: 1,
  });
  check(
    "Canteen staff cannot record a payment against a restaurant order (404/unknown_order)",
    crossLocationRes.status === 404,
    crossLocationRes,
  );
  const paymentsAfterCrossLocation = await api(sarahCookie, "GET", `/api/orders/${orderId}/payments`);
  check(
    "Outstanding balance unchanged by the blocked cross-location attempt",
    paymentsAfterCrossLocation.body?.totalPaid === partialAmount,
    paymentsAfterCrossLocation.body,
  );

  // ---------------------------------------------------------------
  // TEST 9: Admin CAN record a payment against any location's order —
  // confirms the boundary is location-scoped for staff, not admin.
  // ---------------------------------------------------------------
  console.log("\n=== TEST 9: Admin can record a payment on any order ===");
  const adminPayRes = await api(adminCookie, "POST", `/api/orders/${orderId}/payments`, {
    amount: expectedTotal - partialAmount,
    note: `${MARKER} admin settles the balance`,
  });
  check("Admin's payment (settling the remaining balance) succeeds", adminPayRes.status === 201, adminPayRes);
  const finalPayments = await api(sarahCookie, "GET", `/api/orders/${orderId}/payments`);
  check("Order is now fully paid (outstanding = 0)", finalPayments.body?.outstanding === 0, finalPayments.body);

  // ---------------------------------------------------------------
  // TEST 10: Dashboard summary's outstandingTotal reflects reality.
  // Order created above is now fully paid (Test 9), so it should no
  // longer contribute — create one more, deliberately left unpaid, and
  // confirm outstandingTotal includes exactly its balance.
  // ---------------------------------------------------------------
  console.log("\n=== TEST 10: Dashboard outstandingTotal reflects a real unpaid balance ===");
  const secondOrderRes = await api(sarahCookie, "POST", "/api/orders", {
    customer_name: customerName,
    customer_id: customerId,
    fulfillment_type: "counter",
    delivery_location_id: null,
    items: [{ item_id: restaurantItem.id, quantity: 1 }],
    client_request_id: randomUUID(),
  });
  check("Second (deliberately unpaid) order created", secondOrderRes.status === 201, secondOrderRes);

  const summaryBefore = await api(adminCookie, "GET", "/api/dashboard/summary?period=today");
  const outstandingBefore = summaryBefore.body?.outstandingTotal;
  check(
    `Dashboard outstandingTotal includes the second order's unpaid ${secondOrderRes.body?.order?.total_amount}`,
    typeof outstandingBefore === "number" && outstandingBefore >= secondOrderRes.body?.order?.total_amount,
    { outstandingBefore, secondOrderTotal: secondOrderRes.body?.order?.total_amount },
  );

  await cleanup();
  summarizeAndExit("Phase 11");
}

main().catch((err) => {
  console.error("Test harness crashed:", err);
  process.exit(1);
});
