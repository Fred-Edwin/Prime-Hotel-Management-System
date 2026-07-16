"use client";

import { SearchBar } from "../SearchBar";
import { Select, type SelectOption } from "../Select";
import styles from "./FilterBar.module.css";

export interface FilterBarFilter {
  value: string;
  onChange: (value: string) => void;
  /** Include an explicit "all" option (e.g. { value: "", label: "All Categories" })
   *  as the first entry — Select's `placeholder` prop renders a disabled/hidden
   *  option that can't be re-selected once left, which is wrong for a filter
   *  the admin needs to clear back to "all" repeatedly. */
  options: SelectOption[];
  "aria-label": string;
}

export interface FilterBarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filters?: FilterBarFilter[];
}

/**
 * Search + up to a couple of filter dropdowns, sitting above an admin
 * catalog table (Items, Ingredients — see docs/design/01_COMPONENTS.md
 * §4.19). Built entirely from existing SearchBar (§4.20) and Select
 * (§4.3) primitives — no new input styling introduced.
 */
export function FilterBar({ searchValue, onSearchChange, searchPlaceholder, filters }: FilterBarProps) {
  return (
    <div className={styles.bar}>
      <SearchBar
        value={searchValue}
        onChange={onSearchChange}
        placeholder={searchPlaceholder ?? "Search…"}
        className={styles.search}
      />
      {filters && filters.length > 0 && (
        <div className={styles.filters}>
          {filters.map((filter) => (
            <div key={filter["aria-label"]} className={styles.filterSlot}>
              <Select
                value={filter.value}
                onChange={(e) => filter.onChange(e.target.value)}
                options={filter.options}
                aria-label={filter["aria-label"]}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
