# Admin acting as any staff role

**SUPERSEDED 2026-07-16 — see [04_admin_ledger_edit.md](04_admin_ledger_edit.md).** During scoping, the human proposed a simpler direct-ledger-edit mechanism instead of impersonation; that design was adopted and this file is kept only as a record of the originally-scoped idea, not an active brief. Don't build from this file.

**Status:** Deferred at Phase 10 scoping. Not started.
**Depends on:** Recommend [03 (audit log)](03_audit_log.md) land first — this feature lets the admin write data attributed to (or on behalf of) staff, which is exactly the kind of action that needs a trace.
**Phase-scale?** Yes — flag explicitly and confirm with the human whether this gets its own phase-style plan before starting. It touches auth/role logic, RLS, and every staff-facing write path (`stock_entries`, `ingredient_entries`, `orders`, `expenses`).

## What exists today (don't re-derive this)

Phase 10's Google Stitch reference designs included a Dashboard "Add Entry" button and a notification bell that would require this feature to be real. Both currently ship as unwired `PlaceholderStat` elements (`app/(admin)/dashboard/DashboardClient.tsx`) — not real entry points. See `docs/design/01_COMPONENTS.md` §4.25 for the placeholder-pattern rationale.

## The problem

WaPrecious (admin) currently cannot log a stock entry, ingredient entry, order, or expense herself — only `staff` accounts can, and the app has exactly two roles (`admin`, `staff`) with no third tier, per `CLAUDE.md`'s non-negotiable constraint. If WaPrecious needs to step in and log something (e.g. covering a shift, correcting a same-day miss), she currently has no path to do that without a staff account's PIN.

## Scope for this item (needs human decision before implementation)

Two fundamentally different designs are possible — **this brief does not pick one**, it must be decided with the human first:

1. **"Act as" mode** — admin selects a staff member/location context, and the app temporarily behaves as if logged in as that person for write purposes, with entries attributed to the *real* actor (admin) via the audit log (03), not silently attributed to the staff member as if they'd logged it themselves.
2. **Direct admin write access** — admin gets her own write UI (not borrowing staff screens), which writes with `created_by = admin`, and the two roles' RLS write policies get extended to allow admin writes on `stock_entries`/`orders`/etc. (today these are likely staff-only write paths — needs verification against `docs/01_DATA_MODEL.md` §4 before assuming).

Whichever is chosen, the **two roles only** constraint must hold — this is not a request to add a third role or permission tier.

## Explicitly not in scope

- Any change to the fundamental two-role model.
- Impersonation for read purposes (admin already reads everything).

## Acceptance criteria

- [ ] Design choice (act-as vs. direct write) confirmed with the human and documented in this file or a phase context file before implementation begins.
- [ ] Every write made this way is attributed correctly and produces an audit log entry (depends on 03).
- [ ] RLS re-verified by testing for the new write path — confirm it doesn't accidentally widen access beyond what's intended.
- [ ] Dashboard "Add Entry" button and notification bell wired to real functionality, no longer `PlaceholderStat`.
- [ ] `docs/00_ARCHITECTURE.md` §5.1 (auth/role model) updated if the write-path mechanics change.

---

## Agent-session prompt

> You are a full-stack engineer working on the Prosper Hotel Management System, a Next.js 14 + Supabase app for a Kenyan restaurant/canteen business with exactly two roles, `admin` and `staff` (see `CLAUDE.md` at the repo root for full context and this non-negotiable constraint — read it first). Your task is to scope and implement "admin acting as any staff role" as described in `docs/backlog/04_admin_impersonation.md`. This is flagged as phase-scale — before writing any code, explicitly ask the human whether this warrants a phase-style plan, and present the two candidate designs in the brief ("act as" mode with real-actor attribution vs. direct admin write access with RLS policy extension) for the human to choose between; do not silently pick one. Check `docs/backlog/03_audit_log.md` — ideally that lands first since this feature needs every admin-initiated write traced to the real actor. Read `docs/phases/phase9_context.md` and `docs/01_DATA_MODEL.md` §4 (RLS) first to understand current write-path scoping before proposing changes. The two-role model must not change. Once a design is chosen, wire the Dashboard's existing `PlaceholderStat` "Add Entry" button and notification bell to the real functionality. RLS changes must be verified by testing (`curl` against seeded accounts), not by reading policy SQL.
