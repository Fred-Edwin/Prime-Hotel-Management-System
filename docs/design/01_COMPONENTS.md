# Prime Hotel Management System — Component Library

**Read this when:** you're building or styling any specific UI component (button, input, stepper, card, badge, nav, modal, toast, etc.).

**Prerequisite:** this file assumes the tokens defined in `00_FOUNDATIONS.md` §3 — every spec below is expressed in terms of those tokens (`color-brand-primary`, `space-touch`, `figure-md`, etc.). If a token name here doesn't ring a bell, it's defined there, not here.

**You don't need this file** for the underlying philosophy/rationale (see `00_FOUNDATIONS.md` §1) or for cross-screen patterns and the pre-ship checklist (see `02_PATTERNS_AND_CHECKLIST.md`).

---

## 4. Component Library

Standard enterprise components are specified using this system's own tokens throughout. Components specific to this product — driven directly by the PRD's stock-entry, authentication, and validation requirements — are called out and specified in full.

### 4.1 Authentication — Name Select + PIN

No oversized POS-style component. This is built entirely from this system's standard input primitives — a dropdown/select and a compact PIN field — styled exactly like every other form control in this system, not a special "auth moment."

**Structure:**
1. **Staff name** — a standard `select` styled per §4.3 (Inputs), listing staff names for lookup. Since staff use their own phones (not a shared device), this can default to "remember last selected staff member" for convenience, with a manual change always available.
2. **PIN** — a single masked numeric input, same visual treatment as any password field (§4.3), max width ~160px, `figure-md` tabular numerals so entered digits are evenly spaced, `inputmode="numeric"` to trigger the numeric keyboard on mobile. No segmented "boxes-per-digit" pattern — that reads as more decorative/POS-like than this system wants; a single clean masked field is more restrained and equally functional.
3. Primary button ("Log in"), full-width on mobile, standard `btn-primary` (§4.2).

**States:** standard input states apply (default, focus, error). Error state (wrong PIN) uses `color-border-error` + a `body-sm` error message below the field — no modal, no shake on this particular control (motion-shake is reserved for oversell, a higher-stakes and more time-critical error).

No welcome illustration, no split-panel brand moment, no serif headline. The login screen's only brand presence is the wordmark/logotype at the top, in Manrope, and the aubergine primary button.

### 4.2 Buttons

| Variant | Spec |
|---|---|
| Primary | `color-brand-primary` fill, white text, `radius-md`, `heading-sm` weight 600 (Manrope). Full-width on mobile entry screens; auto-width elsewhere. |
| Secondary | White fill, 1px `color-border-default` border, `color-text-primary` text |
| Tertiary / Ghost | No fill/border, `color-brand-primary` text |
| Destructive | `color-status-error` fill, white text — reserved for irreversible actions (delete catalog item, remove staff account) |
| Icon button | Minimum 44×44px hit area (`space-touch`), sized for controls operated quickly, one-handed, on phones |

All button sizes on entry/reconciliation screens default to a minimum 44px height, meeting `space-touch` regardless of visual button size.

### 4.3 Inputs

Standard pattern: label-above-field, icon-in-field where relevant, 1px border, 2px focus border. Numeric fields use Plex Sans with tabular figures.

| State | Spec |
|---|---|
| Default | White fill, `color-border-default` 1px border, `radius-md` |
| Focus | Border shifts to `color-border-focus` (2px) |
| Error | Border `color-border-error`, `body-sm` error message below in `color-status-error` |
| Disabled | `color-surface-sunken` fill, `neutral-500` text |

