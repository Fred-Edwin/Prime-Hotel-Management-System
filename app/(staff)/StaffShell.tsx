"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Wordmark } from "@/components/Wordmark";
import { RoleLocationBadge } from "@/components/RoleLocationBadge";
import { Icon, type IconName } from "@/components/Icon";
import { TillStripSlotProvider, useTillStripSlotContent } from "./TillStripSlot";
import type { ActingAsState } from "@/lib/actingAs";
import styles from "./StaffShell.module.css";

const STAFF_SIDEBAR_COLLAPSED_KEY = "staff-sidebar-collapsed";

const BASE_NAV_ITEMS: { href: string; label: string; icon: IconName }[] = [
  { href: "/entry", label: "Entry", icon: "entry" },
  { href: "/orders", label: "Orders", icon: "orders" },
  { href: "/expenses", label: "Expenses", icon: "expenses" },
];

const STORE_NAV_ITEM: { href: string; label: string; icon: IconName } = {
  href: "/store",
  label: "Store",
  icon: "store",
};

export function StaffShell({
  staffName,
  location,
  isStoreManager,
  actingAs,
  children,
}: {
  staffName: string;
  location: "restaurant" | "canteen";
  isStoreManager: boolean;
  // Non-null only when an admin is using this shell via the sidebar role
  // switcher (see lib/actingAs.ts) rather than a real staff session —
  // drives the persistent "Acting as..." badge + Exit affordance below.
  actingAs?: ActingAsState | null;
  children: React.ReactNode;
}) {
  return (
    <TillStripSlotProvider>
      <StaffShellInner staffName={staffName} location={location} isStoreManager={isStoreManager} actingAs={actingAs}>
        {children}
      </StaffShellInner>
    </TillStripSlotProvider>
  );
}

function StaffShellInner({
  staffName,
  location,
  isStoreManager,
  actingAs,
  children,
}: {
  staffName: string;
  location: "restaurant" | "canteen";
  isStoreManager: boolean;
  actingAs?: ActingAsState | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const tillStrip = useTillStripSlotContent();

  const navItems = isStoreManager ? [...BASE_NAV_ITEMS, STORE_NAV_ITEM] : BASE_NAV_ITEMS;
  const locationLabel = location === "restaurant" ? "Restaurant" : "Canteen";

  // Desktop sidebar collapse state (>=1024px, --breakpoint-desktop) —
  // added once admin started routinely reaching these screens from a
  // desktop via the acting-as switcher (docs/design/01_COMPONENTS.md
  // §4.12's reversed staff-sidebar note). Mirrors AdminShell.tsx's own
  // collapse mechanism exactly, including the hydration-mismatch
  // rationale below: always starts expanded on both server and the
  // client's first render — a lazy initializer reading localStorage
  // here would see server (expanded) vs. client (possibly collapsed),
  // a real hydration mismatch, since window is undefined during SSR.
  // Reading the real preference in an effect after mount means the
  // client's first render matches the server's, at the cost of one
  // extra render (a brief expanded-then-collapsed flash) instead of a
  // hydration error. Separate localStorage key from admin's own
  // preference — independent personas, independent settings.
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localStorage.getItem(STAFF_SIDEBAR_COLLAPSED_KEY) === "1") setCollapsed(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STAFF_SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  // Reachable from every acting-mode screen (/entry, /orders, /store),
  // not just the sidebar picker that started it — clears the
  // admin_acting_as cookie (POST /api/admin/acting-as, lib/actingAs.ts)
  // and returns WaPrecious to her own dashboard, distinct from logging
  // out entirely.
  async function handleExitActingAs() {
    await fetch("/api/admin/acting-as", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: null }),
    });
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className={styles.shell}>
      {/* Desktop sidebar (>=1024px) — mirrors AdminShell.tsx's own
          sidebar exactly (position: fixed, collapsible, localStorage-
          persisted). The mobile top bar + bottom nav below is
          unchanged and still what real staff see on their phones; both
          share `navItems` so the two can never drift apart. */}
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
        <nav className={styles.sidebarNav} aria-label="Staff navigation">
          {navItems.map((item) => {
            const active = pathname.startsWith(item.href);
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
        <div className={styles.sidebarBottom}>
          {actingAs && (
            <div className={styles.sidebarActingAs}>
              <RoleLocationBadge
                label={`Acting as ${actingAs.role === "store_manager" ? "Store Manager" : "Cashier"}`}
                variant="acting"
              />
              {!collapsed && (
                <button type="button" className={styles.sidebarLogout} onClick={handleExitActingAs}>
                  Exit
                </button>
              )}
            </div>
          )}
          {!collapsed && <RoleLocationBadge label={locationLabel} variant="location" />}
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
          <Wordmark />
          <div className={styles.topBarRight}>
            {actingAs && (
              <>
                <RoleLocationBadge
                  label={`Acting as ${actingAs.role === "store_manager" ? "Store Manager" : "Cashier"}`}
                  variant="acting"
                />
                <button type="button" className={styles.logoutButton} onClick={handleExitActingAs}>
                  Exit
                </button>
              </>
            )}
            <RoleLocationBadge label={locationLabel} variant="location" />
            <span className={styles.staffName}>{staffName}</span>
            <button type="button" className={styles.logoutButton} onClick={handleLogout}>
              Log out
            </button>
          </div>
        </header>

        <main className={styles.content}>{children}</main>

        <div className={styles.bottomDock}>
          {tillStrip && <div className={styles.tillStripSlot}>{tillStrip}</div>}

          <nav className={styles.bottomNav} aria-label="Staff navigation">
            {navItems.map((item) => {
              const active = pathname.startsWith(item.href);
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
          </nav>
        </div>
      </div>
    </div>
  );
}
