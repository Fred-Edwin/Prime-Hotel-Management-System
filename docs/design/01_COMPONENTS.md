# Prosper Hotel Management System — Component Library

**Read this when:** you're building or styling any specific UI component (button, input, stepper, card, badge, nav, modal, toast, etc.).

**Prerequisite:** this file assumes the tokens defined in `00_FOUNDATIONS.md` §3 — every spec below is expressed in terms of those tokens (`color-brand-primary`, `space-touch`, `figure-md`, etc.). If a token name here doesn't ring a bell, it's defined there, not here.

**You don't need this file** for the underlying philosophy/rationale (see `00_FOUNDATIONS.md` §1) or for cross-screen patterns and the pre-ship checklist (see `02_PATTERNS_AND_CHECKLIST.md`).

---

## 4. Component Library

Standard enterprise components are specified using this system's own tokens throughout. Components specific to this product — driven directly by the PRD's stock-entry, authentication, and validation requirements — are called out and specified in full.

### 4.1 Authentication — Name Select + PIN

*Revised in Phase 2, after the original v0.1.0 spec (below the line) shipped and was judged too spartan in practice — the login screen read as unfinished, not restrained, with no visual anchor and no typographic moment of its own. `00_FOUNDATIONS.md` §1.2/§1.3/§2.2/§2.7 were amended in the same phase to carve out a narrow, explicitly-scoped exception for this one screen — see those sections for the full rationale. This is still the system's only screen with a display typeface, decorative icon use, or a boxed-digit input; nothing here licenses similar treatment elsewhere.*

