# Prosper Hotel Management System — System Architecture

**Project:** Prosper Hotel stock, sales & profit tracking system (product name: Prosper Hotel Management System)
**Status:** Pre-build reference document
**Last updated:** Pre-Phase 1 (planning)

> Read this file first, in every new Claude Code session, before touching code. It does not change often. If you find yourself about to make an architectural decision that contradicts this file, stop and flag it instead of silently deviating.

---

## 1. What this system is

A mobile-first web application replacing Prosper Hotel's manual Excel-based stock, sales, and profit tracking across two locations (a restaurant with a central store, and a university canteen). Staff log stock and sales daily (restaurant) or weekly (canteen); the admin (WaPrecious) sees automatically calculated profit and a simple dashboard, without manually consolidating spreadsheets. Staff also log delivery/pickup orders (see §13), replacing a WhatsApp-coordinated process.

Full business context lives in `PRD.md` — not repeated here. This file is about **how the system is built**, not why.

---

## 2. Guiding constraints (do not violate without flagging)

1. **No monthly hosting cost.** The client will not pay recurring fees. Every service chosen must have a free tier sufficient for this business's scale (2 locations, ~6 staff, low hundreds of line-item entries per day at most).
2. **Simple, excellent UI/UX.** This is the entire value proposition over Excel. Prefer fewer screens, larger tap targets, and instant feedback over feature density.
3. **No legacy data to migrate.** The system starts clean. Don't build import/migration tooling.
4. **Two tracking cadences, by design, not bug:** restaurant = daily stock entry, canteen = weekly stock entry. Do not unify these unless explicitly told to. The two are linked, not independent — the restaurant sends a subset of items to canteen **daily**, but canteen only reconciles **weekly**, so canteen's weekly entry must aggregate seven days of the restaurant's daily transfers. See §10 and `01_DATA_MODEL.md` §3.1.
5. **Role-based access is a V1 requirement**, not a phase-2 nice-to-have — every entry must be attributable to the staff member who made it, and staff must only see/edit their own location.

---

## 3. Tech stack (pinned)

| Layer | Choice | Notes |
|---|---|---|
| Frontend framework | **Next.js 14+, App Router** | Server components by default; client components only where interactivity requires it (forms, steppers) |
| Language | **TypeScript** | Strict mode on. No `any` without a comment explaining why. |
| Styling | **Plain CSS Modules** (`*.module.css`) | No Tailwind, no component library. Matches the approved mockup's hand-built aesthetic. Global tokens (colors, spacing, radii) live in `app/globals.css` as CSS custom properties — see §6. |
| Database | **Supabase (Postgres)** | Free tier. Also provides row-level security (RLS), which we use to enforce location-scoping at the database layer, not just in application code. |
| Auth | **Supabase Auth** | Name + PIN login (implemented as email-shaped identifier internally, since Supabase Auth requires email+password — see §5 and `04_PHASE_PLAN.md` Phase 2 for the concrete approach). Do not build custom auth/session handling. |
| Hosting (frontend) | **Vercel (Hobby/free tier)** | Deploys directly from the GitHub repo. |
| Hosting (backend) | **Supabase (free tier)** | Database + Auth + auto-generated REST/RPC via Supabase client libraries. No separate custom backend server. |
| API layer | **Next.js Route Handlers** (`app/api/.../route.ts`) where server-side logic is needed beyond direct Supabase client calls (e.g., calculations, validation) | Keep thin. Most reads/writes go through the Supabase JS client directly from server components or route handlers. |
| Form/validation | **Zod** | Schema-validate all writes before they hit Supabase. |
| Package manager | **pnpm** | Keep it boring. No npm/yarn switching mid-project. |

### Explicitly not used (and why)
- **No Redux/Zustand/global client state library** — the app's state is mostly server data (Supabase) plus small local UI state (stepper counts before save). React state + server components is enough.
- **No ORM (Prisma, Drizzle)** — Supabase's generated types + the Supabase JS client are sufficient at this scale. Adding an ORM adds a second source of schema truth to keep in sync.
- **No mobile app / React Native** — explicitly a mobile-first *web* app (see client requirement). Do not suggest a native app path.

---

## 4. High-level architecture diagram (described)

```
┌─────────────────────────────┐
│  Staff phone / Admin laptop │
│   (browser, mobile-first)   │
└──────────────┬───────────────┘
               │  HTTPS
┌──────────────▼───────────────┐
│   Next.js app on Vercel      │
│  - Server components (reads) │
│  - Route handlers (writes/   │
│    calculations)             │
│  - Client components         │
│    (steppers, forms)         │
└──────────────┬───────────────┘
               │  Supabase JS client
               │  (service role only in
               │   trusted server contexts)
┌──────────────▼───────────────┐
│         Supabase             │
│  - Postgres (data)           │
│  - Auth (login/session)      │
│  - Row-Level Security        │
│    (location + role scoping) │
└───────────────────────────────┘
```

