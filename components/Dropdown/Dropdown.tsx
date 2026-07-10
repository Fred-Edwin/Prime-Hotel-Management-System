"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./Dropdown.module.css";

export interface DropdownProps {
  label?: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
}

/**
 * Fully custom-styled listbox — used where a native `<select>`'s open
 * popup (OS/browser-rendered, not stylable) would look inconsistent with
 * the rest of the card. See docs/design/01_COMPONENTS.md §4.1 (name
 * picker on the login screen). Keyboard support: Enter/Space toggles,
 * Arrow Up/Down moves selection, Escape closes, click-outside closes.
 */
export function Dropdown({
  label,
  options,
  value,
  onChange,
  placeholder = "Select…",
  disabled = false,
  error,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const buttonId = useId();

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function toggleOpen() {
    if (disabled) return;
    setOpen((prev) => !prev);
    setActiveIndex(Math.max(0, options.indexOf(value)));
  }

  function selectOption(option: string) {
    onChange(option);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;

    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        toggleOpen();
      }
      return;
    }

    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (activeIndex >= 0) selectOption(options[activeIndex]);
    }
  }

  return (
    <div className={styles.field} ref={rootRef}>
      {label && (
        <label className={styles.label} id={`${buttonId}-label`} htmlFor={buttonId}>
          {label}
        </label>
      )}
      <button
        type="button"
        id={buttonId}
        className={[styles.trigger, error ? styles.triggerError : "", open ? styles.triggerOpen : ""]
          .filter(Boolean)
          .join(" ")}
        onClick={toggleOpen}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={label ? `${buttonId}-label` : undefined}
      >
        <span className={value ? styles.value : styles.placeholder}>{value || placeholder}</span>
        <svg
          className={styles.chevron}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <ul className={styles.listbox} id={listId} role="listbox">
          {options.map((option, i) => (
            <li
              key={option}
              role="option"
              aria-selected={option === value}
              className={[
                styles.option,
                option === value ? styles.optionSelected : "",
                i === activeIndex ? styles.optionActive : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => selectOption(option)}
            >
              {option}
            </li>
          ))}
        </ul>
      )}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
