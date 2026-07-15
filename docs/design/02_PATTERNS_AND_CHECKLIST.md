# Prosper Hotel Management System — Patterns & Review Checklist

**Read this when:** you're building a full screen/flow and need cross-screen visual consistency guidance, or you're about to consider any screen "done" and need to check it against the design system's own bar.

**Prerequisite:** assumes `00_FOUNDATIONS.md` (tokens, philosophy) and `01_COMPONENTS.md` (individual component specs). This file doesn't repeat either — it only records decisions that span multiple screens, plus the final quality gate.

---

## 5. Patterns

Brief cross-screen notes — not full flows, since these are already specified functionally in the PRD. This section exists only to record *visual* decisions that apply across a pattern, not to duplicate product logic.

- **Login / auth screen** (added Phase 2) — the one screen in this system permitted a display typeface (`display-lg`, Fraunces) and lightly decorative icon use, per `00_FOUNDATIONS.md` §1.2/§1.3/§2.2/§2.7's scoped exceptions. Structure: logo → Fraunces headline → Manrope subordinate line, all on the plain `color-surface-page` background (no illustrated band, no hero surface); a standard white card below holding the name `select` + boxed PIN input (Components §4.1, §4.16); an aubergine footer band (Components §4.17) closing the page with support contacts and attribution. This is a **threshold**, crossed once per session — every other screen in the system stays exactly as restrained as `00_FOUNDATIONS.md` originally specified. Don't extend this screen's treatment (serif type, decorative icons, footer band) to any other screen without the same explicit design-system conversation this one required.
- **Daily entry (restaurant till, store manager ingredients)** — light surfaces throughout (`color-surface-page`, white cards), signaling "this is today, this is live, this happens constantly." Sticky running-total bar always present.
- **Weekly reconciliation (canteen)** — same component language, but the top bar/header for this screen uses a `color-surface-sunken` band with an explicit date-range label ("Week of Jul 6–12") in `overline` style — a deliberate, small visual cue that this is a periodic, not daily, action, addressing Philosophy principle 6 (role and cadence should be visually legible) without inventing a second design language.
- **Admin dashboard** — the one place in this product where `color-surface-dark` (aubergine) appears as a large surface (e.g. a hero stat band at the top: net profit, sales, expenses at `figure-lg` in white/gold-on-dark), before transitioning to standard light cards for the detailed ledger below. This is the system's only real "brand moment" — appropriate here because the dashboard is where an owner engages with the business's performance, not where a cashier needs speed.
  - **Charts (added Phase 7).** The original Phase 7 spec scoped this screen to plain `MetricCard`s only ("big plain numbers, not a dense table") and explicitly excluded trend charts. That was revisited for this build: WaPrecious looks at this screen often enough that a small, restrained set of charts materially improves it, so two chart forms were added as a deliberate, documented extension rather than a silent deviation — (a) a single-series net-profit trend line inside the dark hero band, gold (`--color-chart-primary-dark`), no legend needed (one series, the section title names it); (b) a two-bar Restaurant vs. Canteen comparison (net profit or sales, whichever the surrounding card is about) on the light surface below, using `--color-chart-primary-light`/`--color-chart-secondary-light` with **mandatory direct value labels on every bar** — both chart colors carry a contrast WARN against their surface per the palette validator, which is only legal when paired with visible labels, never color alone. No new chart forms beyond these two without repeating this same design-system conversation. Never a dual-axis chart, never more than these two colors in one chart, never a legend box for the single-series trend line.
- **Delivery/pickup order entry** — reuses the stepper (Components §4.4) and running-total bar (Components §4.5) patterns from till entry, plus standard inputs for customer name and delivery zone (a `select`, fee auto-filling into a read-only field styled per Components §4.3's disabled state).
- **Catalog/staff management (CRUD)** — standard table (Components §4.11) + modal (Components §4.13) for add/edit, no new patterns needed.
- **Empty states** — see Components §4.15 for the shared visual spec; applied per-screen wherever a list/table/dashboard has no data yet.

---

## 6. Quality Standards / Review Checklist

Use before considering any new screen on-language. Includes both functional checks specific to this product's stakes and aesthetic/philosophy checks that hold the visual bar. This checklist is also referenced by `CLAUDE.md`'s design-system-conformance rule and by `04_PHASE_PLAN.md`'s standard gating checklist — every phase with frontend work must pass it before that phase is considered done.

**Aesthetic & Philosophy**
- [ ] The screen reads as clean, minimal, and premium at a glance — not merely "not ugly," but deliberately restrained
- [ ] No more than two brand colors (aubergine, gold) used decoratively; all else neutral or semantic
- [ ] Gold never appears as text or icon color on a light surface — dark surfaces only
- [ ] No display/serif typeface has crept in anywhere
- [ ] Manrope is used only for structural/label roles; Plex Sans is used only for data/numeric roles — the split hasn't blurred
- [ ] No shadow used purely decoratively; flat is still the default
- [ ] The screen would look at home next to every other screen in this system if placed side by side — same restraint, same hierarchy logic

**Functional / Product-Critical**
- [ ] Every tappable control meets the 44px minimum tap target (`space-touch`)
- [ ] Oversell is visually prevented before it's attempted (disabled plus-button at limit), not just rejected after the fact
- [ ] Any validation/error state is specific and in plain language — never a raw or generic error
- [ ] Numeric figures use tabular numerals and don't visually shift/reflow as they update
- [ ] Role/location scope is legible on every screen where it matters (Components §4.6)
- [ ] The running-total bar (where present) is always visible without obstructing content
- [ ] A non-technical staff member could complete the primary action on this screen without instruction
- [ ] Every list/table/dashboard has a considered empty state (Components §4.15), verified against a genuinely empty database — not just imagined

---

*End of the design system reference set — `00_FOUNDATIONS.md`, `01_COMPONENTS.md`, `02_PATTERNS_AND_CHECKLIST.md`. Prosper Hotel Management System, v0.1.1 (split into three files + empty-states addition; see `docs/phases/` for which phase made this change once Phase 1 completes).*