There is no separate backend server, no message queue, no background job runner. This is a CRUD app with calculated fields computed at write-time. Keep it that way unless a specific future requirement forces otherwise.

---

## 5. Authentication & authorization model

- **Authentication**: Supabase Auth handles login. Login UX is **Name + PIN** (4–6 digit), not email + password — matches how staff will realistically use this on a shared or personal phone.
  - **Names are not guaranteed unique** (two staff could share a first name), so every user is also assigned a short auto-generated **staff code** (e.g., a 2-digit number) at account creation. The login screen shows a name picker/list including the staff code where names collide (e.g., "John (04)"), so the person selects unambiguously, then enters their PIN. This is a UI-level disambiguation only — see `01_DATA_MODEL.md` for how it's actually stored and mapped onto Supabase Auth's required email+password shape.
  - Do not build custom session/auth handling — Supabase Auth remains the source of truth for sessions.
- **Authorization**: Two roles — `admin` and `staff`. There is **no third role for the store manager** — see §5.1.
  1. **Postgres Row-Level Security (RLS) policies** — the source of truth. Even if application code has a bug, staff cannot read/write another location's data or edit historical entries, because the database itself refuses it.
  2. **Application-level UI gating** — hiding/emphasizing controls appropriately, purely for UX clarity (not relied upon for security).
