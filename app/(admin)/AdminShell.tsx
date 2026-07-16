"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Wordmark } from "@/components/Wordmark";
import { RoleLocationBadge } from "@/components/RoleLocationBadge";
import { Icon, type IconName } from "@/components/Icon";
import { AdminTopBarSlotProvider } from "./AdminTopBarSlot";
import styles from "./AdminShell.module.css";

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
  { href: "/delivery-locations", label: "Delivery", icon: "delivery" },
  { href: "/dashboard/orders", label: "Orders", icon: "orders" },
  { href: "/staff", label: "Staff", icon: "staff" },
  { href: "/dashboard/audit-log", label: "Audit Log", icon: "history" },
];

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
  // Lazy initializer, not an effect — avoids the extra render pass and
  // the react-hooks/set-state-in-effect lint error. Server-rendered HTML
  // always starts expanded (window is undefined there); the client's
  // first render reads localStorage synchronously before paint, so a
  // returning user doesn't see a visible collapse-toggle flash.
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== "undefined" && localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"
  );

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
                  standing actions. "Add Entry" and the notification bell
                  are styled as real top-bar controls (matching the Phase
                  10 reference) but deliberately unwired — no onClick, a
                  title tooltip on hover instead of PlaceholderStat's
                  visible dashed treatment, which reads right inline in
                  page content but not as a top-bar action. See Phase
                  10's context file: admin-acts-as-staff and a
                  notification system are both real future features, not
                  built this phase. */}
              {showDesktopTopBar && (
                <header className={styles.desktopTopBar}>
                  <div className={styles.desktopTopBarSlot}>{slotContent}</div>
                  <div className={styles.desktopTopBarActions}>
                    <button
                      type="button"
                      className={styles.addEntryButton}
                      title="Lets the admin log stock/sales/orders directly, the same way staff do. Not built yet."
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
          {NAV_ITEMS.map((item) => {
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
        </nav>
      </div>
    </div>
  );
}
