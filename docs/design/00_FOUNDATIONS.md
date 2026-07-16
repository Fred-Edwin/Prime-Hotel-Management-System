# Prosper Hotel Management System — Design Foundations

**Read this when:** you need the design philosophy/rationale, or you're touching colors, type, spacing, layout, elevation, motion, or iconography — or you need the raw CSS custom-property tokens to build against.

**You don't need this file** just to look up a single component's spec — see `01_COMPONENTS.md` for that. You don't need this file for cross-screen visual patterns or the pre-ship checklist — see `02_PATTERNS_AND_CHECKLIST.md`.

---

## 1. Design Philosophy

### 1.1 The thesis

Prosper Hotel Management System replaces a business's Excel sheets and WhatsApp group with a tool their staff actually want to open. That's the whole brief, and it's harder than it sounds — most operational software earns trust through competence and loses it through friction, and this product has to earn both in the first five taps someone takes on it.

The philosophy here has two halves held in tension. The first half is **restraint**: a disciplined two-color palette (Prosper Hotel's own deep aubergine and gold, not a stock enterprise blue), flat surfaces, conventional and predictable interaction patterns, nothing decorative that doesn't earn its place. The second half is **speed under real pressure**: this is used on a phone, mid-shift, by someone counting real stock and real money, often in a hurry. Every design decision gets checked against both halves — restrained, but never at the cost of a cashier having to squint, guess, or double-check.

"Premium" in this context doesn't mean ornamental. It means the interface never makes someone doubt what they just did. Confident hierarchy, generous tap targets, a running total that's always visible, an error state that's impossible to miss — these are this product's version of luxury, in the same way a well-run hotel's luxury is a room that's quiet, not a room that's loud.

### 1.2 Guiding principles

1. **Legibility over elegance when they conflict.** If a beautifully restrained treatment makes a number harder to read at a glance on a mid-range Android phone in bright daylight, legibility wins. Every time.
2. **One brand color, one accent color, everything else neutral.** Prosper Hotel's deep aubergine and gold are spent deliberately, never as a rainbow of "on-brand" colors applied wherever something needs to stand out.
3. **No display typeface inside working screens — one narrow exception at the door.** Every interior screen (till entry, dashboard, catalog management) carries its brand entirely through color, spacing, and restraint, using only the two structural/data sans-serif families below — this is unchanged. **The login screen is the one deliberate exception** (added in Phase 2, see §2.2): a display serif is permitted there, and only there, for a single headline moment, because a login screen is a threshold a person crosses once per session, not a working surface they operate against — see §2.2's full rationale and the login pattern in `02_PATTERNS_AND_CHECKLIST.md` §5.
4. **Flat until it has a reason not to be.** Elevation communicates state, never decorates.
5. **Error-prevention is a design material.** This product explicitly must reject oversell attempts and make wastage, stock, and profit figures impossible to misread. Validation and warning states are treated with the same care as the primary path — not an afterthought bolted on later.
6. **Role and cadence should be visually legible.** A cashier logging today's till sales and a canteen assistant reconciling last week's stock are doing different kinds of work at different rhythms — the interface should feel different enough to signal that, without needing separate design languages.
7. **The grid is conventional; the surface is distinctive.** Interaction patterns stay predictable and low-risk; brand character lives in color, type weight, and spacing discipline — never in a novel interaction model.

### 1.3 Non-goals

This system is **not**:
- Illustrated or decorated **on interior/working screens** — no linework motif, no background texture on till entry, dashboard, or catalog screens. Every visual detail there earns its place through structure and type, not ornament. (The login screen carries one narrow exception — see §2.2 and §2.7.)
- Serif-anchored on interior screens — no working screen carries a display typeface. (Login is the one exception — see §2.2.)
- A dashboard-first product — while the admin profit view matters, most of this system's real usage is fast, repetitive, single-purpose data entry, and the design should never forget that its primary user is standing at a till, not sitting at a desk reviewing a report.

---

## 2. Foundations

### 2.1 Color System

#### Brand palette — sampled directly from the Prosper Hotel logo

| Swatch | Name | Hex | Role |
|---|---|---|---|
| Prime Aubergine | Prime Aubergine | `#1B002B` | Primary brand color as of Phase 10 (see §3's brand-color swap note) — sidebars, headers, primary buttons, focus/link color, active states. |
| Prime Aubergine Container | Prime Aubergine Container | `#331642` | Secondary/lighter brand tone — `--color-surface-dark` (hero bands), `--color-brand-primary-container` (e.g. active nav-item fill on a dark sidebar). This was the sole primary color before Phase 10. |
| Prime Gold | Prime Gold | `#EABF63` | Secondary/accent. Used on dark surfaces only — see accessibility note below. |
| Prime Gold Deep | Prime Gold Deep | `#D19F48` | Gold hover/active state, and gold used at smaller sizes where more contrast/weight is needed. |

**Accessibility note — this is a hard rule, not a suggestion:** Prime Gold (`#EABF63`) on white or any light background measures **1.63:1 contrast** — far below the 4.5:1 minimum for legible text. This is the single most important color rule in this document: **gold is never used as text or an icon color on a light surface.** Gold appears only as text/iconography on the dark aubergine surface (9.09:1 — excellent), or as a fill/background element (buttons, badges, borders) where text contrast is handled separately. Any temptation to use gold for a small UI label, a link, or an icon on a white background must be resisted — use aubergine or a neutral instead.

Aubergine on white measures 15.74:1 — exceptional contrast, safe for body text at any size.

#### Neutral scale — extrapolated to support UI needs

A cool, low-saturation neutral scale — deliberately not warm-leaning, because this palette's anchor (deep aubergine) reads best against a clean, near-white base rather than a cream one.

| Token name | Hex | Usage |
|---|---|---|
| `neutral-900` | `#1A1620` | Primary body text on light surfaces |
| `neutral-700` | `#4A4453` | Secondary text, labels |
| `neutral-500` | `#7C7686` | Placeholder text, disabled labels |
| `neutral-300` | `#DBD7E0` | Borders, dividers, input outlines |
| `neutral-100` | `#F2F0F5` | Subtle fills, hover states |
| `neutral-050` | `#FAF9FB` | Page background |
| `neutral-000` | `#FFFFFF` | Surface white / cards |

#### Semantic intent

| Intent | Color | Notes |
|---|---|---|
| Primary action | Prime Aubergine | Buttons, active nav, primary links |
| Brand accent | Prime Gold (on dark surfaces only) | Badges, dividers on dark bands, icon fills |
| Success | `#2E7D5B` (a clean forest green, deliberately outside the brand hue family) | Stock available, sale recorded, reconciliation complete |
| Warning | `#C17F1E` (amber, distinct from Prime Gold to avoid confusion with brand accent) | Low stock, approaching threshold |
| Error/destructive | `#B23B3B` | Oversell rejection, validation failure, wastage-critical flags |
| Info | `neutral-700` | Rarely used; most informational states default to neutral |

**Rule:** status colors are functional, never decorative. They never appear outside product UI — no status-colored marketing surfaces, no "fun" use of warning-amber as a design accent.

### 2.2 Typography

Two sans-serif families carry every interior/working screen — one for structure and UI, one for data and numerals — differentiated by role rather than character. A third, display, family exists solely for the login screen's headline — see below.

| Role | Typeface family | Usage |
|---|---|---|
| **Structural / UI sans** | **Manrope** — a geometric, slightly warm grotesque with distinct weight steps and a confident feel at heading size, without needing a serif to carry "premium" | Page titles, section headers, card titles, button text, nav, labels |
| **Data / numeric sans** | **IBM Plex Sans** (or **Inter**, as a safe substitute) — a highly legible, tabular-figure-friendly workhorse | Body copy, table cells, form input text, all monetary and quantity figures, timestamps |
| **Display (login only)** | **Fraunces** — a warm, high-contrast display serif with real optical weight at large sizes | The login screen's single headline ("Welcome back") only — see §1.2 principle 3 and the exception below. Never used inside a working screen. |

**Why two families instead of one (interior screens):** a single sans across every role is defensible, but at high-density numeric screens — a till entry grid with dozens of steppers and running totals — a small but real typographic contrast between "this is structure" (Manrope headings) and "this is data" (Plex Sans figures) helps a fast-moving user's eye separate the two without relying on color or weight alone.

**Why a third family exists at all (login exception, added Phase 2):** the original build deliberately carried no display typeface anywhere, on the reasoning that this product's brand should live in restraint, not ornament. In practice, the login screen — visited once per session, not a working surface — read as *unfinished* rather than *restrained* with no typographic moment of its own: a floating card on a flat background with no hierarchy above it. Fraunces is scoped narrowly: one headline, one screen, never inside `(staff)` or `(admin)` route groups. If a future screen is tempted to reach for it, that's a sign the "no display typeface" rule is eroding and needs a deliberate conversation, not a silent precedent.

**Numeral treatment:** All monetary and quantity figures use **tabular (lining) numerals** — critical for running totals and stock counts, where digits must align vertically as they update. If the chosen data font doesn't default to tabular figures, enable the `font-variant-numeric: tabular-nums` feature explicitly.

#### Type scale

| Token | Size / Line-height | Weight | Family | Usage |
|---|---|---|---|---|
| `heading-xl` | 28px / 36px | 700 | Manrope | Admin dashboard page title, top-level screen title |
| `heading-lg` | 22px / 30px | 700 | Manrope | Section headers ("Today's Sales", "Weekly Reconciliation") |
| `heading-md` | 18px / 24px | 600 | Manrope | Card titles, item-group headers |
| `heading-sm` | 15px / 20px | 600 | Manrope | Sub-labels, table group headers |
| `body-lg` | 16px / 24px | 400 | Plex Sans | Primary body text |
| `body-md` | 14px / 20px | 400 | Plex Sans | Table cells, list rows, form input text |
| `body-sm` | 13px / 18px | 400 | Plex Sans | Helper text, timestamps, secondary metadata |
| `figure-lg` | 32px / 38px | 600 | Plex Sans, tabular-nums | Dashboard headline numbers (net profit, total sales) |
| `figure-md` | 20px / 26px | 600 | Plex Sans, tabular-nums | Running total, stepper counts |
| `figure-sm` | 15px / 20px | 600 | Plex Sans, tabular-nums | Inline quantities, table numeric cells |
| `label` | 13px / 16px | 500 | Manrope | Form field labels |
| `caption` | 12px / 16px | 500 | Manrope, tracked +4% | Status text, small metadata |
| `overline` | 11px / 14px | 700 | Manrope, tracked +8%, uppercase | Section eyebrows, category labels |
| `display-lg` | 32px / 38px (38px / 44px ≥600px) | 600 | Fraunces | Login screen headline only — see §2.2's login exception. Never used elsewhere. |

#### Rules

- **Manrope is structural, Plex Sans is numeric/content.** A page title is always Manrope; the number inside a stat card is always Plex Sans with tabular figures. This split is the single typographic rule to enforce in review.
- No italics anywhere in this system — with no serif in play, italic has no natural role and would read as an inconsistency.
- Tracking (`overline`, `caption`) is used sparingly, only for genuine micro-labels — never as a general stylistic tic.

### 2.3 Spacing

An 8px base scale — a structural convention, not a brand expression.

| Token | Value |
|---|---|
| `space-1` | 4px |
| `space-2` | 8px |
| `space-3` | 12px |
| `space-4` | 16px |
| `space-5` | 20px |
| `space-6` | 24px |
| `space-8` | 32px |
| `space-10` | 40px |
| `space-12` | 48px |
| `space-16` | 64px |

**One addition specific to this product:** a `space-touch` token of **44px** — the minimum comfortable tap-target dimension for stepper buttons, checkboxes, and any control operated quickly, one-handed, on a phone. Every tappable control in the stock-entry flows must meet or exceed this, even where the visual element (e.g. a checkbox glyph) is smaller — padding makes up the difference.

### 2.4 Layout Grid

This build is **mobile-first, single-column by default** — there is no desktop split-panel or marketing-style layout anywhere in this product. Every screen is a working screen.

| Breakpoint | Layout | Notes |
|---|---|---|
| Mobile (< 600px) | Single column, full-width cards, sticky bottom action bar where relevant (e.g. running total + Save) | Primary target — staff's own phones |
| Tablet (600–1024px) | Single column content, max-width 640px, centered | Rare but supported (e.g. admin checking dashboard on a tablet) |
| Desktop (≥1024px) | Two-column for dashboard/reporting screens only (content + filters sidebar); single-column max-width 720px for all entry/reconciliation screens | Entry flows never benefit from extra width — constraining them keeps touch targets and scanning patterns consistent regardless of screen size |

Margins: 16px on mobile, 24px on tablet, 32px+ on desktop. No 12-column grid system is needed at this product's scale of layout complexity — flex/stack-based layouts are sufficient and simpler to keep consistent across a small number of screen types.

### 2.5 Elevation

Flat by default; elevation is used only to communicate real layering. **Flattened Phase 10** (values below tightened from the original v0.1.0 scale) to match the admin redesign's Google Stitch reference designs — applied site-wide, not admin-only, so the system stays internally consistent. Roles/usage are unchanged, only the shadow depth.

| Level | Shadow | Usage |
|---|---|---|
| `elevation-0` | none | Page background, resting cards, list rows |
| `elevation-1` | `0 1px 2px rgba(26,22,32,0.05)` | Sticky footer action bar (running total + Save), cards on a busy list |
| `elevation-2` | `0 2px 6px rgba(26,22,32,0.07)` | Dropdowns (staff/name selector), popovers |
| `elevation-3` | `0 6px 16px rgba(26,22,32,0.10)` | Modals (confirm delivery order, confirm wastage entry), Drawer (§4.22) |
| `elevation-4` | `0 12px 24px rgba(26,22,32,0.14)` | Toasts (save confirmation, oversell rejection) |

**One adaptation specific to this product:** the sticky bottom bar (running total + Save button, present through most of the daily entry flow) uses `elevation-1` permanently while scrolled — an exception to "flat until it has a reason," justified because this element is genuinely always floating above scrolling content and needs to read as such.

### 2.6 Motion

"Settled, not snappy" governs every transition in this system. One addition specific to this product's error-prevention principle:

| Token | Duration | Easing | Usage |
|---|---|---|---|
| `motion-instant` | 100ms | ease-out | Hover/tap feedback, stepper button press |
| `motion-fast` | 150ms | ease-in-out | Input focus, checkbox toggle, stepper count update |
| `motion-base` | 200ms | ease-in-out | Dropdown open/close |
| `motion-slow` | 300ms | ease-in-out | Modal enter/exit |
| `motion-shake` | 300ms | custom (2–3 cycle horizontal shake, ±4px) | Oversell rejection — a brief, unmistakable shake on the stepper/input that attempted to exceed available stock, paired with the error state color. This is the one deliberately more expressive motion in the system, justified because silent or purely-color-based rejection is too easy to miss on a small screen mid-rush. |

### 2.7 Iconography

Thin-stroke line icons, rounded caps, 24×24px grid, 2px stroke weight. Recommended set: Phosphor (Regular weight) or Lucide.

| Property | Spec |
|---|---|
| Default color | `neutral-700` |
| Interactive/active color | Prime Aubergine |
| On dark surfaces (e.g. nav, sticky footer) | White or Prime Gold, per the gold-on-dark-only accessibility rule |
| Status icons | Paired with semantic colors (§2.1) — success/warning/error, never brand colors |
| Badge treatment | 36×36px circle, sized for this product's dense mobile layouts, aubergine or gold fill, white icon — used sparingly, e.g. role indicator, delivery-order marker |

**Entry/brand-surface exception (added Phase 2):** interior working screens keep icons strictly functional per the table above — no decorative use, per §1.3. The login screen alone may use icons in a lightly decorative capacity (e.g. a support-contact icon next to a WhatsApp/email link in the footer) provided they stay within this same thin-stroke line-icon language — no filled/color illustration, no separate icon style invented for that one screen. This does not reopen §1.3's "no illustration" rule for interior screens; it only acknowledges that the login screen, like its typography (§2.2), is allowed one narrow threshold treatment.

No decorative icon badges used purely for visual rhythm — this product has no marketing-style surface where that pattern would apply.

---

## 3. Design Tokens

Tokens are named semantically by role (`color-brand-primary`, `space-touch`, `font-family-data`) rather than by raw value, so a future rebrand or theming pass only requires new values, never new names.

```css
:root {
  /* Color — brand
     Swapped Phase 10, per the admin redesign's Google Stitch design
     system spec (docs/design/reference-images/stitch-design.md): that
     spec's "primary" (#1B002B, near-black aubergine) is the DOMINANT
     color — sidebars, headers, primary buttons, focus/link color — and
     its "primary-container" (#331642, this token's original value) is
     the secondary/lighter tone, kept below as
     --color-brand-primary-container for that narrower role and
     unchanged as --color-surface-dark's value. Same hue family
     throughout — a dominance swap, not a rebrand. */
  --color-brand-primary: #1B002B;
  --color-brand-primary-hover: #12001C;
  --color-brand-primary-active: #0B0012;
  --color-brand-primary-container: #331642;
  --color-brand-accent: #EABF63;
  --color-brand-accent-deep: #D19F48;
  /* Reminder: --color-brand-accent is valid as text/icon color ONLY on dark surfaces. */

  /* Color — surface */
  --color-surface-page: #FAF9FB;
  --color-surface-raised: #FFFFFF;
  --color-surface-sunken: #F2F0F5;
  /* Matches --color-brand-primary as of Phase 10's dominant-color swap
     (see the brand block above) — sidebar and hero band read as one
     continuous dark surface rather than two different shades. */
  --color-surface-dark: #1B002B;
  --color-surface-overlay: rgba(26,22,32,0.48);

  /* Color — text */
  --color-text-primary: #1A1620;
  --color-text-secondary: #4A4453;
  --color-text-placeholder: #7C7686;
  --color-text-on-brand: #FFFFFF;
  --color-text-on-brand-accent: #EABF63;  /* gold text — dark surfaces only */
  --color-text-link: #1B002B;

  /* Color — border */
  --color-border-default: #DBD7E0;
  --color-border-focus: #1B002B;
  --color-border-error: #B23B3B;

  /* Color — neutrals */
  --neutral-900: #1A1620;
  --neutral-700: #4A4453;
  --neutral-500: #7C7686;
  --neutral-300: #DBD7E0;
  --neutral-100: #F2F0F5;
  --neutral-050: #FAF9FB;
  --neutral-000: #FFFFFF;

  /* Color — status */
  --color-status-success: #2E7D5B;
  --color-status-success-bg: #E6F2EC;
  --color-status-warning: #C17F1E;
  --color-status-warning-bg: #FBF0DD;
  --color-status-error: #B23B3B;
  --color-status-error-bg: #F8E9E9;
  --color-status-info: #4A4453;
  --color-status-info-bg: #F2F0F5;

  /* Color — status, dark-surface tints (added Phase 7). The plain
     status-success/status-error tokens above are tuned for light
     surfaces and fail WCAG text contrast on --color-surface-dark
     (2.7:1 / 3.1:1 — found when MetricCard's onDark variant was first
     combined with its trend prop for the admin dashboard's hero band, a
     pre-existing gap in the component spec never exercised before this
     phase, not something this phase introduced). These lightened tints
     (same hue family) pass ~9:1 on the aubergine surface. Used by
     MetricCard.tsx's onDark+trend combination — see Components §4.10. */
  --color-status-success-on-dark: #7FD9AE;
  --color-status-error-on-dark: #F0B4B4;

  /* Color — chart (added Phase 7, admin dashboard — see 02_PATTERNS_AND_CHECKLIST.md
     §5's "Admin dashboard" entry for usage rules). This system's brand
     palette has only two hues (aubergine, gold), not the 8-hue categorical
     set most chart guidance assumes -- these two slots are a validated
     two-series-only extension, not a general categorical ramp. Each mode
     picks the step of its base hue that clears the dataviz palette
     validator's lightness/chroma/CVD/contrast checks for that mode's
     surface (see the palette's own note below); never reuse
     --color-brand-primary or --color-brand-accent directly as a chart mark
     color -- both are tuned as near-black/near-white UI ink, not
     mid-tone data marks, and fail the validator's lightness band. */
  --color-chart-primary-light: #D19F48;   /* deep gold — light surfaces (chart-surface-page) */
  --color-chart-primary-dark: #B8863A;    /* deep gold — dark surfaces (chart-surface-dark) */
  --color-chart-secondary-light: #9B78BF; /* aubergine-family violet — light surfaces */
  --color-chart-secondary-dark: #9B78BF;  /* aubergine-family violet — dark surfaces */
  /* Validated via .claude/../dataviz skill's scripts/validate_palette.js:
     light mode ("#D19F48,#9B78BF" on #FAF9FB) and dark mode
     ("#B8863A,#9B78BF" on #331642) both pass lightness band, chroma
     floor, and CVD separation; both carry a contrast WARN on the gold
     slot against its surface, which is why every chart using these colors
     MUST ship direct value labels (never color-only identification) per
     the dataviz skill's non-negotiables — see the chart usage note in
     02_PATTERNS_AND_CHECKLIST.md §5. */

  /* Typography */
  --font-family-structural: "Manrope", -apple-system, sans-serif;
  --font-family-data: "IBM Plex Sans", "Inter", -apple-system, sans-serif;
  --font-family-display: "Fraunces", Georgia, serif;  /* login screen headline ONLY — see §2.2 */

  --font-size-heading-xl: 28px;  --line-height-heading-xl: 36px;
  --font-size-heading-lg: 22px;  --line-height-heading-lg: 30px;
  --font-size-heading-md: 18px;  --line-height-heading-md: 24px;
  --font-size-heading-sm: 15px;  --line-height-heading-sm: 20px;
  --font-size-body-lg: 16px;     --line-height-body-lg: 24px;
  --font-size-body-md: 14px;     --line-height-body-md: 20px;
  --font-size-body-sm: 13px;     --line-height-body-sm: 18px;
  --font-size-figure-lg: 32px;   --line-height-figure-lg: 38px;
  --font-size-figure-md: 20px;   --line-height-figure-md: 26px;
  --font-size-figure-sm: 15px;   --line-height-figure-sm: 20px;
  --font-size-label: 13px;       --line-height-label: 16px;
  --font-size-caption: 12px;     --line-height-caption: 16px;
  --font-size-overline: 11px;    --line-height-overline: 14px;
  --font-size-display-lg: 32px;  --line-height-display-lg: 38px;  /* 38px/44px at >=600px, see 02_PATTERNS_AND_CHECKLIST.md §5 */

  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  --letter-spacing-normal: 0;
  --letter-spacing-tracked: 0.04em;
  --letter-spacing-tracked-lg: 0.08em;

  /* Spacing */
  --space-1: 4px;    --space-8: 32px;
  --space-2: 8px;    --space-10: 40px;
  --space-3: 12px;   --space-12: 48px;
  --space-4: 16px;   --space-16: 64px;
  --space-5: 20px;   --space-touch: 44px;
  --space-6: 24px;

  /* Border radius — tightened Phase 10 (was sm:6/md:10/lg:16/xl:24),
     matching the admin redesign's Google Stitch reference for a flatter,
     crisper feel. Applied site-wide, not admin-only. */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;

  /* Shadow — flattened Phase 10, same reasoning as border radius above. */
  --shadow-elevation-0: none;
  --shadow-elevation-1: 0 1px 2px rgba(26,22,32,0.05);
  --shadow-elevation-2: 0 2px 6px rgba(26,22,32,0.07);
  --shadow-elevation-3: 0 6px 16px rgba(26,22,32,0.10);
  --shadow-elevation-4: 0 12px 24px rgba(26,22,32,0.14);

  /* Z-index */
  --z-index-dropdown: 100;
  --z-index-sticky: 200;
  --z-index-overlay: 300;
  --z-index-modal: 400;
  --z-index-toast: 600;

  /* Motion */
  --motion-instant: 100ms ease-out;
  --motion-fast: 150ms ease-in-out;
  --motion-base: 200ms ease-in-out;
  --motion-slow: 300ms ease-in-out;
  --motion-shake: 300ms cubic-bezier(.36,.07,.19,.97);

  /* Breakpoints */
  --breakpoint-mobile: 0px;
  --breakpoint-tablet: 600px;
  --breakpoint-desktop: 1024px;
}
```

---

*Next: `01_COMPONENTS.md` for the component library, `02_PATTERNS_AND_CHECKLIST.md` for cross-screen patterns and the pre-ship review checklist.*
