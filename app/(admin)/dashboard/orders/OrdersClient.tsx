"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { PeriodToggle } from "@/components/PeriodToggle";
import { EmptyState } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import catalogStyles from "../../catalog.module.css";
import styles from "./orders.module.css";

type Period = "today" | "week" | "month";
type Location = "restaurant" | "canteen" | "";

interface OrderItemRow {
  id: string;
  item_id: string;
  quantity: number;
  selling_price_snapshot: number;
  items: { name: string } | null;
}

interface OrderRow {
  id: string;
  location: "restaurant" | "canteen";
  order_date: string;
  customer_name: string;
  fulfillment_type: "delivery" | "pickup";
  delivery_fee_snapshot: number;
  total_amount: number;
  created_at: string;
  order_items: OrderItemRow[];
  delivery_locations: { name: string } | null;
}

interface OrdersResponse {
  period: Period;
  from: string;
  to: string;
  orders: OrderRow[];
}

const PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

const LOCATION_OPTIONS: { value: Location; label: string }[] = [
  { value: "", label: "Both locations" },
  { value: "restaurant", label: "Restaurant" },
  { value: "canteen", label: "Canteen" },
];

function money(value: number): string {
  return `KES ${Math.round(value).toLocaleString("en-KE")}`;
}

function qty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function fulfillmentLabel(order: OrderRow): string {
  if (order.fulfillment_type === "pickup") return "Pickup";
  return order.delivery_locations ? `Delivery — ${order.delivery_locations.name}` : "Delivery";
}

export function OrdersClient() {
  const [period, setPeriod] = useState<Period>("today");
  const [location, setLocation] = useState<Location>("");
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderRow | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ period });
        if (location) params.set("location", location);

        const res = await fetch(`/api/admin/orders?${params.toString()}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error ?? "Failed to load orders");
        if (!cancelled) setData(json as OrdersResponse);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load orders");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [period, location]);

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={catalogStyles.title}>Orders</h1>
          <Link href="/dashboard" className={styles.backLink}>
            ← Back to dashboard
          </Link>
        </div>
        <div className={styles.controls}>
          <PeriodToggle options={PERIOD_OPTIONS} value={period} onChange={(v) => setPeriod(v as Period)} />
          <label className={styles.locationSelect}>
            <select value={location} onChange={(e) => setLocation(e.target.value as Location)}>
              {LOCATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error && <p className={catalogStyles.formError}>{error}</p>}

      {loading && !data ? (
        <p>Loading…</p>
      ) : data && data.orders.length === 0 ? (
        <EmptyState
          icon={<Icon name="orders" size={48} />}
          heading="No orders this period"
          body="Once staff log a delivery or pickup order, it'll show up here."
        />
      ) : data ? (
        <>
          <Card className={`${catalogStyles.tableCard} ${catalogStyles.desktopOnly}`}>
            <table className={catalogStyles.table}>
              <thead>
                <tr>
                  <th>Placed</th>
                  <th>Customer</th>
                  <th>Location</th>
                  <th>Fulfillment</th>
                  <th className={catalogStyles.numeric}>Items</th>
                  <th className={catalogStyles.numeric}>Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      {new Date(order.created_at).toLocaleString("en-KE", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td>{order.customer_name}</td>
                    <td className={styles.locationCell}>
                      {order.location === "restaurant" ? "Restaurant" : "Canteen"}
                    </td>
                    <td>{fulfillmentLabel(order)}</td>
                    <td className={catalogStyles.numeric}>{order.order_items.length}</td>
                    <td className={catalogStyles.numeric}>{money(order.total_amount)}</td>
                    <td>
                      <button
                        type="button"
                        className={catalogStyles.editLink}
                        onClick={() => setSelectedOrder(order)}
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
            {data.orders.map((order) => (
              <li key={order.id} className={catalogStyles.itemCard}>
                <button
                  type="button"
                  className={catalogStyles.itemCardRow}
                  onClick={() => setSelectedOrder(order)}
                >
                  <span className={catalogStyles.itemCardIdentity}>
                    <span className={catalogStyles.itemCardName}>{order.customer_name}</span>
                    <span className={catalogStyles.itemCardCategory}>
                      {new Date(order.created_at).toLocaleString("en-KE", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {" · "}
                      {order.location === "restaurant" ? "Restaurant" : "Canteen"}
                      {" · "}
                      {fulfillmentLabel(order)}
                    </span>
                  </span>
                  <span className={catalogStyles.itemCardMetrics}>
                    <span className={catalogStyles.itemCardPrice}>{money(order.total_amount)}</span>
                    <span className={styles.itemCountBadge}>
                      {order.order_items.length} item{order.order_items.length === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className={catalogStyles.itemCardChevron}>
                    <Icon name="chevron-right" size={20} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <Modal
        open={selectedOrder !== null}
        onClose={() => setSelectedOrder(null)}
        title={selectedOrder ? `Order — ${selectedOrder.customer_name}` : "Order"}
      >
        {selectedOrder && (
          <div className={styles.orderDetail}>
            <dl className={styles.detailList}>
              <div className={styles.detailRow}>
                <dt>Location</dt>
                <dd>{selectedOrder.location === "restaurant" ? "Restaurant" : "Canteen"}</dd>
              </div>
              <div className={styles.detailRow}>
                <dt>Fulfillment</dt>
                <dd>{fulfillmentLabel(selectedOrder)}</dd>
              </div>
              {selectedOrder.fulfillment_type === "delivery" && (
                <div className={styles.detailRow}>
                  <dt>Delivery fee</dt>
                  <dd>{money(selectedOrder.delivery_fee_snapshot)}</dd>
                </div>
              )}
              <div className={styles.detailRow}>
                <dt>Order date</dt>
                <dd>{selectedOrder.order_date}</dd>
              </div>
            </dl>

            <table className={styles.itemsTable}>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className={catalogStyles.numeric}>Qty</th>
                  <th className={catalogStyles.numeric}>Price</th>
                  <th className={catalogStyles.numeric}>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {selectedOrder.order_items.map((line) => (
                  <tr key={line.id}>
                    <td>{line.items?.name ?? "Unknown item"}</td>
                    <td className={catalogStyles.numeric}>{qty(line.quantity)}</td>
                    <td className={catalogStyles.numeric}>{money(line.selling_price_snapshot)}</td>
                    <td className={catalogStyles.numeric}>{money(line.quantity * line.selling_price_snapshot)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className={styles.totalRow}>
              <span>Total</span>
              <span>{money(selectedOrder.total_amount)}</span>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
