---
name: Prosper Financial Intel
colors:
  surface: '#faf9fb'
  surface-dim: '#dadadc'
  surface-bright: '#faf9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f3f5'
  surface-container: '#eeedef'
  surface-container-high: '#e8e8ea'
  surface-container-highest: '#e3e2e4'
  on-surface: '#1a1c1d'
  on-surface-variant: '#4c444d'
  inverse-surface: '#2f3032'
  inverse-on-surface: '#f1f0f2'
  outline: '#7d747e'
  outline-variant: '#cec3ce'
  surface-tint: '#735282'
  primary: '#1b002b'
  on-primary: '#ffffff'
  primary-container: '#331642'
  on-primary-container: '#a17db0'
  inverse-primary: '#e0b9ef'
  secondary: '#795900'
  on-secondary: '#ffffff'
  secondary-container: '#fed173'
  on-secondary-container: '#785800'
  tertiary: '#150b00'
  on-tertiary: '#ffffff'
  tertiary-container: '#322000'
  on-tertiary-container: '#b0822e'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#f6d9ff'
  primary-fixed-dim: '#e0b9ef'
  on-primary-fixed: '#2b0e3a'
  on-primary-fixed-variant: '#5a3b69'
  secondary-fixed: '#ffdf9f'
  secondary-fixed-dim: '#ecc164'
  on-secondary-fixed: '#261a00'
  on-secondary-fixed-variant: '#5c4300'
  tertiary-fixed: '#ffdeac'
  tertiary-fixed-dim: '#f3be63'
  on-tertiary-fixed: '#281900'
  on-tertiary-fixed-variant: '#604100'
  background: '#faf9fb'
  on-background: '#1a1c1d'
  surface-variant: '#e3e2e4'
typography:
  headline-lg:
    fontFamily: Manrope
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Manrope
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Manrope
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  data-tabular:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 48px
  container-max: 1440px
  gutter: 20px
---

## Brand & Style
The design system is engineered for high-stakes hotel management, where financial precision meets luxury hospitality. The brand personality is **Authoritative, Discerning, and Precise**. It balances the "Old World" luxury of a boutique hotel with the "New World" data requirements of modern asset management.

The visual style is **Corporate / Modern** with a high-density focus. It utilizes a dual-layered approach: 
- **The Executive Layer:** Uses Deep Aubergine and Gold accents for high-level summaries and "Hero" cards, evoking a sense of prestige.
- **The Analytical Layer:** Uses high-contrast, light-surface data grids and systematic spacing to ensure maximum legibility and information density for daily financial reporting.

## Colors
The palette is anchored by **Deep Aubergine**, used primarily for sidebars, header navigation, and primary action buttons. The **Gold Accents** are reserved for highlights, progress indicators, and "Premium" data insights.

- **Background & Surfaces:** A clean, slightly cool white (#FAF9FB) is used for the page background to reduce eye strain, while pure white (#FFFFFF) is used for data-containing cards and table rows.
- **Semantic Colors:** Success, Warning, and Error colors are desaturated to maintain a professional, sophisticated tone that doesn't feel jarring against the aubergine and gold palette.
- **Data Visualization:** When charting, use the primary aubergine as the anchor, followed by secondary gold, and then shades derived from the neutral palette to maintain a unified look.

## Typography
This design system utilizes a two-font strategy to separate intent. 

- **Manrope** is used for structural headings and brand-touchpoints. Its geometric nature provides a modern, high-end architectural feel.
- **Inter** is the workhorse for all data, body copy, and UI controls. 
- **Tabular Figures:** All numerical data, specifically currency, occupancy rates, and RevPAR metrics, **must** use `font-variant-numeric: tabular-nums`. This ensures columns of numbers align vertically for easier comparison.
- **Hierarchy:** Use `label-caps` for table headers and section metadata to provide a clear distinction from the data rows.

## Layout & Spacing
The layout follows a **Fixed-Fluid Hybrid** model. While the sidebar remains fixed at 260px, the content area expands up to a maximum width of 1440px to ensure data tables don't become excessively wide and difficult to scan.

- **Grid:** A 12-column system is used for dashboard layouts. High-level KPIs span 3 columns each (4 per row). Detailed reports typically span 8-12 columns.
- **Density:** To accommodate large financial datasets, a tight spacing rhythm (4px base) is used. Table row heights are set to a compact 40px or 48px to maximize vertical information density.
- **Mobile:** On devices < 768px, the 12-column grid collapses into a single-column stack. Sidebars transition to a bottom-tab bar or a hidden drawer menu.

## Elevation & Depth
Elevation is handled through **Tonal Layers** rather than heavy shadows to maintain a clean, professional aesthetic.

1.  **Level 0 (Background):** #FAF9FB - The foundation of the application.
2.  **Level 1 (Cards/Tables):** #FFFFFF - Pure white surfaces with a 1px border (#DBD7E0). No shadow.
3.  **Level 2 (Dropdowns/Modals):** #FFFFFF - Includes a subtle, diffused ambient shadow: `0px 4px 20px rgba(26, 22, 32, 0.08)`.
4.  **Level 3 (System Messages):** Slightly raised with a tinted shadow corresponding to the status (e.g., subtle green shadow for success) to draw immediate attention.

Use thin, horizontal hairlines to separate rows within tables instead of alternate-row striping to keep the UI "light" and airy despite the data density.

## Shapes
The shape language is **Soft and Professional**. 
- **Standard Radius:** 4px (0.25rem) is used for buttons, input fields, and small UI components to maintain a crisp, precise look.
- **Container Radius:** 8px (0.5rem) is used for main dashboard cards and modals to provide a slight visual softening.
- **Interactive Elements:** Checkboxes use a 2px radius, while Radio buttons remain fully circular.

## Components
- **Buttons:** 
    - *Primary:* Deep Aubergine background with White text.
    - *Secondary:* Transparent background with Gold #D19F48 border and text.
    - *Tertiary:* Ghost style (text only) using Secondary Text color.
- **Data Tables:** Headers use `label-caps` with a light grey background (#F3F1F5). Numeric cells are right-aligned. Text cells are left-aligned. Status indicators (Paid, Overdue, Pending) use subtle pill-shaped chips with desaturated background tints.
- **Input Fields:** 1px border (#DBD7E0) with 4px radius. Focus state uses a 1px Gold (#EABF63) border with a 2px soft gold glow.
- **KPI Cards:** For "Prosper Hotel" summaries, use a Deep Aubergine background with Gold accents for the main value and Success Green for the "vs last month" percentage.
- **Tabs:** Underline style using the Deep Aubergine for the active state, ensuring 2px thickness for high visibility.