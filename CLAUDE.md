# CLAUDE.md

This file is read automatically at the start of every Claude Code session in this repo. Keep it lean — full detail lives in `/docs`, linked below. Don't paste large blocks from those files back into this one.

---

## What this project is

**Prime Hotel Management System** (product name; the client business is **Prime Hotel**) — a mobile-first web app replacing a Kenyan restaurant + university canteen's manual Excel stock/sales/profit tracking. Two locations (restaurant with the main store, canteen), staff log stock/sales, admin (**WaPrecious**) gets automatic profit visibility. Budget-constrained: **no monthly hosting fees**, ever. This is a single-business system, not a SaaS product — no multi-tenant abstractions, ever.

Full product context (business problem, user journeys, success criteria): `docs/PRD.md`. Read it once at the start of a new engagement with this project, or whenever the "why" behind a requirement is unclear.

Real staff roster:
- **WaPrecious** — admin
- **Janiffer Maina** — restaurant, store manager (`is_store_manager = true`)
- **Sarah Makena** — restaurant, cashier & waiter
- **Mercy Wanjohi** — restaurant, cashier & waiter
- **Anne Gitonga** — university canteen staff

---

## Read order, every session

1. **The immediately-previous phase's context file** — `docs/phases/phaseX_context.md` (X = current phase number minus 1). This tells you the actual current state of the repo, what was built, what's still open. Read this before assuming anything. If no phase has completed yet (starting Phase 1), skip this step.
2. **`docs/04_PHASE_PLAN.md`**, the section for the phase you're working on. This is your task spec — goal, scope, exclusions, acceptance criteria, and the standard gating checklist you must satisfy before the phase is done.
3. **Only the reference doc(s) relevant to that phase** — see the pointer table below. Don't re-read everything every time; the phase's own section tells you what you need.
4. **Summarize back to the human** before writing code: current state, what this phase covers, anything that seems to conflict with the repo as it actually exists.

Full protocol for how phase context files work, and the exact format to write one in, is below in **"Context handoff between phases."**

---

## Non-negotiable constraints

