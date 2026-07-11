"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Wordmark } from "@/components/Wordmark";
import { RoleLocationBadge } from "@/components/RoleLocationBadge";
import styles from "./StaffShell.module.css";

const BASE_NAV_ITEMS = [
  { href: "/entry", label: "Entry" },
  { href: "/expenses", label: "Expenses" },
  { href: "/summary", label: "Summary" },
];

const STORE_NAV_ITEM = { href: "/store", label: "Store" };

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
  const pathname = usePathname();
  const router = useRouter();

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

      <nav className={styles.bottomNav} aria-label="Staff navigation">
        {navItems.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[styles.navItem, active ? styles.navItemActive : ""].join(" ")}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
