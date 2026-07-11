"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from "react";

/**
 * Lets a staff screen (EntryClient, StoreClient) hand its TillStrip up
 * to StaffShell, which renders it as a real flex sibling between <main>
 * and the bottom nav — not as an independently `position: fixed` element
 * with a hand-computed pixel offset from the nav's height. Two fixed
 * elements positioned from different components kept drifting out of
 * sync (see docs/phases/phase4_context.md) because there was no single
 * source of truth for "how tall is the other one." Routing both through
 * one flex column removes the arithmetic entirely — the browser's layout
 * engine keeps them stacked correctly regardless of either one's height.
 */
const TillStripSlotContext = createContext<{
  content: ReactNode;
  setContent: (content: ReactNode) => void;
} | null>(null);

export function TillStripSlotProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode>(null);
  return (
    <TillStripSlotContext.Provider value={{ content, setContent }}>
      {children}
    </TillStripSlotContext.Provider>
  );
}

/** StaffShell calls this to render whatever the current screen registered. */
export function useTillStripSlotContent(): ReactNode {
  const ctx = useContext(TillStripSlotContext);
  return ctx?.content ?? null;
}

/**
 * A screen (EntryClient, StoreClient) calls this to register its
 * TillStrip. StaffShell renders {children} — i.e. the screen calling
 * this hook — so the screen is a DESCENDANT of the provider, not a
 * sibling: updating context state re-renders StaffShell, which
 * re-renders the screen, which would call this hook again with a new
 * (referentially different) element every time, looping forever if the
 * effect ran unconditionally on every render. Fixed by only calling
 * setContent when the rendered *output* actually changed, compared with
 * a cheap key rather than the element reference itself (callers pass a
 * `renderKey` — e.g. `itemCount:totalValue:saving` — that only changes
 * when the strip's visible content would).
 */
export function useTillStripSlot(content: ReactNode, renderKey: string | number) {
  const ctx = useContext(TillStripSlotContext);

  useLayoutEffect(() => {
    ctx?.setContent(content);
    // Only re-run when renderKey changes, NOT on every render (content
    // is intentionally excluded — it's a fresh element each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderKey]);

  useEffect(() => {
    return () => ctx?.setContent(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
