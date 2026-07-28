"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Wordmark } from "@/components/Wordmark";
import { RoleLocationBadge } from "@/components/RoleLocationBadge";
import { Icon, type IconName } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { PeriodToggle } from "@/components/PeriodToggle";
import type { ActingAsLocation, ActingAsRole } from "@/lib/actingAs";
import { AdminTopBarSlotProvider } from "./AdminTopBarSlot";
import styles from "./AdminShell.module.css";

const LOCATION_OPTIONS: { value: ActingAsLocation; label: string }[] = [
  { value: "restaurant", label: "Restaurant" },
  { value: "canteen", label: "Canteen" },
];

const SIDEBAR_COLLAPSED_KEY = "admin-sidebar-collapsed";

// Dashboard's own href ("/dashboard") is a string-prefix of every
// /dashboard/* sub-route (Ledger, Orders, Audit Log) — a plain
// startsWith() would light up Dashboard's nav item on every one of
// those pages too. Dashboard needs an exact match; everything else
// still wants prefix matching (e.g. a future /staff/[id] detail route
// should still highlight "Staff").
function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname.startsWith(href);
}

const NAV_ITEMS: { href: string; label: string; icon: IconName }[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/dashboard/ledger", label: "Ledger", icon: "summary" },
  { href: "/items", label: "Items", icon: "items" },
  { href: "/ingredients", label: "Ingredients", icon: "ingredients" },
  { href: "/dashboard/purchases", label: "Purchases", icon: "store" },
  { href: "/dashboard/expenses", label: "Expenses", icon: "expenses" },
  { href: "/delivery-locations", label: "Delivery", icon: "delivery" },
  { href: "/dashboard/orders", label: "Orders", icon: "orders" },
  // Added Phase 11 (docs/01_DATA_MODEL.md §6's "Credit sales and
  // customer payments" subsection) -- outstanding balance per
  // customer, drill into unpaid orders, record a payment.
  { href: "/dashboard/debtors", label: "Debtors", icon: "expenses" },
  // Added post-launch (docs/01_DATA_MODEL.md's asset-register subsection,
  // 2026-07-28) -- durable equipment (utensils/cookware) catalog + on-hand
  // value + purchase/loss logging. Reuses the "ingredients" icon --
  // components/Icon/Icon.tsx has no dedicated equipment/asset icon, same
  // design-system gap Debtors flagged for its own icon reuse in Phase 11.
  { href: "/assets", label: "Assets", icon: "ingredients" },
  { href: "/staff", label: "Staff", icon: "staff" },
  { href: "/dashboard/audit-log", label: "Audit Log", icon: "history" },
];

// Mobile/tablet bottom nav (<1024px) only — the desktop sidebar shows every
// NAV_ITEMS entry directly and is unaffected. These are the daily-oversight
// screens WaPrecious needs one tap away; the rest live behind "More".
// Human-confirmed, 2026-07-17 (see docs/backlog/07_admin_ux_sweep.md Batch B).
const PRIMARY_MOBILE_NAV_HREFS = ["/dashboard", "/dashboard/ledger", "/dashboard/orders", "/staff"];

