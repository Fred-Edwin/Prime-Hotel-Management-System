"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { PeriodToggle } from "@/components/PeriodToggle";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { Input } from "@/components/Input";
import { Button } from "@/components/Button";
import { Toast } from "@/components/Toast";
import catalogStyles from "../../catalog.module.css";
import styles from "./debtors.module.css";

type Period = "today" | "week" | "month" | "";

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

interface OrderRow {
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

const PERIOD_OPTIONS = [
  { value: "", label: "All time" },
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

/**
 * Admin debtors screen (Phase 11) — outstanding balance per customer,
 * drill into their unpaid orders, record a payment. Reporting/
 * records-browsing lens, matching /dashboard/orders' established
 * table-first pattern (Phase 9 precedent) rather than inventing a new
 * layout — see page.tsx's doc comment.
 */
export function DebtorsClient() {
  const [period, setPeriod] = useState<Period>("");
  const [debtors, setDebtors] = useState<Debtor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; status: "success" | "error" } | null>(null);

  const [selectedDebtor, setSelectedDebtor] = useState<Debtor | null>(null);
  const [debtorOrders, setDebtorOrders] = useState<OrderRow[]>([]);
  const [debtorOrdersLoading, setDebtorOrdersLoading] = useState(false);
  const [orderPayments, setOrderPayments] = useState<Record<string, { totalPaid: number; outstanding: number; payments: PaymentRow[] }>>(
    {},
  );

  const [paymentOrderId, setPaymentOrderId] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [recordingPayment, setRecordingPayment] = useState(false);

  // Whole-order delete (client feedback, 2026-07-28 — distinct from
  // handleDeletePayment above, which only removes one payment). Gets a
  // confirm modal, unlike the payment delete, since removing the whole
  // debt/order is a heavier, harder-to-shrug-off action.
  const [deleteOrderTarget, setDeleteOrderTarget] = useState<OrderRow | null>(null);
  const [deleteOrderError, setDeleteOrderError] = useState<string | null>(null);
  const [deletingOrder, setDeletingOrder] = useState(false);

  // Shared loader, also called after recording a payment (a payment can
  // clear a debtor off the list entirely, so the list needs to refresh
  // outside the effect too, not just on period change). Defined once
  // here and invoked from a nested function inside the effect below,
  // per this codebase's standing "wrap a setState-before-fetch effect
  // in a nested function" convention (see OrdersClient.tsx's `load()`
  // for the same shape) so the lint rule against calling a
  // setState-bearing function directly in an effect body doesn't fire.
  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (period) params.set("period", period);
      const res = await fetch(`/api/admin/debtors?${params.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to load debtors");
      setDebtors(json.debtors ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load debtors");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (cancelled) return;
      await load();
    }

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  /**
   * Drill into one customer's outstanding orders. Admin sees both
   * locations (is_admin() bypasses orders_select_scoped's location
   * boundary, docs/01_DATA_MODEL.md §4) — a debtor isn't scoped to one
   * location any more than the customers catalog itself is.
   */
  async function openDebtor(debtor: Debtor) {
    setSelectedDebtor(debtor);
    await fetchDebtorOrders(debtor.customer_id);
  }

  async function fetchDebtorOrders(customerId: string) {
    setDebtorOrdersLoading(true);
    try {
      const res = await fetch(`/api/admin/debtors/${customerId}/orders`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast({ message: json.error ?? "Couldn't load this customer's orders", status: "error" });
        setDebtorOrders([]);
        return;
      }
      const orders = (json.orders ?? []) as OrderRow[];
      setDebtorOrders(orders);

      const paymentEntries = await Promise.all(
        orders.map(async (order) => {
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

  /**
   * Delete a mistakenly-recorded payment (client feedback, 2026-07-27:
   * "Delete options required under Debtors for admin" — the follow-up
   * flagged as a known gap in Phase 11, docs/phases/phase11_context.md's
   * "No payment reversal/refund route"). No confirm-modal step, matching
   * this screen's own existing "Record payment" flow, which also commits
   * immediately without one — the outstanding balance simply recomputes
   * (derived at read time, §6), same as after recording a payment.
   */
  async function handleDeletePayment(orderId: string, paymentId: string) {
    try {
      const res = await fetch(`/api/orders/${orderId}/payments/${paymentId}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setToast({ message: body.error ?? "Couldn't delete payment", status: "error" });
        return;
      }
      setToast({ message: "Payment deleted", status: "success" });
      if (selectedDebtor) await fetchDebtorOrders(selectedDebtor.customer_id);
      await load();
    } catch {
      setToast({ message: "Couldn't reach the server — check your connection and try again.", status: "error" });
    }
  }

  function openDeleteOrderConfirm(order: OrderRow) {
    setDeleteOrderTarget(order);
    setDeleteOrderError(null);
  }

  function closeDeleteOrderConfirm() {
    setDeleteOrderTarget(null);
    setDeleteOrderError(null);
  }

  /**
   * Delete the whole order/debt (client feedback, 2026-07-28: "Debtor's
   * delete was supposed to delete the debt. We currently just have
   * reverse payment" — handleDeletePayment above only removes one
   * payment; this removes the order itself, cascading its order_items
   * and order_payments too (docs/01_DATA_MODEL.md §2/§3.16). Confirmed
   * with the human: allowed even when payments already exist against
   * the order — the confirmation modal warns how much payment history
   * would be removed, this action doesn't block on it.
   */
  async function handleDeleteOrder() {
    if (!deleteOrderTarget) return;
    setDeletingOrder(true);
    setDeleteOrderError(null);
    try {
      const res = await fetch(`/api/orders/${deleteOrderTarget.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleteOrderError(body.error ?? "Couldn't delete order — please try again.");
        return;
      }
      setToast({ message: "Order deleted", status: "success" });
      setDeleteOrderTarget(null);
      if (selectedDebtor) await fetchDebtorOrders(selectedDebtor.customer_id);
      await load();
    } catch {
      setDeleteOrderError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setDeletingOrder(false);
    }
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

      // Refresh this debtor's order/payment figures and the overall list
      // -- a payment can fully clear an order (or the whole customer, if
      // it was their only outstanding order), so both views need to
      // reflect the new state, not just the one order just paid.
      if (selectedDebtor) await fetchDebtorOrders(selectedDebtor.customer_id);
      await load();
    } catch {
      setToast({ message: "Couldn't reach the server — check your connection and try again.", status: "error" });
    } finally {
      setRecordingPayment(false);
    }
  }

  const totalOutstanding = debtors.reduce((sum, d) => sum + d.outstanding, 0);

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={catalogStyles.title}>Debtors</h1>
          <Link href="/dashboard" className={styles.backLink}>
            ← Back to dashboard
          </Link>
        </div>
        <PeriodToggle
          options={PERIOD_OPTIONS}
          value={period}
          onChange={(v) => setPeriod(v as Period)}
        />
      </div>

      {error && <p className={catalogStyles.formError}>{error}</p>}

      {!loading && debtors.length > 0 && (
        <Card className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Total outstanding</span>
          <span className={styles.summaryValue}>{money(totalOutstanding)}</span>
        </Card>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : debtors.length === 0 ? (
        <EmptyState
          icon={<Icon name="orders" size={48} />}
          heading="No outstanding balances"
          body="Once a counter, delivery, or pickup order is logged on credit, it'll show up here until it's paid off."
        />
      ) : (
        <>
          <Card className={`${catalogStyles.tableCard} ${catalogStyles.desktopOnly}`}>
            <table className={catalogStyles.table}>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th className={catalogStyles.numeric}>Orders</th>
                  <th className={catalogStyles.numeric}>Total</th>
                  <th className={catalogStyles.numeric}>Paid</th>
                  <th className={catalogStyles.numeric}>Outstanding</th>
                  <th>Oldest unpaid</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {debtors.map((debtor) => (
                  <tr key={debtor.customer_id}>
                    <td>{debtor.customer_name}</td>
                    <td>{debtor.customer_phone ?? "—"}</td>
                    <td className={catalogStyles.numeric}>{debtor.order_count}</td>
                    <td className={catalogStyles.numeric}>{money(debtor.total_amount)}</td>
                    <td className={catalogStyles.numeric}>{money(debtor.total_paid)}</td>
                    <td className={`${catalogStyles.numeric} ${styles.outstandingCell}`}>
                      {money(debtor.outstanding)}
                    </td>
                    <td>{debtor.oldest_unpaid_date}</td>
                    <td>
                      <button
                        type="button"
                        className={catalogStyles.editLink}
                        onClick={() => openDebtor(debtor)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <ul className={`${catalogStyles.cardList} ${catalogStyles.mobileOnly}`}>
            {debtors.map((debtor) => (
              <li key={debtor.customer_id} className={catalogStyles.itemCard}>
                <button
                  type="button"
                  className={catalogStyles.itemCardRow}
                  onClick={() => openDebtor(debtor)}
                >
                  <span className={catalogStyles.itemCardIdentity}>
                    <span className={catalogStyles.itemCardName}>{debtor.customer_name}</span>
                    <span className={catalogStyles.itemCardCategory}>
                      {debtor.order_count} order{debtor.order_count === 1 ? "" : "s"} · Since{" "}
                      {debtor.oldest_unpaid_date}
                    </span>
                  </span>
                  <span className={catalogStyles.itemCardMetrics}>
                    <span className={styles.outstandingCell}>{money(debtor.outstanding)}</span>
                  </span>
                  <span className={catalogStyles.itemCardChevron}>
                    <Icon name="chevron-right" size={20} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <Modal
        open={selectedDebtor !== null}
        onClose={closeDebtor}
        title={selectedDebtor ? `${selectedDebtor.customer_name} — outstanding orders` : "Debtor"}
      >
        {selectedDebtor && (
          <div className={styles.debtorDetail}>
            {debtorOrdersLoading ? (
              <p>Loading…</p>
            ) : debtorOrders.length === 0 ? (
              <p className={styles.emptyNote}>No outstanding orders for this customer.</p>
            ) : (
              <ul className={styles.orderList}>
                {debtorOrders.map((order) => {
                  const figures = orderPayments[order.id];
                  const outstanding = figures?.outstanding ?? order.total_amount;
                  if (outstanding <= 0) return null;
                  return (
                    <li key={order.id} className={styles.orderRow}>
                      <div className={styles.orderRowHeader}>
                        <span>
                          {order.order_date} ·{" "}
                          {order.fulfillment_type === "delivery"
                            ? "Delivery"
                            : order.fulfillment_type === "counter"
                              ? "Counter"
                              : "Pickup"}{" "}
                          · {order.location === "restaurant" ? "Restaurant" : "Canteen"}
                        </span>
                        <span className={styles.orderAmount}>{money(order.total_amount)}</span>
                      </div>
                      <div className={styles.orderRowFooter}>
                        <span className={styles.outstandingCell}>
                          {money(outstanding)} outstanding
                          {figures && figures.totalPaid > 0 && ` (${money(figures.totalPaid)} paid)`}
                        </span>
                        <Button type="button" variant="secondary" onClick={() => openPaymentForm(order.id)}>
                          Record payment
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={() => openDeleteOrderConfirm(order)}
                        >
                          Delete order
                        </Button>
                      </div>
                      {figures && figures.payments.length > 0 && (
                        <ul className={styles.paymentList}>
                          {figures.payments.map((payment) => (
                            <li key={payment.id} className={styles.paymentRow}>
                              <span>
                                {money(payment.amount)} · {new Date(payment.paid_at).toLocaleDateString("en-KE")}
                                {payment.note ? ` · ${payment.note}` : ""}
                              </span>
                              <button
                                type="button"
                                className={styles.paymentRowDelete}
                                onClick={() => handleDeletePayment(order.id, payment.id)}
                              >
                                Delete
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
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
        <div className={styles.paymentForm}>
          {paymentOrderId && orderPayments[paymentOrderId] && (
            <p className={styles.emptyNote}>
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

      <Modal
        open={deleteOrderTarget !== null}
        onClose={closeDeleteOrderConfirm}
        title="Delete order"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeDeleteOrderConfirm} disabled={deletingOrder}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={handleDeleteOrder} disabled={deletingOrder}>
              {deletingOrder ? "Deleting…" : "Delete order"}
            </Button>
          </>
        }
      >
        {deleteOrderTarget && (
          <div className={styles.paymentForm}>
            <p>
              This removes the entire {deleteOrderTarget.order_date} order for{" "}
              {deleteOrderTarget.customer_name} ({money(deleteOrderTarget.total_amount)}) — its items, and the
              stock/sales figures it contributed will be recalculated as if it never happened.
            </p>
            {(() => {
              const figures = orderPayments[deleteOrderTarget.id];
              return figures && figures.payments.length > 0 ? (
                <p className={styles.emptyNote}>
                  This order has {money(figures.totalPaid)} in recorded payments — deleting the order removes
                  those payment records too.
                </p>
              ) : null;
            })()}
            {deleteOrderError && <p className={catalogStyles.formError}>{deleteOrderError}</p>}
          </div>
        )}
      </Modal>

      {toast && <Toast message={toast.message} status={toast.status} onDismiss={() => setToast(null)} />}
    </div>
  );
}
