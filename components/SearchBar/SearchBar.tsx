"use client";

import { InputHTMLAttributes, forwardRef } from "react";
import { Icon } from "../Icon";
import styles from "./SearchBar.module.css";

export interface SearchBarProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  value: string;
  onChange: (value: string) => void;
}

/**
 * Filter-as-you-type control for long lists (item catalog rows on
 * /entry, ingredient rows on /store) — see docs/design/01_COMPONENTS.md
 * §4.20. Built on Input's (§4.3) token language (same border/focus
 * states) but a distinct shape: no label-above, leading search glyph,
 * trailing clear ("×") affordance that only appears once there's a
 * value to clear.
 */
export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(
  ({ value, onChange, placeholder = "Search…", className, ...rest }, ref) => {
    return (
      <div className={[styles.field, className ?? ""].filter(Boolean).join(" ")}>
        <Icon name="search" size={18} className={styles.searchIcon} />
        <input
          ref={ref}
          type="search"
          className={styles.input}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...rest}
        />
        {value && (
          <button
            type="button"
            className={styles.clearButton}
            onClick={() => onChange("")}
            aria-label="Clear search"
          >
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
    );
  },
);

SearchBar.displayName = "SearchBar";
