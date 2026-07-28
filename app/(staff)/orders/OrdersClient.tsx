"use client";

import { useEffect, useMemo, useState } from "react";
import { CategoryChips } from "@/components/CategoryChips";
import { Input } from "@/components/Input";
import { Select } from "@/components/Select";
import { SearchBar } from "@/components/SearchBar";
import { Stepper } from "@/components/Stepper";
import { TillStrip } from "@/components/TillStrip";
import { Toast } from "@/components/Toast";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { InfoTooltip } from "@/components/InfoTooltip";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { nairobiToday, orderTotal } from "@/lib/calculations";
import { useTillStripSlot } from "@/app/(staff)/TillStripSlot";
import type { Database } from "@/lib/supabase/types";
import styles from "./orders.module.css";

type Item = Database["public"]["Tables"]["items"]["Row"];
type DeliveryLocation = Database["public"]["Tables"]["delivery_locations"]["Row"];
type OrderItemRow = Database["public"]["Tables"]["order_items"]["Row"];
type OrderRow = Database["public"]["Tables"]["orders"]["Row"] & { order_items: OrderItemRow[] };
type StockEntryRow = Database["public"]["Tables"]["stock_entries"]["Row"];
type FulfillmentType = Database["public"]["Enums"]["order_fulfillment_type"];
// Phase 11 (docs/01_DATA_MODEL.md §6) — lightweight customer catalog,
// not a login/account system. Read from the same GET /api/orders
// response as everything else on this screen.
type Customer = Database["public"]["Tables"]["customers"]["Row"];

// Client feedback, 2026-07-28 — "allow staff to record debtor
// payments." Mirrors DebtorsClient.tsx's shapes (admin screen), scoped
// here to the caller's own location via GET /api/orders/debtors
// instead of the admin-only GET /api/admin/debtors.
interface Debtor {
  customer_id: string;
  customer_name: string;
  customer_phone: string | null;
  total_amount: number;
  total_paid: number;
  outstanding: number;
  order_count: number;
  oldest_unpaid_date: string;
}

interface DebtorOrderRow {
  id: string;
  location: "restaurant" | "canteen";
  order_date: string;
  customer_name: string;
  fulfillment_type: "delivery" | "pickup" | "counter";
  total_amount: number;
  created_at: string;
}

interface PaymentRow {
  id: string;
  order_id: string;
  amount: number;
  paid_at: string;
  note: string | null;
}

function money(value: number): string {
  return `KES ${Math.round(value).toLocaleString("en-KE")}`;
}

function todayISO(): string {
  return nairobiToday();
}

/**
 * Order entry screen — a POS/checkout (receipt) specialist lens, per
 * CLAUDE.md's "Building a real screen" protocol: distinct from Phase 4's
 * sweep-through-a-fixed-sheet lens and Phase 5's periodic-reconciliation
 * lens, because the interaction here is building up a single transaction
 * (customer -> fulfillment -> cart of line items -> total), closer to
 * ringing up a till receipt than filling in a pre-populated row per item.
 */
