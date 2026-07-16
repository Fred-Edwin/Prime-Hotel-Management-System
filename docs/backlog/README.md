# Deferred admin-side items (parked during Phase 10)

Six items surfaced during Phase 10 (Admin Screen Redesign) scoping and were deliberately parked — not silently dropped. See `docs/04_PHASE_PLAN.md` Phase 10's "Explicitly not in scope" list for the original context.

Each item has its own standalone brief in this folder. They are **not** sequenced as a dependent phase chain the way Phases 1–9 were — most are independent feature areas. The one real dependency: **audit log (03) is a soft prerequisite for admin-acting-as-staff (04) and admin historical-edit (05)** — those two mutate/impersonate other people's data and shouldn't ship without a trace of who really did what. Build order beyond that is free.

| # | Item | Phase-scale? | Depends on |
|---|---|---|---|
| 01 | [Shift scheduling & attendance](01_shift_attendance.md) | No — normal feature work | None |
| 02 | [Staff meal / unpaid-food accounting](02_staff_meals.md) | No — normal feature work | None |
| 03 | [System-wide audit/event log](03_audit_log.md) | Borderline — touches every write path | None, but should land before 04/05 |
| 04 | [Admin acting as any staff role](04_admin_impersonation.md) | Yes — flag for phase-style treatment | Recommend after 03 |
| 05 | [Admin-only historical-entry edit](05_admin_historical_edit.md) | Yes — flag for phase-style treatment | Recommend after 03 |
| 06 | [Staff hard-delete semantics](06_staff_hard_delete.md) | No — small, self-contained | None |

Each brief is written to be handed to a fresh agent/session with no other context loaded beyond this repo's `CLAUDE.md`. When picking one up, read `docs/phases/phase9_context.md` for current repo state per the standard read order, then the brief itself.
