"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Wordmark } from "@/components/Wordmark";
import { RoleLocationBadge } from "@/components/RoleLocationBadge";
import { Icon, type IconName } from "@/components/Icon";
import { TillStripSlotProvider, useTillStripSlotContent } from "./TillStripSlot";
import styles from "./StaffShell.module.css";

const BASE_NAV_ITEMS: { href: string; label: string; icon: IconName }[] = [
  { href: "/entry", label: "Entry", icon: "entry" },
  { href: "/expenses", label: "Expenses", icon: "expenses" },
  { href: "/summary", label: "Summary", icon: "summary" },
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
  children,
}: {
  staffName: string;
  location: "restaurant" | "canteen";
  isStoreManager: boolean;
  children: React.ReactNode;
}) {
  return (
    <TillStripSlotProvider>
      <StaffShellInner staffName={staffName} location={location} isStoreManager={isStoreManager}>
        {children}
      </StaffShellInner>
    </TillStripSlotProvider>
  );
}

function StaffShellInner({
  staffName,
  location,
  isStoreManager,
  children,
}: {
  staffName: string;
  location: "restaurant" | "canteen";
  isStoreManager: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const tillStrip = useTillStripSlotContent();

  const navItems = isStoreManager ? [...BASE_NAV_ITEMS, STORE_NAV_ITEM] : BASE_NAV_ITEMS;
  const locationLabel = location === "restaurant" ? "Restaurant" : "Canteen";

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <Wordmark />
        <div className={styles.topBarRight}>
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
  );
}