- **No recurring cost.** Vercel (Hobby) + Supabase (free tier) only. Don't introduce a paid service.
- **Single business, not a SaaS.** No tenant/organization concept, no multi-business abstractions — see `docs/PRD.md` §2.
- **RLS is the real security boundary**, not just UI hiding. Every table has row-level security; staff are scoped to their own location, admin sees both. Verify by testing, not by reading the policy.
- **Prices are snapshotted onto each entry at write time** (`stock_entries`, `ingredient_entries`, `orders`/`order_items`), never referenced live from `items`/`ingredients`/`delivery_locations`. A later price or fee change must not silently alter past profit figures.
- **Two roles only: `admin` and `staff`.** The "store manager" is a `staff` account with an `is_store_manager` UI flag — not a third role, no separate RLS. See `docs/00_ARCHITECTURE.md` §5.1.
- **Restaurant tracks daily, canteen tracks weekly — but they're linked, not independent.** The restaurant sends a subset of items (`items.supply_type = 'canteen_supplied'`) to canteen daily; canteen's weekly `added_stock` for those items is the *sum* of the restaurant's daily `sent_out`, not a separate manual input. See `docs/00_ARCHITECTURE.md` §10 and `docs/01_DATA_MODEL.md` §3.1.
- **Opening stock is never a manual input.** System-populated from the prior period's closing stock (yesterday's, for restaurant; last week's, for canteen) — never retyped by staff.
- **Ingredients and menu items are tracked separately, with no formula linking them.** `ingredients`/`ingredient_entries` are their own tables, logged by the store manager on `/store`, restaurant-only. Don't build a bill-of-materials/yield calculation — deliberate V1 omission. See `docs/01_DATA_MODEL.md` §3.2 and `docs/00_ARCHITECTURE.md` §11.
- **Wastage is V1 scope.** Both `stock_entries` and `ingredient_entries` carry a `wastage` quantity + optional `wastage_note`, reduce closing stock, and produce a `wastage_value` shown as its own dashboard line — distinct from COGS and expenses. No reason-code enum. See `docs/01_DATA_MODEL.md` §3.3 and `docs/00_ARCHITECTURE.md` §12.
- **Delivery/pickup orders replace the client's WhatsApp process.** Staff log `orders` (customer name, delivery zone or pickup, items, quantities). Orders and till sales both feed `stock_entries.quantity_sold` **without either overwriting the other** — see the concurrency rule below, this is the single most important correctness property added after initial planning. Admin manages a `delivery_locations` catalog (zone + fixed fee); staff pick a zone, never type a fee. No order status/workflow, no rider assignment. See `docs/01_DATA_MODEL.md` §6.
- **Two writers, one stock figure — never overwrite, only increment.** `stock_entries.quantity_sold` has two contributors: `till_quantity_sold` (written only by the stock-entries route) and the sum of that day's `order_items`. Neither write-path ever sends an absolute "new total" — both call `public.recalculate_stock_entry()`, which re-derives `quantity_sold` from its two source numbers inside one transaction. Getting this wrong silently loses a sale or double-deducts stock. See `docs/01_DATA_MODEL.md` §3.4 — read it in full before touching `stock_entries` or `orders` write paths.
- **Order submissions are idempotent.** `orders.client_request_id` + `unique(created_by, client_request_id)` makes a retried "Save order" tap (flaky network, double-tap) a no-op, not a duplicate. Any order-creating route must generate/accept this and handle the conflict gracefully.
- **Auth is Name + PIN**, not email/password or phone. Names can collide — disambiguate with an auto-generated `staff_code`. Internally mapped onto Supabase Auth via a synthetic email (`user-{staff_code}@prosper.internal`) — the person never sees this.
- **No calculation logic duplicated.** All stock/profit math lives in one place: `lib/calculations.ts`.
- **Every table with an `updated_at` column has a `BEFORE UPDATE` trigger setting it automatically** (`public.set_updated_at()`) — never rely on application code to set it manually.
- Don't build anything listed as out of scope in `docs/PRD.md` §2 or `docs/04_PHASE_PLAN.md`'s "What's explicitly NOT in this phase plan" (debtor ledger, trend charts beyond period toggles, formal ingredient-to-menu-item recipes, order status/rider tracking, WhatsApp API integration) unless explicitly asked.

---

## Design system — mandatory for all frontend work

The design system is documented in `docs/design/`, split into three focused files so a session only loads what its task actually needs:

| File | Read when... |
|---|---|
| `docs/design/00_FOUNDATIONS.md` | You need the philosophy/rationale, or you're touching color, type, spacing, layout, elevation, motion, iconography, or need the raw CSS token block |
| `docs/design/01_COMPONENTS.md` | You're building or styling a specific component (button, input, stepper, card, badge, nav, modal, toast, empty state, etc.) |
| `docs/design/02_PATTERNS_AND_CHECKLIST.md` | You're building a full screen/flow and need cross-screen consistency notes, or a screen is about to be considered done and needs the pre-ship review checklist |

Phase 1 of the build (`docs/04_PHASE_PLAN.md`) implements this system as CSS custom-property tokens (`app/globals.css`, matching `00_FOUNDATIONS.md` §3 exactly) plus a base component library (`components/`, matching `01_COMPONENTS.md`).

**From Phase 1 onward, every phase's frontend work must:**
- Use only tokens defined in `00_FOUNDATIONS.md` / `app/globals.css` — no hardcoded hex colors, arbitrary pixel spacing, or one-off font declarations in page or component CSS.
- Reuse the base components from `components/` (Button, Input, Stepper, Card, MetricCard, etc.) per their `01_COMPONENTS.md` spec, rather than rebuilding equivalent markup/styling inline.
- Run the `02_PATTERNS_AND_CHECKLIST.md` §6 review checklist before considering any new screen done.
- If a screen needs a UI pattern the design system doesn't cover, **flag it explicitly** in that phase's context file as a gap for a human design decision — do not silently invent a new pattern and call it consistent.

