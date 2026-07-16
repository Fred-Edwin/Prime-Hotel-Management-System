"use client";

import { ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icon";
import styles from "./Drawer.module.css";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Right-side panel — the standard admin catalog add/edit form pattern
 * from Phase 10 onward (Items, Ingredients, Delivery Locations, Staff),
 * replacing Modal for these screens. Modal remains correct for shorter,
 * non-form interactions (e.g. Order Detail's line-item drill-in) — this
 * exists specifically because a centered modal cramps a multi-section
 * form at the field counts these screens have, and a drawer keeps the
 * underlying table visible/contextual behind it on desktop, where the
 * admin primarily works. See docs/design/01_COMPONENTS.md §4.19.
 */
export function Drawer({ open, onClose, title, subtitle, children, footer }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <div>
            <h2 id="drawer-title" className={styles.title}>
              {title}
            </h2>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
