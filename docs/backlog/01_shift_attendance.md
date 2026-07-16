# Shift scheduling & attendance tracking

**Status:** Deferred at Phase 10 scoping. Not started.
**Depends on:** Nothing.
**Phase-scale?** No — normal post-launch feature work per `CLAUDE.md`'s "Post-launch maintenance work" section.

## What exists today (don't re-derive this)

Phase 10 shipped UI placeholders anticipating this feature, using the `PlaceholderStat` component (`docs/design/01_COMPONENTS.md` §4.25):
- Admin Ledger screen (`app/(admin)/dashboard/ledger/LedgerClient.tsx`) has a "staff on shift" column, unwired.
- Admin Staff screen (`app/(admin)/staff/StaffClient.tsx`) has Attendance / Last-Shift columns, unwired.
- A lightweight, **non-geofenced** clock-in was agreed on in principle during Phase 10 scoping as the only shift-adjacent thing worth building — full shift scheduling was explicitly rejected as out of scope for that discussion. Geofencing was also explicitly rejected.

## Scope for this item

1. Decide clock-in mechanism: staff taps "clock in"/"clock out" from their own nav (likely `(staff)` shell), no location verification.
2. New table (name TBD, e.g. `shift_logs`): `staff_id`, `location`, `clocked_in_at`, `clocked_out_at`, RLS scoped same as other staff-created rows (own location only; admin sees both).
3. Wire the two existing `PlaceholderStat` instances (Ledger "staff on shift", Staff "Attendance/Last Shift") to real data.
4. Update `docs/01_DATA_MODEL.md` with the new table in the same piece of work (non-negotiable per `CLAUDE.md`).

## Explicitly not in scope

- Full shift scheduling/rostering (assigning future shifts, shift swaps).
- Geofencing or any location-verification on clock-in/out.
- Payroll or hours-based pay calculation.

## Acceptance criteria

- [ ] Staff can clock in/out from their own screen; RLS confirmed via `curl` (own-location scoping, per `CLAUDE.md`'s data/RLS verification rule).
- [ ] Ledger's "staff on shift" column shows real data, no longer `PlaceholderStat`.
- [ ] Staff screen's Attendance/Last-Shift columns show real data, no longer `PlaceholderStat`.
- [ ] `docs/01_DATA_MODEL.md` updated for the new table.
- [ ] `scripts/acceptance/*.mjs` script added if this touches any correctness-risk surface (unlikely here — mostly additive).

---

## Agent-session prompt

> You are a full-stack engineer working on the Prosper Hotel Management System, a Next.js 14 + Supabase app for a Kenyan restaurant/canteen business (see `CLAUDE.md` at the repo root for full context — read it first). Implement the shift-attendance feature described in `docs/backlog/01_shift_attendance.md`: a lightweight, non-geofenced clock-in/out for staff, plus wiring the two existing `PlaceholderStat` placeholders (Ledger's "staff on shift" column, Staff screen's Attendance/Last-Shift columns) to real data. Read `docs/phases/phase9_context.md` first for current repo state, then the brief in full. Follow `CLAUDE.md`'s non-negotiable constraints (RLS as the real security boundary, no calculation logic duplicated, `lib/validation.ts` for Zod schemas) and its design-system conformance rules for any UI you touch. Update `docs/01_DATA_MODEL.md` in the same piece of work since this adds a new table. Summarize your understanding of the request back before writing code.
