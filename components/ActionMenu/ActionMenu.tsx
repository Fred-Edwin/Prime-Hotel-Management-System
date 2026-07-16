"use client";

import { useEffect, useRef, useState } from "react";
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
 */
export function ActionMenu({ items, "aria-label": ariaLabel }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
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
      {open && (
        <ul role="menu" className={styles.menu}>
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
        </ul>
      )}
    </div>
  );
}