Numeric/quantity fields use `font-family-data` with tabular figures; all other text fields use `font-family-data` at `body-md`/`body-lg` as regular content text (data font, not structural font, per Foundations §2.2's role split — labels above the field are Manrope, the entered value is Plex Sans).

### 4.4 Stepper (quantity entry)

The core interaction of the daily till and weekly reconciliation flows — PRD §4.1: *"taps steppers to record what sold."*

**Structure:** a horizontal control — minus button, live count display, plus button — each tap target minimum 44×44px (`space-touch`). Count is displayed in `figure-md`, tabular numerals, centered, `color-text-primary`.

| State | Spec |
|---|---|
| Default | Minus/plus buttons: `neutral-100` fill, `color-text-primary` icon, `radius-md` |
| Pressed | `motion-instant` (100ms) scale-down (0.96) + fill shifts to `neutral-300` — immediate tactile feedback |
| At zero | Minus button disabled (40% opacity, no tap response) — cannot go negative |
| At available-stock limit | Plus button disabled (40% opacity) the moment the count reaches remaining stock — **this is the primary oversell-prevention mechanism at the UI level**, backed by the database-level rejection described in the PRD |
| Attempted oversell (rapid double-tap past the limit, or a race condition from a slow network state) | `motion-shake` on the entire stepper control, border flashes `color-status-error` for 300ms, returns to normal — paired with a brief inline message ("Only 4 left") that fades after ~2s |

Steppers are laid out in a single-column list, one per item, each row showing: item name (`body-md`, Manrope — see note below), unit price (`body-sm`, `color-text-secondary`), and the stepper control right-aligned. Item name uses the *structural* font (Manrope) since it's a label/identifier, not a data value — the stepper's live count is the only data figure in the row and uses Plex Sans.

### 4.5 Running Total Bar

PRD §4.1: *"A running total (item count, sales value) updates live."*

A sticky bottom bar, present throughout the till/reconciliation entry flow, `elevation-1` permanently (documented exception, Foundations §2.5). Contains: item count (`figure-sm`) and total value (`figure-md`, bold, `color-brand-primary`) on the left, primary "Save" button on the right. Background `color-surface-raised`, top border `color-border-default` 1px in place of/alongside the shadow for extra separation on longer scrolling lists.

Updates to the total use `motion-fast` (150ms) — a brief highlight flash (background tint to `color-status-success-bg` for one cycle) whenever the figure changes, giving quiet confirmation that a tap registered, without needing to look away from the stepper being used.

### 4.6 Role / Location Badge

PRD §3: staff are scoped to one location; admin sees both. The interface should make this scope legible at a glance.

Small pill, `radius-full`, `caption` size, positioned near the page title or in the top nav. Two variants:
- **Location badge** (staff view): `neutral-100` background, `color-text-secondary` text — e.g. "Restaurant" or "Canteen." Quiet, informational, not alarming — this is normal, expected scoping, not a warning.
- **Admin badge** (admin view): `color-brand-primary` background, white text — e.g. "Admin · All locations," signaling elevated scope distinctly from the neutral staff badge.

### 4.7 Validation / Oversell Error State

Composed from this system's standard primitives (error color, error border, motion-shake), but documented as its own entry because PRD §5 requirement 6 ("No one can oversell") makes this one of the system's most important states to get right, not an edge case.

**Trigger:** any entry attempt (stepper, direct quantity input, delivery order line item) that would take a stock figure below zero.

**Treatment:**
1. The offending control shows `motion-shake` (300ms).
2. Its border/outline flashes `color-status-error`.
3. An inline message appears directly beneath the control in `body-sm`, `color-status-error` — plain language, specific ("Only 4 left in stock"), never a generic "Error" or a raw system message.
4. The message auto-dismisses after ~2.5s, or on the next successful interaction with that control — it never requires a manual dismiss, since this happens mid-flow and shouldn't add a tap.
5. No modal, no full-screen interruption — the error stays local to the control that caused it, consistent with the principle that validation is a design material woven into the flow, not a wall thrown up in front of it.

### 4.8 Period Toggle

PRD §4.6: admin views figures "for today, this week, or this month."

A segmented control, three (or occasionally four, if a custom range is added later) options in a single pill-shaped container, `radius-full`, `neutral-100` background. Active segment: `color-brand-primary` fill, white text, `motion-fast` slide transition between segments. Inactive segments: transparent, `color-text-secondary`.

### 4.9 Low-Stock Indicator

PRD §4.6: *"Low-stock items are surfaced without her having to go looking for them."*

A small `color-status-warning` dot or `caption`-sized pill ("Low stock") attached to an item row wherever stock is shown — table cell, stepper row, dashboard list. Never uses `color-brand-accent` (gold) for this purpose, even though gold might seem visually "attention-getting" — that would blur the line between brand color and status color, which this system's semantic-color rule (Foundations §2.1) exists specifically to prevent.

### 4.10 Cards

| Variant | Spec |
|---|---|
| Content card | `radius-lg`, flat with 1px `color-border-default` border, no shadow at rest |
| Stat card (admin dashboard) | Same structure; large figure in `figure-lg`, Plex Sans, `color-brand-primary`; `overline` label above; small trend indicator using semantic color tokens below |
| Interactive/clickable card | `shadow-elevation-1` on hover/tap only |

### 4.11 Tables

Header row distinguished by weight not fill, quiet row dividers, status badges using semantic tokens. Numeric columns (quantity, price, totals) right-aligned, Plex Sans tabular figures; text columns (item name, staff name) left-aligned, Manrope.

Density: `comfortable` (48px row height) as default for admin ledger views; `compact` (40px) available for dense catalog-management tables.

### 4.12 Navigation

Sized to this product's actual surface count — a handful of screens, not a sprawling multi-section app:

- **Top bar**: `color-surface-raised` or `color-brand-primary` (admin dashboard uses the dark variant for visual distinction from entry screens — see `02_PATTERNS_AND_CHECKLIST.md` §5), wordmark/logotype left, role/location badge (§4.6) and staff name right.
- **Bottom tab bar** (mobile primary navigation): 3–4 destinations depending on role (e.g. staff: Entry, Deliveries, Expenses; admin adds Dashboard, Catalog). Icons from the standard set (Foundations §2.7), `neutral-700` inactive / `color-brand-primary` active, label in `caption` below each icon.
- No sidebar — this product's mobile-first, single-role-per-session nature doesn't call for a persistent desktop sidebar; one may be added later as a desktop-only enhancement for the admin dashboard if needed, not specified here.

### 4.13 Modals

Used sparingly — confirm-before-destructive-action (delete catalog item), confirm delivery order details before submission. Not used for validation errors (§4.7 handles those inline).

### 4.14 Toasts

Used for save confirmations ("Today's sales saved") and non-blocking system messages. Left-edge status-color bar, `elevation-4`, auto-dismiss.

### 4.15 Empty States

*Added post-v0.1.0 — flagged as a gap during the design-system audit ahead of Phase 8 (`04_PHASE_PLAN.md`), which requires "every screen has a considered empty state" as an acceptance criterion but had no visual spec to build against.*

A considered empty state is a plain-language invitation to act, not a blank page or a raw "no data" string (per Phase 8's own acceptance criterion). Structure:

| Element | Spec |
|---|---|
| Container | Centered within the content area, generous vertical padding (`space-12` top/bottom minimum) — never a tight, cramped block |
| Icon | Single line icon from the standard set (Foundations §2.7), 48×48px, `neutral-500` — never a decorative illustration (consistent with §1.3's "not illustrated or decorated" non-goal) |
| Heading | `heading-md`, Manrope, `color-text-primary` — states the situation plainly ("No items yet," "No entries this week") |
| Body | `body-md`, Plex Sans, `color-text-secondary` — one sentence on what to do next, in plain language, not a generic placeholder |
| Action (where applicable) | Standard primary or secondary button (§4.2) — e.g. "Add your first item" on an empty catalog. Omit entirely on screens where the empty state is expected/normal rather than actionable (e.g. a brand-new staff account's first day with no entries yet) |

**Rule:** never reuse the oversell/error visual language (§4.7) for an empty state — an empty state is a normal, expected condition, not a failure, and should read calmly (`neutral` tones), not with any status color.
