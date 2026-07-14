"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Wordmark } from "@/components/Wordmark";
import { RoleLocationBadge } from "@/components/RoleLocationBadge";
import { Icon, type IconName } from "@/components/Icon";
import styles from "./AdminShell.module.css";

const NAV_ITEMS: { href: string; label: string; icon: IconName }[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/items", label: "Items", icon: "items" },
  { href: "/ingredients", label: "Ingredients", icon: "ingredients" },
  { href: "/delivery-locations", label: "Delivery", icon: "delivery" },
  { href: "/dashboard/orders", label: "Orders", icon: "orders" },
  { href: "/staff", label: "Staff", icon: "staff" },
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

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className={styles.shell}>
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

      <main className={styles.content}>{children}</main>

      <nav className={styles.bottomNav} aria-label="Admin navigation">
        {NAV_ITEMS.map((item) => {
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
  );
}
