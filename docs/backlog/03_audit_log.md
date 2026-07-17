# System-wide audit/event log

**Status:** Shipped. `audit_log` table (`supabase/migrations/20260716120000_audit_log.sql`), `GET /api/audit-log`, admin-facing screen at `app/(admin)/dashboard/audit-log/`. Scoped to the actions listed below plus `stock_entry.admin_edit`/`ingredient_entry.admin_edit` (added alongside [04_admin_ledger_edit.md](04_admin_ledger_edit.md)). See [07_admin_ux_sweep.md](07_admin_ux_sweep.md) item 5 for further improvements planned on top of this.
**Depends on:** Nothing to start, but should land **before** [04 (admin-as-staff)](04_admin_impersonation.md) and [05 (admin historical edit)](05_admin_historical_edit.md) — both of those let the admin mutate or impersonate other people's operational data, and shouldn't ship without a trace of who really performed the action.
**Phase-scale?** Borderline — touches every write path in the app, even if each individual touch is small. Flag this explicitly to the human and confirm whether it warrants its own phase-style plan (own `docs/04_PHASE_PLAN.md` section, own context file) before starting, per `CLAUDE.md`'s guidance on genuinely large post-launch work.

## The problem

There's currently no record of *who edited or deactivated what, when*. Phase 9 added `users.active` for soft-deactivation but noted "audit log of who edited/deactivated a staff account" as a real Phase-2-of-the-product candidate, not built then. Right now, if WaPrecious edits a staff account, deactivates someone, or (once 04/05 exist) edits historical data or acts as a staff member, there's no way to answer "did that actually happen, and who did it" beyond `created_by`/`updated_at` columns that only capture the *current* state, not the history of changes.

## Scope for this item

1. New table, e.g. `audit_log`: `actor_id` (references `users`), `action` (enum or text — e.g. `staff.deactivate`, `staff.edit`, `stock_entry.historical_edit`), `target_table`, `target_id`, `changes` (jsonb, before/after or diff), `created_at`.
2. Decide write mechanism: Postgres trigger-based (captures everything automatically, but needs care to avoid noise) vs. explicit application-level writes at each sensitive mutation point (more control, more discipline required not to miss a spot). Given this codebase's existing pattern of centralizing logic (`lib/calculations.ts`, `public.recalculate_stock_entry()`), a small shared helper (e.g. `lib/audit.ts` or a `public.write_audit_log()` plpgsql function) that every sensitive route/RPC calls explicitly is likely more consistent with how this codebase already centralizes logic than a blanket trigger on every table.
3. RLS: audit log should be **admin-read-only**, no one (including admin) should be able to edit or delete entries through the app — this is the whole point of an audit trail.
4. Scope which actions get logged first — start with the sensitive ones this backlog folder itself creates the need for (staff edit/deactivate/PIN-reset, and whatever 04/05 add), not every single stock entry (that data already has its own history via `stock_entries` rows themselves).
5. Admin-facing read screen (simple list, filterable by actor/action/date) is a nice-to-have, not a hard requirement for the log to exist and be useful — confirm with the human whether a screen is wanted in this pass or the log is just infrastructure for now.

## Explicitly not in scope

- Retroactively logging historical actions that already happened before this ships.
- A generic "log everything" trigger covering all 9+ tables — start scoped to sensitive admin actions.
- Real-time alerting/notifications on audit events.

## Acceptance criteria

- [ ] `audit_log` table exists with admin-read-only RLS, verified by testing (not just reading policy) that even the admin role cannot write/delete through the client.
- [ ] At least the Staff edit/deactivate/PIN-reset actions (Phase 9's existing feature) write an audit entry.
- [ ] `docs/01_DATA_MODEL.md` updated with the new table and its RLS.
- [ ] `scripts/acceptance/*.mjs` script confirming the RLS boundary (admin can read, no one can write/delete via API).

---

## Agent-session prompt

> You are a full-stack engineer working on the Prosper Hotel Management System, a Next.js 14 + Supabase app for a Kenyan restaurant/canteen business (see `CLAUDE.md` at the repo root for full context — read it first). Your task is to design and implement a system-wide audit log as described in `docs/backlog/03_audit_log.md`. This is flagged as borderline phase-scale because it touches every sensitive write path in the app — before writing any code, summarize your understanding back to the human and explicitly ask whether this warrants a phase-style plan (its own `04_PHASE_PLAN.md` section and context file) given `CLAUDE.md`'s guidance on large post-launch work, rather than silently treating it as a routine fix. Scope the first pass to the Staff edit/deactivate/PIN-reset actions (Phase 9's existing feature) rather than every table. The audit log itself must be admin-read-only at the RLS level — not even the admin should be able to edit/delete entries through the app, and this must be verified by testing via `curl` against a real seeded account (see `scripts/seed-staff.ts`), not by reading the policy SQL. Read `docs/phases/phase9_context.md` first for current repo state, and `docs/01_DATA_MODEL.md` for the existing RLS/schema conventions to match. Update `docs/01_DATA_MODEL.md` in the same piece of work and write a `scripts/acceptance/*.mjs` script for the RLS boundary.