export function OrdersClient() {
  const today = useMemo(() => todayISO(), []);

  // "Log order" (the existing screen) vs. "Debtors" (client feedback,
  // 2026-07-28) — a tab on the same screen rather than a new route/nav
  // item, since most debtors are from past orders, not today's, and
  // this avoids adding a permanent slot to the 3-4 item mobile bottom
  // nav for a lookup staff won't need every visit.
  const [view, setView] = useState<"log" | "debtors">("log");

  const [items, setItems] = useState<Item[]>([]);
  const [deliveryLocations, setDeliveryLocations] = useState<DeliveryLocation[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [stockEntries, setStockEntries] = useState<StockEntryRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  // Debtors tab state — mirrors DebtorsClient.tsx (admin screen), minus
  // the period toggle and the admin-only "Delete order"/"Delete
  // payment" actions (Phase 11 scoped whole-order delete to
  // requireAdmin(); staff only get lookup + record-payment here).
  const [debtors, setDebtors] = useState<Debtor[]>([]);
  const [debtorsLoading, setDebtorsLoading] = useState(false);
  const [debtorsLoaded, setDebtorsLoaded] = useState(false);
  const [debtorsError, setDebtorsError] = useState<string | null>(null);
  const [selectedDebtor, setSelectedDebtor] = useState<Debtor | null>(null);
  const [debtorOrders, setDebtorOrders] = useState<DebtorOrderRow[]>([]);
  const [debtorOrdersLoading, setDebtorOrdersLoading] = useState(false);
  const [orderPayments, setOrderPayments] = useState<
    Record<string, { totalPaid: number; outstanding: number; payments: PaymentRow[] }>
  >({});
  const [paymentOrderId, setPaymentOrderId] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [recordingPayment, setRecordingPayment] = useState(false);

  const [customerName, setCustomerName] = useState("");
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>("pickup");
  const [deliveryLocationId, setDeliveryLocationId] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [clientRequestId, setClientRequestId] = useState(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ message: string; status: "success" | "error" } | null>(null);

  // Phase 11 (docs/01_DATA_MODEL.md §6) -- credit sale state. "" means
  // no customer picked (a normal cash order, unchanged from before this
  // phase); a real id means the order will carry customer_id. isCredit
  // is UI-only -- it doesn't change what's submitted beyond selecting
  // 'counter' as the fulfillment type for a walk-in credit sale (a
  // delivery/pickup order can ALSO be marked credit without changing
  // its fulfillment_type -- credit is about payment timing, not how
  // the order is fulfilled). "Paid now" vs "On credit" only changes
  // whether the UI nudges the cashier to also record a payment
  // immediately after saving -- see handleSave's isCredit branch below.
  const [customerId, setCustomerId] = useState("");
  const [isCredit, setIsCredit] = useState(false);
  const [newCustomerModalOpen, setNewCustomerModalOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const res = await fetch(`/api/orders?date=${today}`);
      const body = await res.json();
      if (cancelled) return;

      if (!res.ok) {
        setToast({ message: body.error ?? "Couldn't load orders", status: "error" });
        setLoading(false);
        return;
      }

      setItems(body.items ?? []);
      setDeliveryLocations(body.deliveryLocations ?? []);
      setOrders(body.orders ?? []);
      setStockEntries(body.stockEntries ?? []);
      setCustomers(body.customers ?? []);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [today]);

  // Debtors list loads lazily on first switch to that tab, not
  // up-front alongside today's orders — a cashier who never opens the
  // tab shouldn't pay for the extra round trip on every /orders visit.
  useEffect(() => {
    if (view !== "debtors" || debtorsLoaded) return;
    let cancelled = false;

    async function loadDebtors() {
      setDebtorsLoading(true);
      setDebtorsError(null);
      try {
        const res = await fetch("/api/orders/debtors");
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setDebtorsError(body.error ?? "Couldn't load debtors");
          return;
        }
        setDebtors(body.debtors ?? []);
        setDebtorsLoaded(true);
      } catch {
        if (!cancelled) setDebtorsError("Couldn't reach the server — check your connection and try again.");
      } finally {
        if (!cancelled) setDebtorsLoading(false);
      }
    }

    loadDebtors();
    return () => {
      cancelled = true;
    };
  }, [view, debtorsLoaded]);

  async function refreshDebtors() {
    try {
      const res = await fetch("/api/orders/debtors");
      const body = await res.json().catch(() => ({}));
      if (res.ok) setDebtors(body.debtors ?? []);
    } catch {
      // Silent — the visible toast from the triggering action already
      // told the cashier what happened; a background refresh failing
      // isn't itself worth a second error message.
    }
  }

  async function openDebtor(debtor: Debtor) {
    setSelectedDebtor(debtor);
    await fetchDebtorOrders(debtor.customer_id);
  }

  async function fetchDebtorOrders(customerId: string) {
    setDebtorOrdersLoading(true);
    try {
      const res = await fetch(`/api/orders/debtors/${customerId}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast({ message: json.error ?? "Couldn't load this customer's orders", status: "error" });
        setDebtorOrders([]);
        return;
      }
      const debtorOrdersData = (json.orders ?? []) as DebtorOrderRow[];
      setDebtorOrders(debtorOrdersData);

      const paymentEntries = await Promise.all(
        debtorOrdersData.map(async (order) => {
          const paymentsRes = await fetch(`/api/orders/${order.id}/payments`);
          const paymentsJson = await paymentsRes.json().catch(() => ({}));
          return [
            order.id,
            {
              totalPaid: paymentsJson.totalPaid ?? 0,
              outstanding: paymentsJson.outstanding ?? order.total_amount,
              payments: paymentsJson.payments ?? [],
            },
          ] as const;
        }),
      );
      setOrderPayments(Object.fromEntries(paymentEntries));
    } catch {
      setToast({ message: "Couldn't reach the server — check your connection and try again.", status: "error" });
    } finally {
      setDebtorOrdersLoading(false);
    }
  }

  function closeDebtor() {
    setSelectedDebtor(null);
    setDebtorOrders([]);
    setOrderPayments({});
  }

  function openPaymentForm(orderId: string) {
    setPaymentOrderId(orderId);
    setPaymentAmount("");
    setPaymentNote("");
  }

  async function handleRecordPayment() {
    if (!paymentOrderId) return;
    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setToast({ message: "Enter a valid amount", status: "error" });
      return;
    }

    setRecordingPayment(true);
    try {
      const res = await fetch(`/api/orders/${paymentOrderId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, note: paymentNote.trim() || null }),
      });
      const body = await res.json();

      if (!res.ok) {
        setToast({ message: body.error ?? "Couldn't record payment", status: "error" });
        return;
      }

      setToast({ message: "Payment recorded", status: "success" });
      setPaymentOrderId(null);

      // A payment can fully clear an order (or the whole customer, if
      // it was their only outstanding order), so both the drill-in and
      // the overall list need to reflect the new state.
      if (selectedDebtor) await fetchDebtorOrders(selectedDebtor.customer_id);
      await refreshDebtors();
    } catch {
      setToast({ message: "Couldn't reach the server — check your connection and try again.", status: "error" });
    } finally {
      setRecordingPayment(false);
    }
  }

  const visibleItems = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => item.name.toLowerCase().includes(term));
  }, [items, searchTerm]);

  const cartLines = useMemo(
    () =>
      Object.entries(cart)
        .filter(([, quantity]) => quantity > 0)
        .map(([itemId, quantity]) => {
          const item = items.find((i) => i.id === itemId);
          return item ? { item, quantity } : null;
        })
        .filter((line): line is { item: Item; quantity: number } => line !== null),
    [cart, items],
  );

  /**
   * The stepper's ceiling for this item: how much stock is available
   * before THIS order's own (not-yet-saved) quantity for the item is
   * counted -- i.e. total_stock - sent_out - wastage - the row's
   * already-committed quantity_sold (till + any other saved orders).
   * Mirrors Entry's remainingStockFor (§3), so the stepper visually
   * prevents oversell before it's attempted, same as the daily entry
   * screen (docs/design/02_PATTERNS_AND_CHECKLIST.md §6). The server's
   * oversell re-check in apply_order_to_stock_entry() (§3.4) remains the
   * actual enforcement -- this is a UX cap on top of it, not a
   * replacement, so a stale/unrefreshed figure can never let an
   * oversell actually persist.
   */
  function remainingStockFor(itemId: string): number | undefined {
    const row = stockEntries.find((e) => e.item_id === itemId);
    if (!row) return undefined; // no row yet -- opening_stock/oversell math happens server-side on first save
    const totalStock = row.opening_stock + row.added_stock;
    return totalStock - row.sent_out - row.quantity_sold - row.wastage;
  }

  const selectedZone = deliveryLocations.find((z) => z.id === deliveryLocationId);
  const deliveryFee = fulfillmentType === "delivery" ? (selectedZone?.fee ?? 0) : 0;

  const cartItemCount = cartLines.reduce((sum, line) => sum + line.quantity, 0);
  const total = orderTotal({
    items: cartLines.map((line) => ({ quantity: line.quantity, sellingPriceSnapshot: line.item.selling_price })),
    deliveryFeeSnapshot: deliveryFee,
  });

  // A credit sale needs a real customer on file (there has to be
  // someone to collect the debt from later) -- a plain cash order
  // still only needs the free-text name, same as before this phase.
  const canSave =
    !submitting &&
    customerName.trim().length > 0 &&
    cartLines.length > 0 &&
    (fulfillmentType === "pickup" || fulfillmentType === "counter" || deliveryLocationId.length > 0) &&
    (!isCredit || customerId.length > 0);

  function updateCartQuantity(itemId: string, quantity: number) {
    setCart((prev) => ({ ...prev, [itemId]: quantity }));
  }

  function resetForm() {
    setCustomerName("");
    setFulfillmentType("pickup");
    setDeliveryLocationId("");
    setCart({});
    setSearchTerm("");
    setClientRequestId(crypto.randomUUID());
    setCustomerId("");
    setIsCredit(false);
  }

  async function handleSave() {
    if (!canSave) return;
    setSubmitting(true);

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: customerName.trim(),
          fulfillment_type: fulfillmentType,
          delivery_location_id: fulfillmentType === "delivery" ? deliveryLocationId : null,
          items: cartLines.map((line) => ({ item_id: line.item.id, quantity: line.quantity })),
          client_request_id: clientRequestId,
          customer_id: customerId || null,
        }),
      });
      const body = await res.json();

      if (!res.ok) {
        setToast({ message: body.error ?? "Couldn't save the order", status: "error" });
        return;
      }

      setOrders((prev) => [body.order as OrderRow, ...prev]);
      setToast({
        message: isCredit ? "Order saved — logged on credit" : "Order saved",
        status: "success",
      });
      resetForm();
    } catch {
      setToast({ message: "Couldn't reach the server — check your connection and try again.", status: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Inline "+ New customer" (Phase 11) -- lets a cashier register a
   * new credit customer without leaving the order form, mirroring how
   * PurchaseModal's inline "+ Add new ingredient" already avoids
   * sending staff to a separate admin screen mid-task
   * (docs/01_DATA_MODEL.md §3.2). Created customer is immediately
   * selected so the cashier doesn't have to find it again in the list.
   */
  async function handleCreateCustomer() {
    if (!newCustomerName.trim()) return;
    setCreatingCustomer(true);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newCustomerName.trim(),
          phone: newCustomerPhone.trim() || null,
        }),
      });
      const body = await res.json();

      if (!res.ok) {
        setToast({ message: body.error ?? "Couldn't add customer", status: "error" });
        return;
      }

      const customer = body.customer as Customer;
      setCustomers((prev) => [...prev, customer].sort((a, b) => a.name.localeCompare(b.name)));
      setCustomerId(customer.id);
      setCustomerName(customer.name);
      setNewCustomerModalOpen(false);
      setNewCustomerName("");
      setNewCustomerPhone("");
      setToast({ message: "Customer added", status: "success" });
    } catch {
      setToast({ message: "Couldn't reach the server — check your connection and try again.", status: "error" });
    } finally {
      setCreatingCustomer(false);
    }
  }

  function handlePickCustomer(id: string) {
    setCustomerId(id);
    const customer = customers.find((c) => c.id === id);
    if (customer) setCustomerName(customer.name);
  }

  // Only shown on the "Log order" tab -- a running cart total makes no
  // sense while browsing debtors.
  useTillStripSlot(
    !loading && view === "log" ? (
      <TillStrip
        itemCount={cartItemCount}
        totalValueLabel={`KES ${total.toFixed(2)}`}
        onSave={handleSave}
        saveLabel="Save order"
        saving={submitting}
        disabled={!canSave}
      />
    ) : null,
    `${loading}:${view}:${cartItemCount}:${total}:${submitting}:${canSave}`,
  );

  if (loading) {
    return <p className={styles.loading}>Loading orders…</p>;
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="orders" size={48} />}
        heading="No items yet"
        body="Ask an admin to add sellable items before you can log an order."
      />
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Orders</h1>
        <p className={styles.dateLabel}>{today}</p>
      </div>

      <CategoryChips
        options={[
          { value: "log", label: "Log order" },
          { value: "debtors", label: "Debtors" },
        ]}
        value={view}
        onChange={(value) => setView(value as "log" | "debtors")}
      />

      {view === "debtors" ? (
        <div className={styles.debtorsView}>
          {debtorsError && <p className={styles.debtorsError}>{debtorsError}</p>}

          {debtorsLoading && !debtorsLoaded ? (
            <p className={styles.loading}>Loading debtors…</p>
          ) : debtors.length === 0 ? (
            <EmptyState
              icon={<Icon name="expenses" size={48} />}
              heading="No outstanding balances"
              body="Once a counter, delivery, or pickup order is logged on credit at this location, it'll show up here until it's paid off."
            />
          ) : (
            <ul className={styles.debtorList}>
              {debtors.map((debtor) => (
                <li key={debtor.customer_id} className={styles.debtorRow}>
                  <button
                    type="button"
                    className={styles.debtorRowButton}
                    onClick={() => openDebtor(debtor)}
                  >
                    <span className={styles.debtorIdentity}>
                      <span className={styles.debtorName}>{debtor.customer_name}</span>
                      <span className={styles.debtorMeta}>
                        {debtor.order_count} order{debtor.order_count === 1 ? "" : "s"} · Since{" "}
                        {debtor.oldest_unpaid_date}
                      </span>
                    </span>
                    <span className={styles.debtorOutstanding}>{money(debtor.outstanding)}</span>
                    <Icon name="chevron-right" size={20} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
      <div className={styles.form}>
        <Input
          label="Customer name"
          value={customerName}
          onChange={(e) => {
            setCustomerName(e.target.value);
            // Typing a fresh name after picking an existing customer
            // means they've moved on from that selection -- don't
            // silently keep submitting the old customer_id against a
            // now-different-looking name.
            if (customerId) setCustomerId("");
          }}
          placeholder="e.g. Mary Wambui"
        />

        {/* Phase 11 (docs/01_DATA_MODEL.md §6) -- pick an existing
            customer record (or add a new one inline) so the order can
            carry customer_id, which credit tracking needs. Purely
            additive to the free-text name above -- picking a customer
            here also fills the name field for convenience, but typing
            a name alone (no pick) still works exactly as before this
            phase for a normal cash order. */}
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Customer on file (optional for cash, required for credit)</span>
          <div className={styles.zoneRow}>
            <Select
              placeholder="No customer selected"
              value={customerId}
              onChange={(e) => handlePickCustomer(e.target.value)}
              options={customers.map((c) => ({ value: c.id, label: c.phone ? `${c.name} (${c.phone})` : c.name }))}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setNewCustomerName(customerName.trim());
                setNewCustomerModalOpen(true);
              }}
            >
              + New customer
            </Button>
          </div>
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>
            Payment
            <InfoTooltip
              label="Payment"
              message="On credit logs this sale immediately (stock and profit are unaffected) but tracks it as owed until a payment is recorded against it — use the Debtors tab above to record one."
            />
          </span>
          <CategoryChips
            options={[
              { value: "paid", label: "Paid now" },
              { value: "credit", label: "On credit" },
            ]}
            value={isCredit ? "credit" : "paid"}
            onChange={(value) => {
              const credit = value === "credit";
              setIsCredit(credit);
              // A credit sale with no delivery/pickup context defaults
              // to the new 'counter' fulfillment type (a walk-in
              // named-customer sale) -- switching back to "Paid now"
              // returns to the original pickup default rather than
              // leaving 'counter' selected for a plain cash order.
              if (credit && fulfillmentType !== "delivery") setFulfillmentType("counter");
              if (!credit && fulfillmentType === "counter") setFulfillmentType("pickup");
            }}
          />
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Fulfillment</span>
          <CategoryChips
            options={[
              { value: "pickup", label: "Pickup" },
              { value: "delivery", label: "Delivery" },
              { value: "counter", label: "Counter" },
            ]}
            value={fulfillmentType}
            onChange={(value) => setFulfillmentType(value as FulfillmentType)}
          />
        </div>

        {fulfillmentType === "delivery" && (
          <div className={styles.zoneRow}>
            <Select
              label="Delivery zone"
              placeholder="Select a zone"
              value={deliveryLocationId}
              onChange={(e) => setDeliveryLocationId(e.target.value)}
              options={deliveryLocations.map((zone) => ({ value: zone.id, label: zone.name }))}
            />
            <Input
              label="Fee (KES)"
              labelExtra={
                <InfoTooltip
                  label="Delivery fee"
                  message="Set by admin for this zone. You can't change it here."
                />
              }
              value={selectedZone ? selectedZone.fee.toFixed(2) : ""}
              readOnly
              disabled
            />
          </div>
        )}
      </div>

      <div className={styles.field}>
        <span className={styles.fieldLabel}>Items</span>
        <SearchBar value={searchTerm} onChange={setSearchTerm} placeholder="Search items to add…" />
      </div>

      {visibleItems.length === 0 && (
        <p className={styles.noResults}>No items match &ldquo;{searchTerm}&rdquo;.</p>
      )}

      <ul className={styles.itemList}>
        {visibleItems.map((item) => {
          const quantity = cart[item.id] ?? 0;
          const remaining = remainingStockFor(item.id);
          return (
            <li key={item.id} className={styles.itemRow}>
              <div>
                <p className={styles.itemName}>{item.name}</p>
                <p className={styles.itemMeta}>
                  KES {item.selling_price.toFixed(2)}
                  {remaining !== undefined && ` · Available: ${remaining}`}
                </p>
              </div>
              <Stepper
                value={quantity}
                onChange={(next) => updateCartQuantity(item.id, next)}
                max={remaining}
                limitMessage={remaining !== undefined ? `Only ${remaining} left` : undefined}
                aria-label={`${item.name} quantity`}
              />
            </li>
          );
        })}
      </ul>

      {cartLines.length > 0 && (
        <div className={styles.receiptPreview}>
          <p className={styles.listTitle}>Order summary</p>
          <ul className={styles.receiptLines}>
            {cartLines.map((line) => (
              <li key={line.item.id} className={styles.receiptLine}>
                <span>
                  {line.quantity} × {line.item.name}
                </span>
                <span>KES {(line.quantity * line.item.selling_price).toFixed(2)}</span>
              </li>
            ))}
            {fulfillmentType === "delivery" && deliveryFee > 0 && (
              <li className={styles.receiptLine}>
                <span>Delivery fee</span>
                <span>KES {deliveryFee.toFixed(2)}</span>
              </li>
            )}
          </ul>
        </div>
      )}

      <div className={styles.listSection}>
        <div className={styles.listHeader}>
          <h2 className={styles.listTitle}>Today&apos;s orders</h2>
          {orders.length > 0 && (
            <span className={styles.listTotal}>
              KES {orders.reduce((sum, order) => sum + order.total_amount, 0).toFixed(2)}
            </span>
          )}
        </div>

        {orders.length === 0 ? (
          <EmptyState
            icon={<Icon name="orders" size={48} />}
            heading="No orders logged yet"
            body="Delivery, pickup and counter orders you log today will show up here."
          />
        ) : (
          <ul className={styles.orderList}>
            {orders.map((order) => (
              <li key={order.id} className={styles.orderRow}>
                <div className={styles.orderRowHeader}>
                  <p className={styles.orderCustomer}>{order.customer_name}</p>
                  <span className={styles.orderAmount}>KES {order.total_amount.toFixed(2)}</span>
                </div>
                <p className={styles.orderMeta}>
                  {order.fulfillment_type === "delivery"
                    ? "Delivery"
                    : order.fulfillment_type === "counter"
                      ? "Counter"
                      : "Pickup"}{" "}
                  · {order.order_items.length} {order.order_items.length === 1 ? "item" : "items"}
                  {/* customer_id (Phase 11) is the signal this order may
                      be a credit sale -- there's no dedicated flag, so
                      this reads as "has a customer on file," which is
                      the closest today's-orders list needs to get.
                      The Debtors tab (and the admin debtors screen) is
                      where what's actually still owed gets resolved. */}
                  {order.customer_id && (
                    <>
                      {" "}
                      · <span className={styles.creditBadge}>Customer on file</span>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        open={newCustomerModalOpen}
        onClose={() => setNewCustomerModalOpen(false)}
        title="New customer"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setNewCustomerModalOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCreateCustomer}
              disabled={creatingCustomer || !newCustomerName.trim()}
            >
              {creatingCustomer ? "Adding…" : "Add customer"}
            </Button>
          </>
        }
      >
        <div className={styles.form}>
          <Input
            label="Name"
            value={newCustomerName}
            onChange={(e) => setNewCustomerName(e.target.value)}
            placeholder="e.g. Mary Wambui"
          />
          <Input
            label="Phone (optional)"
            value={newCustomerPhone}
            onChange={(e) => setNewCustomerPhone(e.target.value)}
            placeholder="e.g. 0712 345 678"
          />
        </div>
      </Modal>
        </>
      )}

      {/* Debtor drill-in + record-payment modals -- shared by the
          Debtors tab regardless of which tab is currently active, same
          as DebtorsClient.tsx's own modal pair (admin screen). Modal's
          own `open` prop gates visibility, so these are inert when
          view === "log". No delete affordances here (Phase 11 scoped
          whole-order/payment delete to admin only) -- lookup + record
          payment is the full staff-facing scope for this feature. */}
      <Modal
        open={selectedDebtor !== null}
        onClose={closeDebtor}
        title={selectedDebtor ? `${selectedDebtor.customer_name} — outstanding orders` : "Debtor"}
      >
        {selectedDebtor && (
          <div className={styles.debtorDetail}>
            {debtorOrdersLoading ? (
              <p className={styles.loading}>Loading…</p>
            ) : debtorOrders.length === 0 ? (
              <p className={styles.debtorMeta}>No outstanding orders for this customer.</p>
            ) : (
              <ul className={styles.debtorOrderList}>
                {debtorOrders.map((order) => {
                  const figures = orderPayments[order.id];
                  const outstanding = figures?.outstanding ?? order.total_amount;
                  if (outstanding <= 0) return null;
                  return (
                    <li key={order.id} className={styles.debtorOrderRow}>
                      <div className={styles.orderRowHeader}>
                        <span>
                          {order.order_date} ·{" "}
                          {order.fulfillment_type === "delivery"
                            ? "Delivery"
                            : order.fulfillment_type === "counter"
                              ? "Counter"
                              : "Pickup"}
                        </span>
                        <span className={styles.orderAmount}>{money(order.total_amount)}</span>
                      </div>
                      <div className={styles.debtorOrderFooter}>
                        <span className={styles.debtorOutstanding}>
                          {money(outstanding)} outstanding
                          {figures && figures.totalPaid > 0 && ` (${money(figures.totalPaid)} paid)`}
                        </span>
                        <Button type="button" variant="secondary" onClick={() => openPaymentForm(order.id)}>
                          Record payment
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={paymentOrderId !== null}
        onClose={() => setPaymentOrderId(null)}
        title="Record payment"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setPaymentOrderId(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleRecordPayment} disabled={recordingPayment}>
              {recordingPayment ? "Saving…" : "Save payment"}
            </Button>
          </>
        }
      >
        <div className={styles.form}>
          {paymentOrderId && orderPayments[paymentOrderId] && (
            <p className={styles.debtorMeta}>
              {money(orderPayments[paymentOrderId].outstanding)} still outstanding on this order.
            </p>
          )}
          <Input
            label="Amount (KES)"
            type="number"
            min="0"
            step="0.01"
            value={paymentAmount}
            onChange={(e) => setPaymentAmount(e.target.value)}
            placeholder="e.g. 500"
          />
          <Input
            label="Note (optional)"
            value={paymentNote}
            onChange={(e) => setPaymentNote(e.target.value)}
            placeholder="e.g. Paid at till"
          />
        </div>
      </Modal>

      {toast && <Toast message={toast.message} status={toast.status} onDismiss={() => setToast(null)} />}
    </div>
  );
}