**Structure, top to bottom:**
1. **Logo** — the Prosper Hotel roundel mark, ~130px, centered, on the plain `color-surface-page` background (no aubergine band behind it).
2. **Headline** — "Welcome back" in `display-lg` (Fraunces), the one sanctioned use of the display typeface in this system.
3. **Subordinate line** — "Prosper Hotel Management System" in `label`-weight Manrope, `color-text-secondary`.
4. **Card** (`color-surface-raised`, `radius-lg`, `elevation-2`, per §4.10's content-card spec):
   - **Staff name** — a custom-styled dropdown (§4.18, new), not a native `select`. A native select's open popup is OS/browser-rendered and can't be restyled to match the card, which read as inconsistent once the rest of the screen was designed. Lists staff names for lookup (see `docs/01_DATA_MODEL.md` for how a picked name resolves to a staff account server-side). Since staff use their own phones, this may default to "remember last selected staff member," with a manual change always available.
   - **PIN** — a segmented **boxed-digit input** (§4.16, new), revealed once a name is selected. This reverses the original spec's "no segmented boxes, too POS-like" call — in practice a single masked text field was slower to visually self-check than a boxed pattern, and the boxed pattern is now judged worth the small increase in visual weight for this one high-frequency interaction.
   - Primary button ("Sign in"), full-width, standard `btn-primary` (§4.2), enabled once all PIN digits are entered.
5. **Footer** (§4.17, new) — sits outside/below the card, `color-surface-dark` background (the only other surface on this screen besides the plain page background and the white card), containing support contact links and a "Developed by Lobster Technologies" attribution line.

**States:** standard input/select states apply (default, focus, error) per §4.3 and §4.16. Error state (wrong PIN) uses `color-border-error` + a `body-sm` error message below the PIN boxes — no modal, no shake on this control (motion-shake stays reserved for oversell, per §4.7's higher-stakes framing).

**What's unchanged from the original spec:** no welcome illustration beyond the logo itself, no split-panel layout, no color outside the existing aubergine/gold/neutral palette. The exception is narrow — a headline and a footer — not a rebuild of the visual language.

<details>
<summary>Original v0.1.0 spec (superseded above, kept for history)</summary>

No oversized POS-style component. This is built entirely from this system's standard input primitives — a dropdown/select and a compact PIN field — styled exactly like every other form control in this system, not a special "auth moment."

**Structure:**
1. **Staff name** — a standard `select` styled per §4.3 (Inputs), listing staff names for lookup. Since staff use their own phones (not a shared device), this can default to "remember last selected staff member" for convenience, with a manual change always available.
2. **PIN** — a single masked numeric input, same visual treatment as any password field (§4.3), max width ~160px, `figure-md` tabular numerals so entered digits are evenly spaced, `inputmode="numeric"` to trigger the numeric keyboard on mobile. No segmented "boxes-per-digit" pattern — that reads as more decorative/POS-like than this system wants; a single clean masked field is more restrained and equally functional.
3. Primary button ("Log in"), full-width on mobile, standard `btn-primary` (§4.2).

**States:** standard input states apply (default, focus, error). Error state (wrong PIN) uses `color-border-error` + a `body-sm` error message below the field — no modal, no shake on this particular control (motion-shake is reserved for oversell, a higher-stakes and more time-critical error).

No welcome illustration, no split-panel brand moment, no serif headline. The login screen's only brand presence is the wordmark/logotype at the top, in Manrope, and the aubergine primary button.

</details>

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

**MetricCard's `onDark` + `trend` combination (Phase 7 fix):** when a stat card sits on `color-surface-dark` (the admin dashboard's hero band, `02_PATTERNS_AND_CHECKLIST.md` §5) and shows a trend indicator, it must use `--color-status-success-on-dark`/`--color-status-error-on-dark` (Foundations §3), not the plain `--color-status-success`/`--color-status-error` tokens — those fail WCAG text contrast on the aubergine surface (2.7:1 / 3.1:1, need 4.5:1). `MetricCard.tsx` picks the correct pair automatically based on its `onDark` prop; don't pass a raw status color inline.

### 4.11 Tables

Header row distinguished by weight not fill, quiet row dividers, status badges using semantic tokens. Numeric columns (quantity, price, totals) right-aligned, Plex Sans tabular figures; text columns (item name, staff name) left-aligned, Manrope.

Density: `comfortable` (48px row height) as default for admin ledger views; `compact` (40px) available for dense catalog-management tables.

### 4.12 Navigation

Sized to this product's actual surface count — a handful of screens, not a sprawling multi-section app:

- **Top bar**: `color-surface-raised` or `color-brand-primary` (admin dashboard uses the dark variant for visual distinction from entry screens — see `02_PATTERNS_AND_CHECKLIST.md` §5), wordmark/logotype left, role/location badge (§4.6) and staff name right.
- **Bottom tab bar** (mobile primary navigation): 3–4 destinations depending on role (staff: Entry, Store [store-manager-flagged only], Expenses, Summary; admin: Dashboard, Items, Ingredients, Delivery, Staff). Icon (§4.21) above a `caption`-size label per destination, `neutral-700` inactive / `color-brand-primary` active (label goes semibold on active too, not just the icon). Each tap target is a minimum of `space-touch` (44px) tall on top of the icon+label content — in practice the two-line stack needs `space-touch + space-4` (60px) to sit comfortably, not the bare 44px minimum; a bottom nav sized to exactly 44px is a conformance gap, not a valid minimal implementation (found and fixed in Phase 4 — see `docs/phases/phase4_context.md`). Fixed to the viewport bottom on mobile widths (`position: fixed`, not `sticky` — nesting sticky elements inside other sticky/fixed ancestors is fragile, see the same context file), reflows to a horizontal top-aligned strip at `768px+` per the existing admin desktop-nav placeholder (icon beside label, not stacked, at that width).
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

### 4.16 PIN Input (boxed digit entry)

*Added Phase 2, exclusively for the login screen (§4.1) — reverses the original spec's single-masked-field call. Not a general-purpose component; nowhere else in this system currently needs numeric-code entry.*

**Structure:** N (4, matching the PIN length in `docs/01_DATA_MODEL.md`) individual boxes in a horizontal row, equal width via flex, `radius-md`, 1.5px `color-border-default` border. Each box shows one digit, `font-family-data` (Plex Sans), tabular numerals, `figure-md`-equivalent size, centered.

| State | Spec |
|---|---|
| Empty | `color-border-default` border, no content |
| Filled | Border shifts to `color-brand-primary`; digit is masked as a small centered dot rather than the literal numeral, consistent with this being a credential field |
| Active (next box to receive input) | Border shifts to `color-brand-primary` at 2px width plus a soft focus ring (`0 0 0 3px` at 10% `color-brand-primary` opacity) |
| Error | All boxes shift to `color-border-error`; `body-sm` error message below the row, same message-placement convention as §4.3/§4.7 |

**Behavior:** a single visually-hidden numeric input (`inputmode="numeric"`, `pattern="[0-9]*"`) sits behind the boxes and receives all real keyboard/touch input — the boxes are a pure visual reflection of that input's value, not N separate focusable fields. This keeps autofill, paste, and mobile numeric-keyboard behavior working normally, which a truly-segmented multi-input implementation often breaks. Tapping anywhere on the box row focuses the hidden input. The primary "Sign in" button enables once the value reaches full length; pressing it (or optionally auto-submitting on the last digit, a product decision left open) submits the form.

No `motion-shake` on individual digit entry — that motion stays reserved for oversell (§4.7). A failed sign-in attempt (wrong PIN) uses the plain Error state above, not a shake.

### 4.17 Footer / Attribution Band

*Added Phase 2, for the login screen (§4.1). Not yet used elsewhere, but reusable wherever a full-page (non-nav-shell) layout needs a closing edge.*

A slim band at the bottom of the login screen — the one place besides the headline (§4.1) where this screen departs from the plain `color-surface-page` background used everywhere else on it.

| Element | Spec |
|---|---|
| Background | `color-surface-dark` (aubergine), optionally a subtle gradient toward a deeper shade for depth — same surface color already used for the admin dashboard hero band (`02_PATTERNS_AND_CHECKLIST.md` §5), not a new color |
| Support links | WhatsApp and email contact, each with a small line icon (§2.7's entry-surface exception) in `color-brand-accent` (gold — valid here, dark surface) at `body-sm`, text in `color-text-on-brand-muted` |
| Attribution line | "Developed by **Lobster Technologies**" (linked), `caption` size, the company name in `color-brand-accent`, the rest in a dimmer on-dark neutral |
| Placement | Sits at the true bottom of the viewport, always — this is a footer, it should read as the page's closing edge. Achieved by wrapping *only* the header+card block in a `flex: 1` container that vertically centers itself, with the footer as a sibling **outside** that wrapper, at the end of a `min-height: 100vh` flex column. (An earlier draft of this spec put `flex: 1`/centering on the whole screen including the footer, which on a short-content/tall-viewport combination left the footer stranded mid-page with a dead zone above and below it — corrected during Phase 2 build; see `docs/phases/phase2_context.md` if it exists, or the git history on `app/login/login.module.css`.) |

### 4.18 Dropdown (custom listbox)

*Added Phase 2, for the login screen's name picker (§4.1). A native `<select>` was tried first and reverted — its open popup is rendered by the OS/browser and can't be restyled, which looked inconsistent once the surrounding card had real design applied to it. This is a general-purpose replacement wherever a styled open-list matters more than the native control's zero-effort familiarity; a plain `select` (§4.3) remains valid for simple admin CRUD forms where the open-list appearance doesn't matter as much.*

**Closed state:** looks like a standard input/select per §4.3 — label above, bordered trigger button, placeholder or selected value, trailing chevron that rotates 180° when open.

**Open state:** an absolutely-positioned list directly below the trigger, `color-surface-raised` background, `radius-md`, `elevation-2`, `space-1` internal padding. Each option is a full-width row, `space-touch`-minimum height, `radius-sm` on hover/keyboard-focus (`color-surface-sunken` fill), and the currently-selected option shown in `color-brand-primary` medium weight.

**Interaction:** click the trigger to open; click an option or press Enter/Space to select and close; Arrow Up/Down moves a keyboard-focus highlight through options while open; Escape or a click outside the component closes without changing the selection. Implements the standard `listbox`/`option` ARIA pattern (`role="listbox"`, `aria-expanded`, `aria-selected`) so it isn't a regression in accessibility versus the native control it replaces.

### 4.19 PIN Keypad (on-screen numeric entry)

*Added Phase 2, replacing §4.16's boxed `PinInput` as the login screen's PIN entry method — the third PIN pattern tried for this one interaction (masked field → boxed digits → keypad), each superseded after review rather than layered on top of each other. `00_FOUNDATIONS.md` §1.3 previously ruled out number-pad-tile patterns as a non-goal; that bullet was removed once this pattern was approved for the login screen, since keeping a blanket rule with an exception baked in read as more confusing than just no longer stating the rule. `PinInput` (§4.16) is kept in the codebase for now as a still-valid, undeleted alternative; nothing currently reuses it.*

**Structure, top to bottom:**
1. **Display row** — N small circular dots (`14px`, matching the count in `docs/01_DATA_MODEL.md`'s PIN length), outlined and empty by default, filled solid `color-brand-primary` as digits are entered. This is a status indicator only, not an input — there's no cursor, no focus ring, nothing to tap here directly.
2. **Keypad grid** — a 3×3 grid of digit keys 1–9, plus a bottom row of [blank spacer] · [0] · [backspace icon]. Each key is a square button, `space-touch`-minimum, `radius-md`, `color-surface-sunken` fill (quiet, not a bordered "input" look), `figure`-scale tabular numeral centered. Pressed state: fill shifts to `neutral-300` plus a `motion-instant` (100ms) scale-down to 0.96 — the same tactile-press language as the Stepper (§4.4), since both are the same kind of fast, repeated, thumb-driven tap.

**Behavior:** tapping a digit key appends it to the PIN and fills the next dot; tapping backspace removes the last digit. All digit keys disable once the PIN reaches full length (mirrors the Stepper's disabled-at-limit principle, §4.4) rather than silently ignoring extra taps. No device keyboard is invoked at any point — this is a fully custom input surface, not an extension of the standard `Input`/`PinInput` family.

**Error state:** on a rejected PIN, the dots shift to `color-status-error` fill/border and a `body-sm` error message appears below the display row — same message-placement convention as every other form error in this system (§4.3, §4.7). No `motion-shake`, consistent with §4.1/§4.16's existing rule that shake stays reserved for oversell.

**Why this superseded the boxed-digit pattern:** in review, the boxed `PinInput` still relied on the device's own numeric keyboard appearing and disappearing, which shifts the whole page layout on mobile and reintroduces exactly the "typing on a small phone keyboard" friction a PIN-entry moment should avoid. A fully custom on-screen keypad removes the device keyboard from the interaction entirely, at the cost of the "no POS aesthetic" principle — judged worth it for a control used many times a day, in the same spirit as the Stepper being allowed a purpose-built interaction rather than a generic number input.

### 4.20 Search Bar

*Added Phase 4, for filtering long item/ingredient lists on `/entry` and `/store` — flagged as a real gap during that phase's review (the category-chip filter alone doesn't help once a category itself has many rows) rather than silently improvised. Built on Input's (§4.3) token language, not a new visual system.*

**Structure:** a single-line text field, no label-above (search fields conventionally don't need one — the leading icon plus placeholder carry that context), leading search icon (§4.21) at `color-text-secondary`, placeholder text ("Search items…"), trailing clear ("×", §4.21 `close`) button that only renders once the field has a value.

| State | Spec |
|---|---|
| Default | Same as Input default (§4.3): white fill, `color-border-default` 1px border, `radius-md` |
| Focus | Border shifts to `color-border-focus` (2px), same as Input |
| Has value | Trailing clear button appears, `space-touch`-minimum tap target, clears the field and returns focus to filtering the full list |

**Behavior:** filters the visible list client-side, case-insensitive substring match against item/ingredient name, live as the user types — no submit step, no network round trip (the full location-scoped catalog is already fetched for the entry screen; search never re-queries the server). Combines with the existing category-chip filter (§CategoryChips) as an *and* — narrowing by category and by search term both apply together, not one replacing the other. When the combined filter produces zero rows, the screen shows a plain-language empty message ("No items match…"), not a blank list — same "never a blank page" principle as §4.15's Empty States, though this is a lighter-weight inline message rather than the full Empty State treatment, since it's a transient filter state, not a genuinely empty catalog.

### 4.21 Icon set

*Added Phase 4, replacing Foundations §2.7's abstract "recommended set: Phosphor or Lucide" with a concrete, small, hand-authored vocabulary — flagged as a real gap when the bottom nav (§4.12) needed real icons and none existed anywhere in the codebase. A full icon package was deliberately not installed for ~10 glyphs; disproportionate against `CLAUDE.md`'s lean-dependency, no-recurring-cost posture for a product this size. Matches Foundations §2.7's stroke spec exactly (24×24 viewBox, ~1.8-2px stroke, `stroke="currentColor"`, rounded caps/joins, no fill) and follows the same hand-drawn-inline-SVG pattern already established by the login footer's WhatsApp/email glyphs and the Dropdown's chevron, rather than inventing a new authoring approach.*

**Component:** `components/Icon` — `<Icon name="entry" size={24} />`. Color is inherited via `currentColor`, so an icon recolors for free wherever it's placed (inactive/active nav states, dark-surface contexts) with no separate color prop.

**Current vocabulary** (12 glyphs, one per current consumer — extend deliberately, don't grow this speculatively ahead of an actual screen needing a new glyph):

| Name | Used for |
|---|---|
| `entry` | Staff bottom nav — Entry |
| `store` | Staff bottom nav — Store |
| `expenses` | Staff bottom nav — Expenses |
| `orders` | Reserved for Phase 6's Orders nav item (not yet wired into any shell) |
| `summary` | Staff bottom nav — Summary |
| `dashboard` | Admin bottom nav — Dashboard |
| `items` | Admin bottom nav — Items |
| `ingredients` | Admin bottom nav — Ingredients |
| `delivery` | Admin bottom nav — Delivery Locations |
| `staff` | Admin bottom nav — Staff |
| `search` | Search Bar (§4.20) leading glyph |
| `close` | Search Bar (§4.20) clear-field button |

**Sizing convention:** 22px in the bottom nav (slightly under the full 24px grid so the icon+caption stack doesn't feel top-heavy against the small label beneath it), 18px inside Search Bar (a smaller, denser control), 24px (the native grid size) everywhere else including the style guide's reference grid — call sites choose via the `size` prop, the underlying paths don't change.
