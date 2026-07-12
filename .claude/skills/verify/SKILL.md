---
name: verify
description: Verify a rendered screen (layout, positioning, visual state) against the real running app using a persistent headless browser — not by re-reading CSS/JSX and reasoning about what it "should" do. Use before claiming any layout/positioning/visual fix is done, per CLAUDE.md's "Verifying layout/visual fixes — don't guess, look" rule.
---

# Verify — headless-browser screen verification

CLAUDE.md has a standing rule (added after a real Phase 4 incident — a
sticky/fixed-positioning bug was "fixed" three times based on reasoning
about CSS from source, reported done each time, still broken all three
times) that any layout, positioning, or visual claim must be checked
against the actual rendered page before being reported as done. This
skill is the concrete mechanism for that check in this repo.

## When to use this

- Any time you change CSS/JSX affecting layout, positioning, or visual
  appearance, before saying "this is fixed."
- Any time a design-system conformance claim needs checking (e.g. "is
  this element visually distinguishable from its background") — some
  things (contrast, whether a band reads as a distinct surface) can only
  be judged from a real screenshot, not from token names.
- Any time you need to confirm role/location-scoped UI actually renders
  differently for different accounts (e.g. store-manager-emphasis
  variant, canteen vs. restaurant entry screens).

## One-time setup check (do this first, every session)

A persistent Playwright install lives at `.claude/tools/playwright/` —
committed `package.json` (pins the version), gitignored `node_modules`
(large, environment-specific, trivially reinstallable). Check whether
it's already usable before reinstalling anything:

```bash
ls .claude/tools/playwright/node_modules/playwright 2>/dev/null && echo "installed" || echo "needs install"
ls ~/.cache/ms-playwright/ 2>/dev/null && echo "browser cached" || echo "needs browser download"
```

If either is missing:

```bash
cd .claude/tools/playwright
pnpm install                          # always pnpm in this repo, never npm/yarn
npx playwright install chromium       # do NOT use --with-deps — it tries an
                                       # interactive sudo apt-get step that fails
                                       # non-interactively in this environment;
                                       # plain `chromium` works without it here
cd -
```

This is a one-time cost per environment, not per session — if a prior
session already did this, both checks above will already pass.

## Running a check

Use `scripts/verify-screenshot.mjs` — a thin wrapper that logs in as a
real seeded roster account via the API (not by driving the PIN keypad
UI, which is slower and not what you're testing), navigates to a route,
screenshots it, and optionally dumps an element's `boundingBox()`.

**Prerequisites:** the local Supabase stack must be running
(`npx supabase status`; if not, `npx supabase start` — requires Docker;
if Docker itself isn't available in this environment, stop and flag
that explicitly rather than skipping verification silently, per
CLAUDE.md) and the dev server must be running (`pnpm dev`, backgrounded).

```bash
# Basic screenshot of a route as a given roster role
node scripts/verify-screenshot.mjs --role sarah --route /entry

# With a bounding-box check (for pinning/positioning claims)
node scripts/verify-screenshot.mjs --role anne --route /entry --box ".bottomDock, [class*='bottomDock']"

# At the admin desktop breakpoint (768px+, per the design system)
node scripts/verify-screenshot.mjs --role admin --route /dashboard --width 768 --height 1024

# Full scrollable page, not just the viewport
node scripts/verify-screenshot.mjs --role sarah --route /entry --full
```

Available `--role` values (mirrors the real seeded roster in
`scripts/seed-staff.ts` — keep in sync if that file's PINs/names ever
change): `admin` (WaPrecious), `janiffer` (restaurant, store manager),
`sarah` / `mercy` (restaurant, cashier), `anne` (canteen).

Full flag reference is documented in the script's own header comment —
read that instead of duplicating it here.

## After running

Read the output PNG with the `Read` tool to actually look at it — don't
just check that the script exited 0. A screenshot that "saved
successfully" tells you nothing about whether the layout is correct;
you have to look. For positioning claims, also check the printed
`boundingBox()` numbers directly (e.g. does `y + height` equal the
viewport height, confirming a bottom-pinned element is actually pinned).

If a fix doesn't hold up on the first screenshot, the next move is to
inspect *why* (devtools-style: check computed styles, check whether a
CSS class is actually applied in the rendered DOM) — not to add another
layer of complexity on an unconfirmed diagnosis. See CLAUDE.md's full
incident writeup for why this matters.

## Cleaning up

Kill the dev server / stop the local Supabase stack when you're done
verifying if nothing else in the session needs them running — but this
is optional housekeeping, not required for the skill itself.
