"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Lets an admin page (Dashboard, Ledger) render page-specific controls
 * (a period toggle) into AdminShell's desktop top bar, without prop-
 * drilling through app/(admin)/layout.tsx — the layout renders
 * AdminShell once for every admin route and has no per-page knowledge.
 * Most admin pages (Items, Staff, Delivery Locations) render nothing
 * here and the slot stays empty. See docs/design/01_COMPONENTS.md §4.12.
 */
const AdminTopBarSlotContext = createContext<(node: ReactNode) => void>(() => {});

export function AdminTopBarSlotProvider({
  children,
}: {
  children: (slotContent: ReactNode) => ReactNode;
}) {
  const [slotContent, setSlotContent] = useState<ReactNode>(null);
  return (
    <AdminTopBarSlotContext.Provider value={setSlotContent}>
      {children(slotContent)}
    </AdminTopBarSlotContext.Provider>
  );
}

/** Call from a page component to render `node` into the shell's top bar. */
export function useAdminTopBarSlot(node: ReactNode) {
  const setSlotContent = useContext(AdminTopBarSlotContext);
  useEffect(() => {
    setSlotContent(node);
    return () => setSlotContent(null);
  });
}
