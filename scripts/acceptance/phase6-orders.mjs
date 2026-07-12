#!/usr/bin/env node
/**
 * Phase 6 acceptance checks — Delivery Orders
 * (docs/phases/phase6_context.md's mandatory acceptance criteria,
 * reconstructed here as a real repeatable script instead of only living
 * as prose in that context file).
 *
 * Covers the two MANDATORY tests from 04_PHASE_PLAN.md's Phase 6 spec
 * (concurrency, duplicate-submission), plus the "obvious but untested"
 * scenarios: two separate same-day orders from the same customer not
 * deduped, zero-item order rejected, wrong-location item rejected, an
 * order as the first write of the day for an item (no prior till entry),
 * a canteen order correctly folding into the existing weekly
 * stock_entries row (not creating a stray daily one), delivery fee/total
 * correctness, and cross-location RLS.
 *
 * Prerequisites: local Supabase stack running (`npx supabase status`)
 * and the dev server running (`pnpm dev`). Mutates real local data but
 * cleans up everything it creates before exiting — safe to re-run anytime.
 *
 * Usage: node scripts/acceptance/phase6-orders.mjs
 */

import { api, check, findItemByName, login, psql, psqlAsUser, summarizeAndExit } from "./_lib.mjs";

const today = new Date().toISOString().slice(0, 10);

// Every order this script creates uses this customer-name prefix, so
// cleanup can target exactly (and only) this run's own data rather than
// a blanket wipe of orders/order_items that could eat real dev data.
const MARKER = "[acceptance-test]";

async function cleanup() {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const priorWeekMonday = psql(`select (date_trunc('week', '${today}'::date) - interval '7 days')::date::text;`);
  psql(`delete from order_items where order_id in (select id from orders where customer_name like '${MARKER}%');`);
  psql(`delete from orders where customer_name like '${MARKER}%';`);
  psql(`delete from stock_entries where location = 'restaurant' and entry_date in ('${today}', '${yesterday}');`);
  psql(`delete from stock_entries where location = 'canteen' and entry_date = date_trunc('week', '${today}'::date)::date;`);
  psql(`delete from stock_entries where location = 'canteen' and entry_date = '${priorWeekMonday}';`);
}

