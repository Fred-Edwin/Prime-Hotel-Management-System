import { SVGAttributes } from "react";

/**
 * Hand-authored line icons matching Foundations §2.7's spec: 24×24 grid,
 * ~2px stroke, rounded caps/joins, no fill — recommended equivalent of
 * Phosphor (Regular) or Lucide. Kept as inline paths (no icon package
 * dependency) following the pattern already established by
 * AppFooter/Dropdown's hand-drawn SVGs, since the product only needs a
 * small, fixed vocabulary — a whole icon library is disproportionate for
 * ~10 glyphs, consistent with CLAUDE.md's no-recurring-cost/lean-dependency
 * posture.
 */
export type IconName =
  | "entry"
  | "store"
  | "expenses"
  | "orders"
  | "summary"
  | "dashboard"
  | "items"
  | "ingredients"
  | "delivery"
  | "staff"
  | "search"
  | "close"
  | "wastage";

const PATHS: Record<IconName, React.ReactNode> = {
  // Entry — clipboard with a check, the daily till-entry sheet
  entry: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 3.5h6a1 1 0 0 1 1 1V5a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-.5a1 1 0 0 1 1-1Z" />
      <path d="m8.5 13 2 2 4.5-4.5" />
    </>
  ),
  // Store — a stocked box, the central-store ingredient screen
  store: (
    <>
      <path d="M4 9.5 12 5l8 4.5" />
      <path d="M5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9" />
      <path d="M9.5 20v-6h5v6" />
    </>
  ),
  // Expenses — a wallet, operating costs
  expenses: (
    <>
      <rect x="3.5" y="6.5" width="17" height="12" rx="2" />
      <path d="M3.5 10.5h17" />
      <circle cx="16.5" cy="14.5" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  // Orders — a delivery receipt/list
  orders: (
    <>
      <path d="M6 3h9l3 3v15H6z" />
      <path d="M15 3v3h3" />
      <path d="M9 11h6M9 14.5h6M9 18h4" />
    </>
  ),
  // Summary — a simple bar chart, read-only totals
  summary: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M20 20H4" strokeLinejoin="round" />
    </>
  ),
  // Dashboard — a 2x2 grid of tiles, admin overview
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="8" height="8" rx="1.5" />
      <rect x="12.5" y="3.5" width="8" height="8" rx="1.5" />
      <rect x="3.5" y="12.5" width="8" height="8" rx="1.5" />
      <rect x="12.5" y="12.5" width="8" height="8" rx="1.5" />
    </>
  ),
  // Items — a price tag, the sellable menu-item catalog
  items: (
    <>
      <path d="M12.5 3.5H5a1.5 1.5 0 0 0-1.5 1.5v7.5c0 .4.16.78.44 1.06l8 8a1.5 1.5 0 0 0 2.12 0l7.5-7.5a1.5 1.5 0 0 0 0-2.12l-8-8a1.5 1.5 0 0 0-1.06-.44Z" />
      <circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  // Ingredients — a wheat/grain stalk, raw-material catalog
  ingredients: (
    <>
      <path d="M12 21V9" />
      <path d="M12 9c0-2.5-2-3.5-3.5-3.5S6 6.5 6 8s1.5 2.5 3 2.5 3-1 3-1.5Z" />
      <path d="M12 9c0-2.5 2-3.5 3.5-3.5S18 6.5 18 8s-1.5 2.5-3 2.5-3-1-3-1.5Z" />
      <path d="M12 13.5c0-2 1.7-3 3-3s2.7 1 2.7 2.3-1.2 2.2-2.5 2.2-3.2-.5-3.2-1.5Z" />
      <path d="M12 13.5c0-2-1.7-3-3-3s-2.7 1-2.7 2.3 1.2 2.2 2.5 2.2 3.2-.5 3.2-1.5Z" />
    </>
  ),
  // Delivery — a location pin, delivery zones
  delivery: (
    <>
      <path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>
  ),
  // Staff — a person, roster/account management
  staff: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20.5c0-4 3.5-6.5 7.5-6.5s7.5 2.5 7.5 6.5" />
    </>
  ),
  // Search — magnifying glass, used in SearchBar
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.8-4.8" />
    </>
  ),
  // Close — an X, clear-search affordance
  close: (
    <>
      <path d="m6 6 12 12M18 6 6 18" />
    </>
  ),
  // Wastage — a bin, the item-card wastage entry affordance
  wastage: (
    <>
      <path d="M5 7h14" />
      <path d="M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
      <path d="M6.5 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5L17.5 7" />
      <path d="M10.5 11v6M13.5 11v6" />
    </>
  ),
};

export interface IconProps extends Omit<SVGAttributes<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 24, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