### Building a real screen (Phases 3 onward — not Phase 1's token/component layer)

Whenever a phase involves designing and building an actual screen (not the reusable component library itself), work through it in this order:

1. **Adopt the mindset of the relevant domain expert for that specific screen** before writing any UI code — not just an engineer translating `docs/SCREENS.md` into JSX. Pick the expert lens that actually fits: e.g., a POS/retail UX specialist for the till entry screen (`/entry`), a data-visualization/reporting specialist for the admin dashboard (`/dashboard`), a forms/CRUD specialist for the catalog management screens (`/items`, `/ingredients`). State which lens you're using in your plan-back to the human before you start.
2. **Implement the screen** using that expert judgment — composition, information hierarchy, and interaction sequencing — while staying strictly within the design system's tokens/components (this step doesn't loosen the conformance rules above; it's about *how* those components get assembled into a screen, not license to deviate from them).
3. **Self-review the result against `02_PATTERNS_AND_CHECKLIST.md` §6** — both the aesthetic/philosophy checks and the functional/product-critical checks — as that expert would critique it, not just a mechanical pass/fail.
4. **Recommend improvements where you see a real opportunity**, distinct from the "flag it explicitly" design-system-gap rule above: that rule covers patterns the system *doesn't* cover; this is for things the system *already covers* but where a genuinely better screen-level decision exists (e.g., a clearer information hierarchy, a better default sort order, a more forgiving error-recovery flow). **Raise these directly to the human in conversation before moving on** — as explicit, numbered suggestions, asking whether to apply them now or defer — not just noted in the phase context file where they're easy to miss. **Do not silently build them.** Once the human responds, record the decision (applied / deferred / rejected, and why) in that phase's context file for the record — the context file documents the outcome of the conversation, it doesn't substitute for having it.

### Verifying layout/visual fixes — don't guess, look

A real incident during Phase 4 (see `docs/phases/phase4_context.md`): a sticky/fixed-positioning bug (a running-total bar not staying pinned to the viewport) was "fixed" three times based on reasoning about CSS box-model behavior from the source alone, reported as done each time, and was still broken on live testing all three times. The actual defect — a wrapper `<div>` whose CSS class existed but was never applied in the component's JSX — would have been visible in under a minute of real DOM inspection at any point. Each failed round cost a full edit → claim-fixed → human re-tests → still-broken cycle.