export function AdminShell({
  staffName,
  children,
}: {
  staffName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // Top bar (period-toggle slot + Add Entry/bell) is Dashboard-specific
  // content — every other admin screen has its own page heading directly
  // under the sidebar/mobile top bar instead, so the slot only renders here.
  const showDesktopTopBar = pathname === "/dashboard";
  // Always starts expanded on both server and the client's first render
  // — a lazy initializer reading localStorage here was tried, but React
  // still reconciles that first client render against the server's HTML
  // (which always sees collapsed=false, since window is undefined during
  // SSR), so a returning user with a collapsed sidebar hit a real
  // hydration mismatch (server: expanded, client: collapsed) rather than
  // avoiding one. Reading the real preference in an effect after mount
  // means the client's first render matches the server's, at the cost of
  // one extra render (a brief expanded-then-collapsed flash) instead of
  // a hydration error.
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  // Admin "act as staff" role switcher (sidebar/top-bar "Add Entry"
  // affordance, previously an unwired stub — see lib/actingAs.ts and
  // lib/auth.ts's getActingContext()). actingAsOpen drives a two-step
  // modal: pick Cashier or Store Manager, then (Cashier only) pick a
  // location, before POSTing the choice and navigating into the real
  // staff screens.
  const [actingAsOpen, setActingAsOpen] = useState(false);
  const [pendingRole, setPendingRole] = useState<ActingAsRole | null>(null);
  const [pendingLocation, setPendingLocation] = useState<ActingAsLocation>("restaurant");
  const [actingAsSubmitting, setActingAsSubmitting] = useState(false);

  function closeActingAsModal() {
    setActingAsOpen(false);
    setPendingRole(null);
    setPendingLocation("restaurant");
  }

  async function confirmActingAs(role: ActingAsRole, location: ActingAsLocation) {
    setActingAsSubmitting(true);
    try {
      const res = await fetch("/api/admin/acting-as", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, location }),
      });
      if (!res.ok) return;
      closeActingAsModal();
      router.push(role === "store_manager" ? "/store" : "/entry");
    } finally {
      setActingAsSubmitting(false);
    }
  }

  const primaryMobileNavItems = NAV_ITEMS.filter((item) => PRIMARY_MOBILE_NAV_HREFS.includes(item.href));
  const secondaryMobileNavItems = NAV_ITEMS.filter((item) => !PRIMARY_MOBILE_NAV_HREFS.includes(item.href));
  const moreActive = secondaryMobileNavItems.some((item) => isNavItemActive(pathname, item.href));

  useEffect(() => {
    // Deliberate post-mount read of a client-only preference (see the
    // comment on `collapsed` above for why this can't be a lazy useState
    // initializer).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1") setCollapsed(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className={styles.shell}>
      {/* Desktop sidebar (>=1024px, --breakpoint-desktop) — see
          docs/design/01_COMPONENTS.md §4.12's admin nav entry, added
          Phase 10. WaPrecious is primarily a laptop user; the mobile
          top bar + bottom nav below is unchanged and still what renders
          on phone. Both share NAV_ITEMS so the two never drift apart.
          position: fixed (not sticky) so it never scrolls with page
          content regardless of how tall .content grows — see Phase 10's
          context file for the sticky-based version this replaced, which
          scrolled out of view on any page taller than one viewport.
          Collapsible (icon-only) via a toggle, preference persisted in
          localStorage so it survives a reload. */}
      <aside className={[styles.sidebar, collapsed ? styles.sidebarCollapsed : ""].join(" ")}>
        <div className={styles.sidebarTop}>
          {!collapsed && <Wordmark onDark />}
          <button
            type="button"
            className={styles.sidebarCollapseToggle}
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <Icon name="chevron-right" size={16} className={collapsed ? "" : styles.collapseIconOpen} />
          </button>
        </div>
        <nav className={styles.sidebarNav} aria-label="Admin navigation">
          {NAV_ITEMS.map((item) => {
            const active = isNavItemActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[styles.sidebarNavItem, active ? styles.sidebarNavItemActive : ""].join(" ")}
                title={collapsed ? item.label : undefined}
              >
                <Icon name={item.icon} size={20} />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>
        {/* Act-as-staff entry point (sidebar, per direct client request —
            "a dropdown at the sidebar top or bottom where admin can
            select any role") — sits between nav links and the
            admin-identity footer since it's a mode switch, not a
            destination page. Mirrors the top bar's "Add Entry" button;
            both open the same modal. */}
        <button
          type="button"
          className={styles.actingAsSidebarButton}
          onClick={() => setActingAsOpen(true)}
          title={collapsed ? "Act as Cashier or Store Manager" : undefined}
        >
          <Icon name="entry" size={18} />
          {!collapsed && "Act as staff"}
        </button>
        <div className={styles.sidebarBottom}>
          {!collapsed && <RoleLocationBadge label="Admin · All locations" variant="admin" />}
          {!collapsed && <span className={styles.sidebarStaffName}>{staffName}</span>}
          <button
            type="button"
            className={styles.sidebarLogout}
            onClick={handleLogout}
            title={collapsed ? "Log out" : undefined}
          >
            <Icon name="logout" size={18} />
            {!collapsed && "Log out"}
          </button>
        </div>
      </aside>

      <div className={[styles.main, collapsed ? styles.mainSidebarCollapsed : ""].join(" ")}>
        <header className={styles.topBar}>
          <Wordmark onDark />
          <div className={styles.topBarRight}>
            <RoleLocationBadge label="Admin · All locations" variant="admin" />
            <span className={styles.staffName}>{staffName}</span>
            <button type="button" className={styles.logoutButton} onClick={handleLogout}>
              Log out
            </button>
          </div>
        </header>

        <AdminTopBarSlotProvider>
          {(slotContent) => (
            <>
              {/* Desktop-only light-surface top bar (>=1024px) — separate
                  from the dark mobile .topBar above, which stays hidden
                  at this breakpoint (sidebar covers its role). Renders
                  whatever the current page pushed into the shared slot
                  (e.g. Dashboard/Ledger's period toggle) plus a few
                  standing actions. "Add Entry" now opens the acting-as
                  role picker (Cashier/Store Manager) — previously an
                  unwired stub, see docs/backlog/04_admin_impersonation.md's
                  2026-07-25 note on this being revisited. The
                  notification bell is still an unbuilt placeholder. */}
              {showDesktopTopBar && (
                <header className={styles.desktopTopBar}>
                  <div className={styles.desktopTopBarSlot}>{slotContent}</div>
                  <div className={styles.desktopTopBarActions}>
                    <button
                      type="button"
                      className={styles.addEntryButton}
                      title="Log stock, sales, or orders yourself, the same way staff do."
                      onClick={() => setActingAsOpen(true)}
                    >
                      <Icon name="entry" size={18} />
                      Add Entry
                    </button>
                    <button
                      type="button"
                      className={styles.iconButton}
                      title="No notification system exists yet — a placeholder for a future feature."
                      aria-label="Notifications"
                    >
                      <Icon name="bell" size={20} />
                    </button>
                  </div>
                </header>
              )}

              <main className={styles.content}>{children}</main>
            </>
          )}
        </AdminTopBarSlotProvider>

        <nav className={styles.bottomNav} aria-label="Admin navigation">
          {primaryMobileNavItems.map((item) => {
            const active = isNavItemActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[styles.navItem, active ? styles.navItemActive : ""].join(" ")}
              >
                <Icon name={item.icon} size={22} />
                <span className={styles.navLabel}>{item.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            className={[styles.navItem, styles.navItemButton, moreActive ? styles.navItemActive : ""].join(" ")}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(true)}
          >
            <Icon name="more" size={22} />
            <span className={styles.navLabel}>More</span>
          </button>
        </nav>

        <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
          <nav className={styles.moreMenu} aria-label="More admin navigation">
            {secondaryMobileNavItems.map((item) => {
              const active = isNavItemActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={[styles.moreMenuItem, active ? styles.moreMenuItemActive : ""].join(" ")}
                  onClick={() => setMoreOpen(false)}
                >
                  <Icon name={item.icon} size={20} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </Modal>

        {/* Act-as-staff picker (sidebar button + top-bar "Add Entry" both
            open this). Step 1: pick Cashier or Store Manager. Step 2
            (Cashier only — Store Manager is always restaurant, no
            location screen exists for canteen) : pick a location, then
            confirm. See lib/actingAs.ts for why store_manager never
            shows a location choice. */}
        <Modal open={actingAsOpen} onClose={closeActingAsModal} title="Act as staff">
          {pendingRole === "cashier" ? (
            <div className={styles.actingAsModalBody}>
              <p className={styles.actingAsModalHint}>Which location are you covering?</p>
              <PeriodToggle
                options={LOCATION_OPTIONS}
                value={pendingLocation}
                onChange={(value) => setPendingLocation(value as ActingAsLocation)}
              />
              <div className={styles.actingAsModalActions}>
                <button type="button" className={styles.sidebarLogout} onClick={() => setPendingRole(null)}>
                  Back
                </button>
                <button
                  type="button"
                  className={styles.addEntryButton}
                  disabled={actingAsSubmitting}
                  onClick={() => confirmActingAs("cashier", pendingLocation)}
                >
                  Continue
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.actingAsModalBody}>
              <p className={styles.actingAsModalHint}>
                Log stock, sales, or orders yourself — you&apos;ll see exactly what staff see.
              </p>
              <button
                type="button"
                className={styles.actingAsModalOption}
                onClick={() => setPendingRole("cashier")}
              >
                <Icon name="entry" size={20} />
                <div>
                  <strong>Cashier</strong>
                  <span>Till sales and delivery/pickup orders — Restaurant or Canteen.</span>
                </div>
              </button>
              <button
                type="button"
                className={styles.actingAsModalOption}
                disabled={actingAsSubmitting}
                onClick={() => confirmActingAs("store_manager", "restaurant")}
              >
                <Icon name="store" size={20} />
                <div>
                  <strong>Store Manager</strong>
                  <span>Ingredient receiving and usage — Restaurant only.</span>
                </div>
              </button>
            </div>
          )}
        </Modal>
      </div>
    </div>
  );
}