async function main() {
  await cleanup();

  const sarahCookie = await login("sarah"); // restaurant
  const anneCookie = await login("anne"); // canteen

  const sarahOrders = await api(sarahCookie, "GET", `/api/orders?date=${today}`);
  check("Sarah's GET /api/orders succeeds", sarahOrders.status === 200, sarahOrders);
  const restaurantItem = findItemByName(sarahOrders.body.items, "Samosa");

  // ---------------------------------------------------------------
  // TEST 1 (MANDATORY): Concurrency — a till sale and a delivery order
  // for the same item/location/day, fired close together, must both
  // land in quantity_sold, neither clobbering the other.
  // ---------------------------------------------------------------
  console.log("\n=== TEST 1 (MANDATORY): Concurrency — till sale + order racing ===");
  const tillQty = 3;
  const orderQty = 2;

  const [tillRes, orderRes] = await Promise.all([
    api(sarahCookie, "POST", "/api/stock-entries", {
      entry_date: today,
      lines: [
        {
          item_id: restaurantItem.id,
          till_quantity_sold: tillQty,
          added_stock: 20,
          sent_out: 0,
          wastage: 0,
          wastage_note: null,
        },
      ],
    }),
    api(sarahCookie, "POST", "/api/orders", {
      customer_name: `${MARKER} Concurrency Customer`,
      fulfillment_type: "pickup",
      delivery_location_id: null,
      items: [{ item_id: restaurantItem.id, quantity: orderQty }],
      client_request_id: crypto.randomUUID(),
    }),
  ]);
  check("Concurrent till save succeeded", tillRes.status === 200, tillRes);
  check("Concurrent order save succeeded", orderRes.status === 201, orderRes);

  const afterConcurrency = await api(sarahCookie, "GET", `/api/stock-entries?date=${today}`);
  const rowAfter = afterConcurrency.body.entries.find((e) => e.item_id === restaurantItem.id);
  check(
    `quantity_sold reflects BOTH writes (till=${tillQty} + order=${orderQty} = ${tillQty + orderQty})`,
    rowAfter?.quantity_sold === tillQty + orderQty,
    rowAfter,
  );
  check("till_quantity_sold preserved exactly (order never touched it)", rowAfter?.till_quantity_sold === tillQty, rowAfter);

  // ---------------------------------------------------------------
  // TEST 2 (MANDATORY): Duplicate submission — retry with the same
  // client_request_id, confirm no duplicate order or double deduction.
  // ---------------------------------------------------------------
  console.log("\n=== TEST 2 (MANDATORY): Duplicate-submission protection ===");
  const dupRequestId = crypto.randomUUID();
  const dupPayload = {
    customer_name: `${MARKER} Duplicate Customer`,
    fulfillment_type: "pickup",
    delivery_location_id: null,
    items: [{ item_id: restaurantItem.id, quantity: 1 }],
    client_request_id: dupRequestId,
  };
  const first = await api(sarahCookie, "POST", "/api/orders", dupPayload);
  check("First submit succeeds", first.status === 201, first);
  const retry1 = await api(sarahCookie, "POST", "/api/orders", dupPayload);
  const retry2 = await api(sarahCookie, "POST", "/api/orders", dupPayload);
  check("Retry 1 returns the SAME order id as the first submit", retry1.body?.order?.id === first.body?.order?.id, {
    first: first.body?.order?.id,
    retry1: retry1.body?.order?.id,
  });
  check("Retry 2 also returns the same order id", retry2.body?.order?.id === first.body?.order?.id, {
    first: first.body?.order?.id,
    retry2: retry2.body?.order?.id,
  });

  const afterDup = await api(sarahCookie, "GET", `/api/stock-entries?date=${today}`);
  const rowAfterDup = afterDup.body.entries.find((e) => e.item_id === restaurantItem.id);
  check(
    "Stock only deducted ONCE for the duplicate order, not 3x",
    rowAfterDup?.quantity_sold === tillQty + orderQty + 1,
    rowAfterDup,
  );

  // ---------------------------------------------------------------
  // TEST 3: Two separate same-day orders from the same customer are
  // NOT deduped by the idempotency key (different client_request_id).
  // ---------------------------------------------------------------
  console.log("\n=== TEST 3: Two separate same-day orders, same customer ===");
  const orderA = await api(sarahCookie, "POST", "/api/orders", {
    customer_name: `${MARKER} Repeat Customer`,
    fulfillment_type: "pickup",
    delivery_location_id: null,
    items: [{ item_id: restaurantItem.id, quantity: 1 }],
    client_request_id: crypto.randomUUID(),
  });
  const orderB = await api(sarahCookie, "POST", "/api/orders", {
    customer_name: `${MARKER} Repeat Customer`,
    fulfillment_type: "pickup",
    delivery_location_id: null,
    items: [{ item_id: restaurantItem.id, quantity: 1 }],
    client_request_id: crypto.randomUUID(),
  });
  check("Order A succeeds", orderA.status === 201, orderA);
  check("Order B succeeds", orderB.status === 201, orderB);
  check(
    "Two separate orders from the same customer get DIFFERENT ids (not merged/deduped)",
    orderA.body?.order?.id && orderB.body?.order?.id && orderA.body.order.id !== orderB.body.order.id,
    { a: orderA.body?.order?.id, b: orderB.body?.order?.id },
  );

  // ---------------------------------------------------------------
  // TEST 4: Zero-item order rejected
  // ---------------------------------------------------------------
  console.log("\n=== TEST 4: Zero-item order rejected ===");
  const zeroItemRes = await api(sarahCookie, "POST", "/api/orders", {
    customer_name: `${MARKER} Empty Order`,
    fulfillment_type: "pickup",
    delivery_location_id: null,
    items: [],
    client_request_id: crypto.randomUUID(),
  });
  check("Zero-item order rejected with 400", zeroItemRes.status === 400, zeroItemRes);

  // ---------------------------------------------------------------
  // TEST 5: Wrong-location item rejected — a canteen_independent item
  // (never sellable at restaurant) submitted on a restaurant order.
  // ---------------------------------------------------------------
  console.log("\n=== TEST 5: Wrong-location item rejected ===");
  const canteenStockRes = await api(anneCookie, "GET", `/api/stock-entries?date=${today}`);
  const canteenOnlyItem = canteenStockRes.body.items.find((i) => i.supply_type === "canteen_independent");
  const wrongLocationRes = await api(sarahCookie, "POST", "/api/orders", {
    customer_name: `${MARKER} Wrong Location Test`,
    fulfillment_type: "pickup",
    delivery_location_id: null,
    items: [{ item_id: canteenOnlyItem.id, quantity: 1 }],
    client_request_id: crypto.randomUUID(),
  });
  check(
    `canteen_independent item (${canteenOnlyItem.name}) rejected on a restaurant order`,
    wrongLocationRes.status === 400,
    wrongLocationRes,
  );

  // ---------------------------------------------------------------
  // TEST 6: An order as the FIRST write of the day for an item (no
  // prior till entry) — the scenario that requires apply_order_to_stock_entry()
  // to do a full upsert, not just an UPDATE.
  // ---------------------------------------------------------------
  console.log("\n=== TEST 6: Order as first write of the day (no prior till entry) ===");
  const secondItem = sarahOrders.body.items.find((i) => i.id !== restaurantItem.id && i.supply_type !== "canteen_independent");
  // Give this item real opening stock via a backdated fixture row (same
  // pattern as TEST 1) -- otherwise ordering against a brand-new item
  // with 0 opening/added stock legitimately 409s, which would prove
  // nothing about "order as first write" specifically.
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  psql(`
    insert into stock_entries (item_id, location, entry_date, opening_stock, added_stock, sent_out, till_quantity_sold, quantity_sold, wastage, selling_price_snapshot, buying_price_snapshot, closing_stock, sales_value, cost_value, closing_stock_value, wastage_value, created_by)
    values ('${secondItem.id}', 'restaurant', '${yesterday}', 0, 20, 0, 0, 0, 0, ${secondItem.selling_price}, ${secondItem.buying_price}, 20, 0, 0, ${20 * secondItem.buying_price}, 0, (select id from users where name='Sarah Makena'))
    on conflict (item_id, location, entry_date) do update set closing_stock = excluded.closing_stock;
  `);
  const firstWriteRes = await api(sarahCookie, "POST", "/api/orders", {
    customer_name: `${MARKER} First Write Test`,
    fulfillment_type: "pickup",
    delivery_location_id: null,
    items: [{ item_id: secondItem.id, quantity: 1 }],
    client_request_id: crypto.randomUUID(),
  });
  check("Order succeeds even with no existing stock_entries row for this item today", firstWriteRes.status === 201, firstWriteRes);
  const firstWriteStockRes = await api(sarahCookie, "GET", `/api/stock-entries?date=${today}`);
  const firstWriteRow = firstWriteStockRes.body.entries.find((e) => e.item_id === secondItem.id);
  check(
    "The order alone created a correct stock_entries row (quantity_sold=1, till_quantity_sold=0)",
    firstWriteRow?.quantity_sold === 1 && firstWriteRow?.till_quantity_sold === 0,
    firstWriteRow,
  );

  // ---------------------------------------------------------------
  // TEST 7: A canteen order folds into the existing WEEKLY stock_entries
  // row, not a stray daily one (the cadence bug found during Phase 6's
  // own live testing — see docs/phases/phase6_context.md).
  // ---------------------------------------------------------------
  console.log("\n=== TEST 7: Canteen order uses the weekly entry_date, not a stray daily row ===");
  const canteenIndependentItem = canteenStockRes.body.items.find((i) => i.supply_type === "canteen_independent");
  // Give this item real opening stock via a backdated PRIOR-WEEK fixture
  // row (mirrors phase5-canteen-expenses.mjs's carry-forward test) --
  // otherwise ordering against a brand-new canteen item with 0
  // opening/added stock legitimately 409s.
  const priorWeekMonday = psql(`select (date_trunc('week', '${today}'::date) - interval '7 days')::date::text;`);
  psql(`
    insert into stock_entries (item_id, location, entry_date, opening_stock, added_stock, sent_out, till_quantity_sold, quantity_sold, wastage, selling_price_snapshot, buying_price_snapshot, closing_stock, sales_value, cost_value, closing_stock_value, wastage_value, created_by)
    values ('${canteenIndependentItem.id}', 'canteen', '${priorWeekMonday}', 0, 20, 0, 0, 0, 0, ${canteenIndependentItem.selling_price}, ${canteenIndependentItem.buying_price}, 20, 0, 0, ${20 * canteenIndependentItem.buying_price}, 0, (select id from users where name='Anne Gitonga'))
    on conflict (item_id, location, entry_date) do update set closing_stock = excluded.closing_stock;
  `);
  const canteenOrderRes = await api(anneCookie, "POST", "/api/orders", {
    customer_name: `${MARKER} Canteen Order Test`,
    fulfillment_type: "pickup",
    delivery_location_id: null,
    items: [{ item_id: canteenIndependentItem.id, quantity: 1 }],
    client_request_id: crypto.randomUUID(),
  });
  check("Canteen order succeeds", canteenOrderRes.status === 201, canteenOrderRes);

  // Exactly TWO rows should exist for this item: the prior-week fixture
  // (opening stock source) and THIS week's row the order created --
  // never a stray extra row at today's literal daily date, which is
  // what the cadence bug (see comment above) used to produce.
  const canteenRowCount = psql(
    `select count(*) from stock_entries where location = 'canteen' and item_id = '${canteenIndependentItem.id}';`,
  );
  check(
    "Exactly TWO stock_entries rows exist for this canteen item (prior week + this week, no stray daily duplicate)",
    canteenRowCount === "2",
    canteenRowCount,
  );
  const canteenThisWeekRowDate = psql(
    `select entry_date::text from stock_entries where location = 'canteen' and item_id = '${canteenIndependentItem.id}' and entry_date > '${priorWeekMonday}';`,
  );
  check(
    "This week's row entry_date is the week's Monday, not today's literal date",
    canteenThisWeekRowDate === psql(`select date_trunc('week', '${today}'::date)::date::text;`),
    canteenThisWeekRowDate,
  );

  // ---------------------------------------------------------------
  // TEST 8: Delivery order fee/total correctness
  // ---------------------------------------------------------------
  console.log("\n=== TEST 8: Delivery order fee/total correctness ===");
  const zone = sarahOrders.body.deliveryLocations?.[0];
  if (!zone) {
    console.log("SKIP: no delivery zones in seed data");
  } else {
    const deliveryOrderRes = await api(sarahCookie, "POST", "/api/orders", {
      customer_name: `${MARKER} Delivery Test`,
      fulfillment_type: "delivery",
      delivery_location_id: zone.id,
      items: [{ item_id: restaurantItem.id, quantity: 2 }],
      client_request_id: crypto.randomUUID(),
    });
    check("Delivery order succeeds", deliveryOrderRes.status === 201, deliveryOrderRes);
    const expectedTotal = 2 * restaurantItem.selling_price + zone.fee;
    check(
      `Order total = items + delivery fee (expected ${expectedTotal})`,
      deliveryOrderRes.body?.order?.total_amount === expectedTotal,
      deliveryOrderRes.body?.order,
    );
    check(
      `delivery_fee_snapshot matches the zone's fee (${zone.fee})`,
      deliveryOrderRes.body?.order?.delivery_fee_snapshot === zone.fee,
      deliveryOrderRes.body?.order,
    );
  }

  // ---------------------------------------------------------------
  // TEST 9: Cross-location RLS — canteen staff cannot see restaurant's
  // orders, and vice versa is confirmed at the RLS-impersonation level.
  // ---------------------------------------------------------------
  console.log("\n=== TEST 9: Cross-location order scoping ===");
  const canteenOrdersRes = await api(anneCookie, "GET", `/api/orders?date=${today}`);
  const sawRestaurantOrder = (canteenOrdersRes.body.orders ?? []).some((o) => o.customer_name.startsWith(MARKER) && o.location === "restaurant");
  check("Canteen staff's order list does NOT include restaurant's orders", !sawRestaurantOrder, {
    canteenOrderCount: canteenOrdersRes.body.orders?.length,
  });

  const anneDirectRestaurantOrders = psqlAsUser("Anne Gitonga", `select count(*) from orders where location = 'restaurant';`);
  check(
    "RLS-impersonated as Anne: direct query for restaurant orders returns 0 rows",
    anneDirectRestaurantOrders === "0",
    anneDirectRestaurantOrders,
  );

  await cleanup();
  summarizeAndExit("Phase 6");
}

main().catch((err) => {
  console.error("Test harness crashed:", err);
  process.exit(1);
});
