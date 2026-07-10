# Phase 1 — Design System & Requirements — 2026-07-10

**Status:** Partial

Everything in scope is built, builds clean, and passes lint/typecheck — but the
logo asset (an explicit acceptance criterion) has not been supplied, so that
one line item cannot be marked done. See "Known issues" below.

**What was built:**
- Repo scaffold via `create-next-app`: Next.js 16.2.10, React 19.2.4, TypeScript strict, App Router, no Tailwind, pnpm, ESLint. Scaffolded into a temp dir and merged into the repo root (the target directory already contained `CLAUDE.md`/`docs/`, which `create-next-app` refuses to run against directly).
- `package.json` renamed to `prime-hotel-management-system`; `dev` script uses `next dev --turbopack` for faster local iteration (discussed with the user as a fast-build lever alongside pnpm's install speed).
- `app/globals.css` — full token block from `00_FOUNDATIONS.md` §3, transcribed verbatim (color, type scale, spacing, radius, shadow, z-index, motion, breakpoints), plus a small documented **"Implementation tokens" addendum** at the bottom (`--border-width-default: 1px`, `--border-width-focus: 2px`, `--border-width-accent: 4px`, `--measure-copy: 20rem`) — see "Deviations" below.
- `app/layout.tsx` — Manrope + IBM Plex Sans self-hosted via `next/font/google` (weights 500/600/700 and 400/500/600 respectively, `display: swap`), exposed as `--font-manrope` / `--font-ibm-plex-sans` CSS variables. `--font-family-structural` / `--font-family-data` in `globals.css` reference these variables rather than the literal family-name strings the doc's raw token block shows — see "Deviations."
- `app/page.tsx` — minimal placeholder (renders `<Wordmark />` only). Phase 1 explicitly excludes page-level screens; this is not `/login` or `/entry` routing, which is Phase 2 work.
- 13 base components in `components/`, each as `ComponentName/ComponentName.tsx` + `ComponentName.module.css` + `index.ts`, re-exported from `components/index.ts`:
  - `Button` — primary/secondary/tertiary/destructive variants, 44px min-height, full-width option.
  - `Input` — label-above-field, error state, numeric/tabular variant, focus/disabled states.
  - `Stepper` — the core till/reconciliation control: min/max clamping, disabled-at-limit (oversell prevention before rejection), `motion-shake` + auto-dismissing limit message on an attempted over-tap.
  - `TillStrip` — sticky running-total bar, permanent `elevation-1`, `motion-fast` background flash on total change, integrated Save button.
  - `Card` — flat by default, `elevation-1` on hover only when `interactive`.
  - `MetricCard` — stat-card variant of Card; `onDark` prop for the admin-dashboard hero band use case (§5), trend indicator using semantic color tokens only.
  - `RoleLocationBadge` — `location` (neutral, staff) and `admin` (aubergine fill) variants.
  - `PeriodToggle` — segmented pill control, Today/Week/Month-style.
  - `LowStockIndicator` — `dot` and `pill` variants, warning-amber only, never gold (per §4.9's explicit rule).
  - `Modal` — portal-rendered, Escape-to-close, `elevation-3`, `motion-slow` enter animation.
  - `Toast` — status-colored left bar (success/warning/error/info), `elevation-4`, auto-dismiss.
  - `EmptyState` — matches §4.15's spec exactly: icon/heading/body/optional action, neutral tones only, never reuses error visual language.
  - `CategoryChips` — **flagged placeholder**, see "Design-system gaps" below.
  - `Wordmark` — text wordmark in Manrope with an optional `logoSrc` prop for when the real logo asset lands; `onDark` variant for dark-surface nav/footer use.
- `public/logo/` created (with `.gitkeep`) as the intended home for the logo asset once supplied.
- A live HTML style-guide artifact was published on request, rendering the actual tokens/components for visual review (not part of the repo; a one-off deliverable for the human to inspect the system, using the same hex values and self-hosted fonts as the real app).

**Deviations from the phase plan:**
1. **Next.js/React major version.** `CLAUDE.md`'s stack line says "Next.js 14"; `create-next-app@latest` installed Next.js 16.2.10 / React 19.2.4 (the current stable versions as of this session). App Router, TypeScript strict, and no-Tailwind are all satisfied — only the major version number differs. Not silently changed: flagging here per the mid-project change-handling rule. Recommend updating `CLAUDE.md`'s stack line in a future phase if this is acceptable, or pin to Next 14 explicitly if there's a reason (e.g., a Vercel Hobby-tier constraint) I'm not aware of.
2. **Font-family token values point at CSS variables, not literal family-name strings.** `00_FOUNDATIONS.md` §3 writes `--font-family-structural: "Manrope", -apple-system, sans-serif;`. Using that literal string would silently fall back to system fonts, because no CDN-loaded or system-installed Manrope exists — it would defeat the self-hosted-via-`next/font` requirement in `00_ARCHITECTURE.md` §6 and `04_PHASE_PLAN.md`'s Phase 1 scope line. I instead set `--font-family-structural: var(--font-manrope), -apple-system, sans-serif;`, where `--font-mananrope` is the CSS variable `next/font/google` generates and injects on `<html>`. This is a necessary implementation detail, not a change to the documented type system — the same two typefaces, same roles, same fallback chain intent.
3. **Added four "implementation tokens" not present in `00_FOUNDATIONS.md` §3**: `--border-width-default` (1px), `--border-width-focus` (2px), `--border-width-accent` (4px), `--measure-copy` (20rem/320px). The acceptance criterion "every component uses only `var(--token-name)` references — zero hardcoded hex/px, verified by grep" surfaced several places where `01_COMPONENTS.md`'s own component specs name a pixel value (Inputs §4.3: "2px focus border"; Toast §4.14: "left-edge status-color bar" — 4px was my reading of "the same weight as a standard rule but heavier"; a readable body-copy measure for EmptyState/Modal) that §3's token block never defines. Rather than leave raw px in component CSS (a stricter violation) or silently invent unlabeled magic numbers, I added a small, clearly-commented addendum to the token block, following the exact precedent `01_COMPONENTS.md` §4.15 set for empty-states: flag the gap, extend the docs, don't override anything that already existed. **This needs a human design decision** — confirm the border-width scale and copy-measure value, or replace them with different ones; nothing else in the token system depends on my specific choices here.
4. Package name changed from the scaffold's default `prime-scaffold` to `prime-hotel-management-system` (not a "deviation" from any doc value, just noting the rename).

**Gating checklist results:**
- [PASS] **Automated tests for core logic, passing.** N/A this phase — Phase 1 has no calculation, validation, or RLS-dependent logic to test (those don't exist until Phase 2+). No test suite was scaffolded yet; discussed with the user that Vitest (not Jest) is the intended choice when Phase 2 introduces testable logic, for faster cold-start/watch performance.
- [PASS] **`pnpm build` succeeds with zero errors.** Confirmed twice (before and after removing a temporary preview route used for manual verification). TypeScript strict mode; zero `any` anywhere in the codebase (none was needed).
- [N/A] **CI pipeline green.** Per `04_PHASE_PLAN.md`, CI is stood up in Phase 2 — not required yet.
- [PASS] **Frontend work uses only design-system tokens/components.** Verified by grep across every `components/*.module.css`: zero raw hex colors, zero raw px/rem/em values, zero raw `rgba()` — every value is a `var(--token-name)` reference. (Two genuine gaps required extending the token set rather than hardcoding — see Deviation 3 above, flagged not silently worked around.)
- [N/A] **RLS re-verified by testing.** No backend/data access exists yet — nothing to verify.
- [PASS] **Deviations documented with reasons.** See above.
- [PASS] **Design-system gaps flagged, not silently improvised.** See below.

**Challenges faced:**
- `create-next-app` refuses to scaffold into a non-empty directory, and this repo already had `CLAUDE.md` + `docs/`. Worked around by scaffolding into a scratch temp directory and merging the generated files in, rather than deleting/moving the existing docs.
- The App Router treats any folder prefixed with `_` as private (excluded from routing) — a `_preview` route I built for manual visual verification silently 404'd until renamed to `preview-demo`. Not a repo-facing issue (the route was temporary and has been deleted), but worth remembering for anyone tempted to use `_`-prefixed folders for non-routed helper code inside `app/`.
- No headless browser/screenshot tooling was available in this environment, so visual verification of the component library was done via: (a) a temporary in-app preview route, checked for 200 responses and correct SSR'd markup/text content via curl, and (b) a separately published static HTML artifact (outside the repo) that ports the same token values and component markup for the human to inspect directly in a browser. Both approaches confirm rendering and token-wiring correctness; neither substitutes for the human's own visual sign-off, which is expected before Phase 2 begins building real screens on top of this layer.
- The design system's token block (§3) doesn't cover every raw value its own component specs (§4) reference (border widths, a body-copy measure). This took a moment to notice because the failure mode is subtle — a component can *look* correct while still hardcoding a pixel value the grep check would catch. Resolved by extending the token set narrowly and documenting why, per the existing §4.15 precedent.

**Known issues / tech debt left behind:**
- **Logo asset is not in place.** The user confirmed no logo file exists yet and will supply it later. `Wordmark` renders a text-only wordmark ("Prime Hotel" in Manrope, matching §4.1/§4.12's "no illustrated lockup" rule) and accepts an optional `logoSrc` prop for when the asset lands; `public/logo/` exists (with `.gitkeep`) as its intended home. **This is the one Phase 1 acceptance criterion not met** — "Logo asset is in place and renders correctly" — hence Status: Partial rather than Complete. No code change should be needed to close this out, just dropping the file at `public/logo/` and passing `logoSrc` where `Wordmark` is used (or embedding it directly in the component if a single canonical usage emerges).
- The four "implementation tokens" (Deviation 3) are my best-effort reading of the component specs' prose, not confirmed design decisions — flagged above for human review.
- `CategoryChips` has no dedicated spec in `01_COMPONENTS.md` (see Design-system gaps below) — built as an honest placeholder, may need revision once a real spec exists.
- No automated visual regression / component test harness exists yet (e.g., Storybook, Chromatic) — out of scope for Phase 1 per the plan, but worth considering before Phase 3+ starts producing many screens against this library.

**Design-system gaps flagged (for human design decision):**
1. **`CategoryChips`** — `04_PHASE_PLAN.md` and `01_COMPONENTS.md` both name it as a component to build, but `01_COMPONENTS.md` has no dedicated `§4.x CategoryChips` section (unlike every other listed component). I built a placeholder borrowing the pill/chip visual language already established by `PeriodToggle` (§4.8) — `neutral-100`/border track, aubergine active fill, `radius-full`. This is clearly commented in `CategoryChips.tsx` as a flagged gap. It is *functional* and *token-compliant*, but its exact visual treatment (single-select vs. multi-select chip semantics, whether it should look more like a filter chip than a toggle) hasn't been confirmed by a real spec.
2. **Border-width and copy-measure tokens** (Deviation 3) — added to close the "zero hardcoded px" gate, but their specific values (1px/2px/4px border scale, 20rem measure) are my judgment call, not a documented decision.

**Carried forward from earlier phases:**
- N/A — this is Phase 1, nothing precedes it.

**Instructions for the next phase:**
- Phase 2 (Foundation, Auth & CI/CD) should read this file in full before starting, per `CLAUDE.md`'s protocol.
- The design tokens and 13 base components are ready to use as-is. Import from `@/components` (barrel export) or individual `@/components/ComponentName` paths.
- Before building the login screen, resolve the logo situation if the asset has arrived by then — otherwise proceed with `Wordmark`'s text fallback, which is a fully valid, spec-compliant brand presence on its own (§4.1: "the login screen's only brand presence is the wordmark/logotype... in Manrope").
- If Phase 2 needs a component this library doesn't cover, check `01_COMPONENTS.md` first — if genuinely absent, flag it the same way `CategoryChips` was flagged here rather than inventing untracked styling.
- Vitest is the intended test runner when Phase 2 introduces the first testable logic (calculation functions, Zod validation, RLS behavior) — chosen for fast cold-start/watch-mode performance over Jest, discussed with the user during this phase but not yet installed (nothing to test yet).
- `next dev --turbopack` and pnpm are already wired up for fast local iteration; extend this in Phase 2 by caching `~/.pnpm-store` and `.next/cache` in the GitHub Actions CI pipeline, keyed on the lockfile hash, so CI builds stay fast as the codebase grows.