- Every row in `stock_entries` and `expenses` stores `created_by` (the authenticated user's id). This is set server-side from the session, never trusted from client input.

### 5.1 Store manager — a responsibility, not a role

One restaurant staff member is designated "store manager" — responsible for logging goods received into the main store (`added_stock`) and stock dispatched to the canteen (`sent_out`), on top of normal staff duties. This is **not** a distinct permission tier:
- Same `staff` role, same location scoping, same RLS policies as any other restaurant staff member.
- Represented by a simple `is_store_manager boolean` flag on `public.users` (see `01_DATA_MODEL.md`), used only for UI purposes — e.g., showing a "Store manager" badge, and defaulting the entry screen to emphasize the "Added stock" / "Sent to canteen" fields for that person, while other restaurant staff see those fields de-emphasized (still visible/usable, not hidden — anyone can still use any field, this is about who is expected to, not who is allowed to).
- Do not create a `store_manager` value in the `user_role` enum. Do not write a separate RLS policy for it. If a genuine permission difference is needed later, that's a deliberate future decision, not something to infer from this note.

---

## 6. Design system — deliberately undefined here

There is no fixed palette, type scale, or component spec pinned in this document. An earlier draft prescribed exact tokens (colors, fonts, spacing values); it was deliberately removed so a designer — human or agent — can make real creative decisions grounded in the product's actual constraints (the business described in `01_DATA_MODEL.md`, the users and journeys, the "enterprise-grade software wearing approachable clothes" brief) rather than assembling a pre-picked list. Whatever fonts and colors get chosen, they should still be self-hosted (via `next/font`, not a CDN) once implementation starts, to stay dependency-free — that's a technical constraint, not a design one.

---

## 7. Environments

| Environment | Purpose | Supabase project | Vercel deployment |
|---|---|---|---|
| **Local dev** | Day-to-day development | Local `.env.local` pointing to a dev Supabase project | `next dev` |
| **Production** | What WaPrecious and staff use | Production Supabase project (separate from dev) | Vercel production deployment, auto-deployed from `main` branch |

Do not develop against the production Supabase project. Two free Supabase projects cost nothing; mixing dev and prod data is a needless risk.

Environment variables (never commit these):
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=       # server-only, never exposed to client
```

**`.env.local` holds local-dev credentials only — never production ones, even temporarily.** Production Supabase credentials (needed occasionally for a one-off script that must target production directly, e.g. `scripts/seed-data/*.mjs`) live in a separate `.env.prod-credentials.local` (gitignored, same as every `.env*` file, but not one Next.js or any script auto-loads). This split exists because of a real incident (Phase 9): both sets of credentials briefly lived in `.env.local` under near-identical variable names, and `dotenv`'s "last duplicate key wins" parsing meant every local script silently authenticated against **production** instead of local dev — a full local-dev-auth outage for a session, see `docs/phases/phase9_context.md`. A prod-targeting script must load `.env.prod-credentials.local` explicitly or receive the values as inline command-line env vars — never by relying on `.env.local`'s automatic loading to happen to have them.

---

## 7.1 Timezone: everything is Nairobi time, not server time

The business operates entirely in Nairobi (Africa/Nairobi, UTC+3, no DST — the offset never changes). Vercel serverless functions default to **UTC**, and a bare `new Date()`/`toISOString()` on the server is therefore up to 3 hours behind Nairobi wall-clock time — e.g. an order placed at 01:00 Nairobi time would be dated to the previous day if the server used raw UTC.

**The rule:** any code that needs "what is today's date / this week / this instant, right now" — not a date already supplied by the client or read from the database — must go through `nairobiNow()` / `nairobiToday()` in `lib/calculations.ts`, never `new Date()` directly. This applies on both the server (API routes) and the client (staff-facing forms defaulting to "today"), so a phone whose system timezone isn't set to Nairobi doesn't silently disagree with the server either.

`nairobiNow()` returns a `Date` shifted by a fixed +3h so its UTC getters (`getUTCFullYear()`, etc.) read as Nairobi wall-clock time — the same pattern `weekStartMonday`/`weekEndSunday` already use internally for date-only math (see §3.1 in `01_DATA_MODEL.md`). Because Nairobi has no DST, this fixed offset never needs to change and doesn't require ICU timezone data or a library.

This does **not** apply to formatting an already-known date-only value (a stored `date` column, a `YYYY-MM-DD` string) for display — those are correctly formatted with `timeZone: "UTC"` against a synthetic UTC-midnight `Date`, treating the string as a calendar date with no timezone component of its own, not as an instant needing a real-world timezone conversion.

---

## 8. Free-tier limits to be aware of (revisit if the business grows)

- **Supabase free tier**: project pauses after 7 days of inactivity (auto-resumes on next request, ~few seconds cold start) — acceptable for a daily-use business tool. 500MB database storage — far more than this app will need for years at this data volume.
- **Vercel Hobby tier**: sufficient for this traffic level (a handful of users, low request volume). Commercial/team use technically requires a paid plan under Vercel's terms if the business scales significantly — worth a one-line disclosure to the client, not a blocker now.

---

## 9. What "done" looks like for the architecture (not the product)

- Repo deploys to Vercel with zero manual server configuration.
- Supabase RLS policies are the enforced boundary for data access, verified by attempting (and failing) a cross-location read as a staff account — **with the single deliberate exception** described in §10 (canteen's narrow read of restaurant `sent_out` totals via a security-definer function, not a broadened table policy).
- No secrets committed to git.
- Every phase in `04_PHASE_PLAN.md` references this file rather than re-explaining the stack.

---

## 10. Stock continuity: carry-forward and the restaurant→canteen supply link

This is the part of the system that actually replaces the manual labor in the client's Excel process — get it wrong and the app just becomes a digital version of the same busywork. Full schema/RLS detail lives in `01_DATA_MODEL.md` §3.1; this section states the behavior as an architectural commitment.

- **Opening stock is never a manual input.** Every new stock entry's `opening_stock` is system-populated from the prior period's `closing_stock` for that item + location (yesterday's close for restaurant, last week's close for canteen). Staff see it as read-only context, never as a field they type into. This is the direct fix for the old workflow's "hand-copy yesterday's numbers" habit.
- **The restaurant supplies a subset of items to canteen, daily, even though canteen only reconciles weekly.** Items are tagged with a `supply_type` (`restaurant_only` / `canteen_supplied` / `canteen_independent`) precisely so the system knows which items need this link and which don't (canteen's cyber/retail lines, for example, have no restaurant-side counterpart at all).
- **Canteen's `added_stock` for `canteen_supplied` items is not typed by canteen staff** — it's the sum of the restaurant's daily `sent_out` figures for that item across the week, fetched via a narrow, purpose-built read (`public.canteen_supplied_total()`, a `security definer` function returning one aggregate number — see `01_DATA_MODEL.md` §4). This is the one deliberate, intentional crack in the otherwise-strict location-scoped RLS boundary, and it must stay narrow: canteen never gains general read access to restaurant's `stock_entries` rows, only this one summed figure.
- **Do not "simplify" this by giving canteen a broader read policy on `stock_entries`.** It would be easy to reach for widening the existing `stock_select_scoped` policy instead of adding a dedicated function, but that would leak the restaurant's opening/closing stock, sales, and unrelated items to canteen staff — a real confidentiality regression, not a harmless shortcut.

---

## 11. Ingredients vs. menu items — two different kinds of stock

An earlier draft of this system conflated "goods received into the central store" with "menu items available to sell" — treating both as a single `added_stock` figure. They are not the same thing. Full schema in `01_DATA_MODEL.md` §3.2; this section states the commitment architecturally.

- **Raw ingredients** (flour, sugar, cooking oil, ...) are received from suppliers and consumed in cooking. Tracked in their own tables (`ingredients`, `ingredient_entries`), logged daily by the store manager (`received`/`quantity_used` only, per-field autosave as of the Phase 10 `/store` redesign — see §12's correction for wastage), restaurant-location-scoped only (canteen never sees ingredient data — it has no ingredient stock of its own).
- **Menu items** (Chapati, African Tea, ...) are what cooking produces. The quantity produced each day is entered directly by the store manager as a plain number — **not derived from ingredient usage by any formula.** The client's own conversion knowledge ("roughly 10kg flour → 40 Chapatis") is informal, and V1 respects that by not pretending to a precision the business doesn't have.
- **Do not build a recipe/bill-of-materials system** connecting the two automatically. This is a deliberate, explicit V1 omission (see `01_DATA_MODEL.md` §5), not a gap to quietly close — if the client later wants ingredient-usage validation against production, that's a real Phase 2 conversation, not something to infer from this note.
- The store manager's daily "menu items produced" figure still feeds directly into the existing restaurant `added_stock` / `sent_out` split (§10) — production output is what gets divided between the restaurant floor and canteen, exactly as already described there.

---

## 12. Wastage — V1 scope, not Phase 2

This constraint list originally deferred wastage/spoilage tracking to a later product phase. Direct client input reversed that — it's required in V1. Full schema in `01_DATA_MODEL.md` §3.3; this section states why it matters architecturally.

- **Without a wastage figure, closing stock silently stops reconciling with a physical count.** Spoiled or discarded stock isn't a sale and isn't a transfer — with nowhere else to go, it would either inflate the system's closing stock above what's physically there, or pressure staff into fudging `quantity_sold` to make the count match, corrupting the sales figures this whole system exists to make trustworthy.
- **Tracked at both stages**: finished menu items (`stock_entries.wastage`) and raw ingredients (`ingredient_entries.wastage`), since spoilage happens on both sides — ingredients going bad before cooking, and prepared food going unsold and spoiling afterward.
- **Wastage is a visible cost, not a silent deduction.** `wastage_value` (quantity × buying price) appears as its own line on the dashboard/ledger, distinct from COGS and expenses — WaPrecious should be able to see exactly how much was lost to waste, not infer it from a closing-stock number that's smaller than expected.
- **No reason-code taxonomy in V1** — just quantity plus an optional free-text note, mirroring how `expenses.note` already works. Don't build a structured wastage-category enum unless the client asks for it.

**Correction (Phase 10, post-launch redesign of `/store`):** `stock_entries.wastage` (finished menu items, entered on `/entry`) is unaffected by this correction. `ingredient_entries.wastage` is a different story — ingredient wastage entry was removed from `/store` entirely; the store manager's screen now only autosaves `received`/`quantity_used`, one field at a time, and always writes `wastage: 0` for its own edits (`PUT /api/ingredient-entries`). Responsibility for entering ingredient wastage was reassigned to admin, but **no admin-side screen for it exists yet** — this is a real, currently-open gap, not a decision to drop ingredient wastage tracking. Until that screen is built, the dashboard/ledger's ingredient wastage-value figures will read zero. See `01_DATA_MODEL.md` §3.3 for the same correction against the schema, and `docs/phases/` (or a future post-launch-fix commit) for whenever that admin screen ships.

---

## 13. Delivery orders — added after initial planning, per direct client input

Prosper Hotel currently coordinates estate/home deliveries over a WhatsApp group, with no record beyond the chat thread. This is a genuine V1 scope addition (not in the original discovery scope), added because the client asked for the WhatsApp group to be replaced with a real record-of-truth. Full schema/RLS in `01_DATA_MODEL.md` §6; this section states the architectural commitment.

- **An order is a customer transaction, not a stock-entry row** — closer to a receipt (customer name, items, quantities, delivery zone or pickup) than to the location-level daily/weekly aggregates in `stock_entries`. It gets its own tables (`orders`, `order_items`).
- **Orders deduct from the same day's `stock_entries.quantity_sold`**, via the same calculation path in `lib/calculations.ts` — an order is a second write-path into the existing stock ledger, not a parallel untracked record. Getting this wrong would silently break stock reconciliation, the same failure mode wastage tracking (§12) exists to prevent.
- **Walk-in till sales are unaffected** — the stepper-based entry flow (`04_PHASE_PLAN.md` Phase 4) stays exactly as-is. Orders only cover the delivery/pickup channel that used to go through WhatsApp.
- **Admin manages a `delivery_locations` catalog** (zone name + fixed fee) — staff pick a zone per order rather than typing a fee, same "don't make staff re-derive a known number" principle as opening-stock carry-forward (§10). The fee is snapshotted onto the order at write time, same rationale as every other price snapshot in this system.
- **No order status/workflow, no rider assignment, no WhatsApp API integration.** Orders are logged after the fact as completed transactions — see `01_DATA_MODEL.md` §6 for the full list of deliberate V1 exclusions.