**The rule this produced:** for any layout, positioning, or visual bug — not just when a fix has already failed once — verify against the actual rendered page before claiming it's fixed, not against a mental model of what the CSS/markup *should* do:
- Use the `verify` skill (`.claude/skills/verify/SKILL.md`) — a persistent, gitignored Playwright install lives at `.claude/tools/playwright/` (not the scratchpad, not the project's own `package.json`, so it survives across sessions instead of being reinstalled every time), driven via `scripts/verify-screenshot.mjs` to log in as a real seeded roster account and screenshot/inspect a route in one command. The `run` skill is the alternative for driving the app more generally. Or ask the human for real devtools output (computed styles, `getBoundingClientRect()`, a screenshot).
- If a first attempt at a visual fix doesn't hold up, the next move is to **inspect why**, not to add another layer of complexity on top of an unconfirmed diagnosis. Escalating solution complexity (e.g., `sticky` → `fixed` with a hand-computed offset → a whole new state-management layer) without new diagnostic information is a sign to stop and look, not to try harder.
- This applies beyond CSS: any claim of the form "this should now work" that's cheap to actually verify and expensive to get wrong — a build passing, an API returning the right shape, a redirect firing — should be verified, not asserted, before reporting it to the human as done.

### Verifying data/logic/RLS correctness — curl, not a browser

The visual-verification rule above (headless browser, real DOM) is for questions only a rendered page can answer. Most correctness risk in this product is the *other* kind — RLS scoping, calculation formulas, oversell/idempotency checks, cross-location aggregation — and for that kind, a direct API call is the right tool, not a heavier browser-driven one:

- Use `curl` (or an equivalent direct HTTP call) against the route handlers, logging in via `POST /api/auth/login` with a real seeded roster account (see `scripts/seed-staff.ts` for the name/PIN pairs) and reading the raw JSON response / HTTP status code. This is how every RLS and calculation bug found in Phases 4–5 was actually caught — e.g. a same-day/same-week re-save returning `403` instead of `200`, an oversell attempt returning `409` with the right message, a cross-location aggregate summing correctly. None of these needed a browser.
- For anything requiring direct Postgres-level confirmation beyond what the API surfaces (e.g. proving RLS blocks a table read even though a `security definer` function built on that same data works) — impersonate the user's session directly against the local Supabase stack: `set role authenticated; select set_config('request.jwt.claims', '{"sub":"<uid>","role":"authenticated"}', true);` then query the table. This confirms the policy itself, not just what one route handler happens to expose.
- **Rule of thumb:** if the question is "did the write/calculation/access-check happen correctly," use `curl` (or direct SQL). If the question is "does a human looking at the rendered screen see the right thing," use the `verify` skill. Don't reach for Playwright to check a data/RLS claim — it's slower and adds no signal a JSON response doesn't already give you; don't reach for `curl` to check a visual claim — it can't see layout, contrast, or whether an element is actually pinned.
- Both are equally mandatory, not optional extras: a phase whose gating checklist says "RLS re-verified by testing" is not satisfied by reading the policy SQL and reasoning it looks correct, same as a layout claim isn't satisfied by reading the CSS and reasoning it should work.

---

## Stack, one line each

Next.js 14 (App Router, TypeScript strict) · CSS Modules (no Tailwind) · Supabase (Postgres + Auth + RLS) · Vercel hosting · Zod validation · pnpm.

The GitHub CLI (`gh`) is available and authenticated — use it directly for GitHub operations (PRs, issues, CI run status) rather than assuming it's unavailable.

---

## Project structure

Follow this layout exactly so code lands in a predictable place across phases/sessions.

```
prime-hotel-management-system/
├── CLAUDE.md
├── docs/
│   ├── PRD.md                      # Product requirements — read once per engagement
│   ├── SCREENS.md                  # Full screen/route inventory — who sees each screen, which phase builds it
│   ├── 00_ARCHITECTURE.md          # Stack rationale, auth model, environments, concurrency/orders commitments
│   ├── 01_DATA_MODEL.md            # Single source of truth for the database schema + calculations
│   ├── 04_PHASE_PLAN.md            # Build sequence, phase specs, gating checklist
│   ├── design/                     # Design system reference — 00_FOUNDATIONS.md, 01_COMPONENTS.md, 02_PATTERNS_AND_CHECKLIST.md
│   └── phases/
│       └── phaseX_context.md       # One file per completed phase — see "Context handoff" below
├── supabase/
│   ├── migrations/                 # One timestamped .sql file per migration
│   └── seed.sql                    # Dev-only seed data, clearly marked as such
├── app/
│   ├── layout.tsx
│   ├── globals.css                 # Design tokens as CSS custom properties (Phase 1)
│   ├── page.tsx                    # Redirects to /login or /entry based on auth state
│   ├── login/page.tsx
│   ├── (staff)/                    # Route group for staff-facing screens
│   │   ├── entry/page.tsx          # Restaurant daily / canteen weekly stock entry
│   │   ├── store/page.tsx          # Ingredient receiving/usage — store-manager-flagged restaurant staff only
│   │   ├── expenses/page.tsx
│   │   ├── orders/page.tsx         # Delivery/pickup order log
│   │   └── summary/page.tsx
│   ├── (admin)/                    # Route group for admin-only screens
│   │   ├── dashboard/page.tsx
│   │   ├── dashboard/ledger/page.tsx
│   │   ├── items/page.tsx
│   │   ├── ingredients/page.tsx
│   │   ├── delivery-locations/page.tsx
│   │   └── staff/page.tsx
│   └── api/
│       ├── stock-entries/route.ts
│       ├── ingredient-entries/route.ts
│       ├── expenses/route.ts
│       ├── orders/route.ts
│       ├── items/route.ts
│       ├── ingredients/route.ts
│       └── delivery-locations/route.ts
├── components/                     # Shared UI — Button, Input, Stepper, TillStrip, MetricCard, CategoryChips, BottomNav, etc.
├── lib/
│   ├── supabase/
│   │   ├── client.ts                # Browser client (anon key)
│   │   ├── server.ts                 # Server client (server components / route handlers)
│   │   └── types.ts                  # Generated Supabase types
│   ├── calculations.ts              # THE single source of stock/profit calculation math
│   ├── validation.ts                 # Zod schemas for all writes
│   └── auth.ts                       # Session helpers, role/location checks
├── middleware.ts                    # Route protection: auth redirect, role-gate admin routes
├── .env.local                       # Never committed
├── .env.example                     # Committed, no real values
├── package.json / pnpm-lock.yaml / tsconfig.json
└── README.md                        # Short pointer: "See /docs for architecture, data model, and phase plan"
```

**Naming conventions:** `PascalCase.tsx` for components, `camelCase.ts` for utility modules, `kebab-case` for route folders. CSS Modules co-located with the component/page they style (`entry.module.css` next to `page.tsx`), classes in `camelCase`. Database identifiers `snake_case`, matching `docs/01_DATA_MODEL.md` exactly — never rename a field in application code without updating that file. Route groups `(staff)`/`(admin)` are Next.js App Router syntax, not a typo.

**Decision guide for new code:**

| Building... | Goes in... |
|---|---|
| A page only staff see | `app/(staff)/.../page.tsx` |
| A page only admin sees | `app/(admin)/.../page.tsx` |
| A UI piece used on 2+ pages | `components/` |
| A UI piece used on exactly 1 page | Co-located in that page's folder |
| Stock/sales/profit math | `lib/calculations.ts` — never inline in a component or route handler |
| A Zod schema for validating input | `lib/validation.ts` |
| A new Supabase table or column | A new migration in `supabase/migrations/`, **and** update `docs/01_DATA_MODEL.md` in the same phase |

---

## Reference doc pointers

| Doc | Read when... |
|---|---|
| `docs/PRD.md` | You need the business "why" — user journeys, success criteria, non-goals |
| `docs/SCREENS.md` | You need the full list of screens/routes, who sees each one, and which phase builds it |
| `docs/00_ARCHITECTURE.md` | You need stack rationale, auth model detail, environment/hosting setup, or the concurrency/orders architectural commitments |
| `docs/01_DATA_MODEL.md` | You're touching the database — full SQL schema, RLS policies, calculation formulas, the §3.4 concurrency mechanism |
| `docs/04_PHASE_PLAN.md` | You need the whole build sequence, or the detailed spec/acceptance criteria for the phase you're on |
| `docs/design/*.md` | You're building or touching any UI — see the Design System section above for which of the three files to read |
| `docs/phases/phaseX_context.md` | Always — the immediately-previous phase's file is required reading before starting the next one |
| `.claude/skills/verify/SKILL.md` | You're about to check a layout/positioning/visual claim against the real running app — see "Verifying layout/visual fixes" above |
| `scripts/seed-staff.ts` | You need the real roster's name/PIN pairs to log in via `curl` for an RLS/data-correctness check — see "Verifying data/logic/RLS correctness" above |

---

## Context handoff between phases

This replaces what used to be a single cumulative `PROGRESS.md`. Instead, **each completed phase writes its own standalone file**: `docs/phases/phase1_context.md`, `phase2_context.md`, and so on.

### The rule: only the immediately-previous file is required reading

A session starting Phase N reads `docs/phases/phase{N-1}_context.md` — not the entire chain back to Phase 1. This keeps each session's required reading small and bounded as the project grows. The tradeoff: **anything from an earlier phase that's still load-bearing must be explicitly carried forward** by every phase's context file in between, not just described in its own scope. If Phase 2 made a decision Phase 6 needs to know, Phases 3, 4, and 5's context files must each re-state it (even briefly) as still-relevant — don't assume it survives silently just because it's true.

### What every `phaseX_context.md` must contain

```markdown
# Phase X — [name] — [date]

**Status:** Complete | Partial | Blocked

**What was built:**
- Specific bullet list — file names, features, migrations. Not vague summaries.

**Deviations from the phase plan:**
- Anything done differently than `04_PHASE_PLAN.md` specified, and why. "None" if nothing deviated.

**Gating checklist results:**
- Confirm each item from `04_PHASE_PLAN.md`'s standard gating checklist explicitly (tests pass, build passes, CI green, design-system conformance, RLS re-verified, deviations documented, design-system gaps flagged) — pass/fail per item, not a blanket "done."

**Challenges faced:**
- Anything that was harder than expected, any bug that took real effort to track down, any ambiguity that had to be resolved with a judgment call.

**Known issues / tech debt left behind:**
- Anything knowingly imperfect, deferred, or stubbed out.

**Carried forward from earlier phases:**
- Anything from Phase 1..N-1's context files that's still load-bearing for future phases — restate it here, don't assume it's still visible.

**Instructions for the next phase:**
- Anything the next phase specifically needs to know that isn't obvious from the docs alone.
```

### Rules
- **Never edit a previous phase's context file.** If something from an earlier phase turns out to be wrong, note the correction in the current phase's file — the record should read like a diary, not a wiki.
- **A phase is not done until its context file exists and its gating checklist is honestly filled in.** Don't write "Complete" if a checklist item actually failed — write "Partial" or "Blocked" and say exactly what's missing.
- **If a phase's acceptance criteria genuinely can't be met** (a dependency doesn't exist, a prior phase left something broken), stop and report — log it as "Blocked," don't work around it silently.
- **At the end of each phase, push the code to the GitHub `main` branch** (commit the phase's changes, including its `docs/phases/phaseX_context.md`, then `git push origin main`) and confirm the CI run is green (`gh run list --branch main --limit 1`) before considering the phase done.

---

## Rules for handling architecture/data-model changes mid-project

1. **Don't silently deviate in code while leaving the docs saying something else.** This is the most damaging failure mode for a multi-session project — the docs become lies, and every future session inherits false context.
2. Update the relevant doc (`docs/00_ARCHITECTURE.md` or `docs/01_DATA_MODEL.md`) directly, in the same phase where the change happens.
3. Note the change explicitly in that phase's context file, including the *reason*.
4. If the change affects future phases described in `docs/04_PHASE_PLAN.md`, update that file too and say so in the context file — don't let the plan and reality quietly diverge.
5. **Don't re-litigate settled decisions** (e.g., "should we use Tailwind instead?") unless the current phase's spec explicitly asks you to revisit it, or something has genuinely broken that traces back to that decision.
6. **Don't invent new tables, routes, or major structure** not described in `docs/01_DATA_MODEL.md` or this file's Project Structure section, without flagging it as a proposed change and updating those docs.
7. **Prefer finishing a phase's stated scope over gold-plating.** If time/context remains after meeting acceptance criteria, propose additions in the context file's "Instructions for the next phase" rather than silently building them.

---

## When something doesn't add up

If `docs/04_PHASE_PLAN.md` conflicts with the immediately-previous phase's context file, or a reference doc seems out of date with the actual repo — stop, flag it in your summary-back to the human, and update the doc rather than silently working around the mismatch.

If asked to draft a prompt by the user, always include the relevant role, and never draft the prompt as a file.

The user prefers that when you use a tasklist that you update as you progress when you are working on something so he can observe the progress.