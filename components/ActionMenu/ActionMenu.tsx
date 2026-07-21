"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/Icon";
import styles from "./ActionMenu.module.css";

export interface ActionMenuItem {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

export interface ActionMenuProps {
  items: ActionMenuItem[];
  "aria-label": string;
}

/**
 * Per-row overflow menu for table actions — kebab trigger + popover list.
 * New addition (see docs/design/01_COMPONENTS.md §4.21): the system had no
 * multi-action row pattern before this (Items' table has a single inline
 * "Edit" link only). Reuses Dropdown's popover surface/elevation and
 * click-outside/Escape handling rather than inventing new visual language.
 *
 * The menu itself is portaled to document.body and positioned via the
 * trigger's getBoundingClientRect() (same portal approach Modal/Drawer
 * already use for their own overlays), rather than position:absolute
 * inside .root — a real bug found live-testing this on
 * /dashboard/purchases: a table row's scroll wrapper
 * (catalogStyles.tableCard, overflow-x:auto) clips any absolutely
 * positioned child that would render below the scrollable area, so with
 * few rows the popover opened but was invisible, cut off by the
 * ancestor's overflow — the exact class of bug staff.module.css's
 * itemCardActionRow comment already documented for mobile cards
 * (there worked around by not using this component at all). Portaling
 * fixes it at the source for every table that uses ActionMenu, not just
 * Purchases.
 */
export function ActionMenu({ items, "aria-label": ariaLabel }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    function reposition() {
      const trigger = rootRef.current?.querySelector("button");
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const menuWidth = menuRef.current?.offsetWidth ?? 160;
      setPosition({
        top: rect.bottom + window.scrollY + 4,
        left: rect.right + window.scrollX - menuWidth,
      });
    }
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (
        rootRef.current &&
        !rootRef.current.contains(e.target as Node) &&
        menuRef.current &&
        !menuRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="more" size={20} />
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <ul
            role="menu"
            className={styles.menu}
            ref={menuRef}
            style={
              position
                ? { position: "absolute", top: position.top, left: position.left, right: "auto" }
                : { position: "absolute", visibility: "hidden" }
            }
          >
            {items.map((item) => (
              <li key={item.label} role="none">
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  className={[styles.item, item.destructive ? styles.itemDestructive : ""]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => {
                    setOpen(false);
                    item.onClick();
                  }}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>,
          document.body
        )}
    </div>
  );
}
