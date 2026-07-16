# Staff meal / unpaid-food consumption accounting

**Status:** Deferred at Phase 10 scoping. Not started — no schema, no screen exists.
**Depends on:** Nothing.
**Phase-scale?** No — normal post-launch feature work.

## The problem

Restaurant staff sometimes eat food from stock without it being a paying sale. Today that stock simply disappears from `stock_entries` with no attribution — it either gets silently absorbed into wastage, or (worse) makes closing-stock figures not reconcile against what was actually sold, since there's no category for "consumed internally, not sold, not wasted."

## Scope for this item (proposed — confirm with the human before building)

1. Decide the data-model shape: most likely a new quantity column on `stock_entries` (e.g. `staff_consumption`) parallel to `wastage`, **or** a separate small table if it needs its own note/attribution per staff member. Given `wastage` already has this exact shape (`wastage` quantity + optional `wastage_note`, reduces closing stock, has its own dashboard line distinct from COGS/expenses — see `docs/01_DATA_MODEL.md` §3.3), the most consistent design mirrors that pattern rather than inventing a new one.
2. Should reduce closing stock (same as wastage) but must **not** be counted as `wastage_value` — it's a distinct third bucket, not a wastage sub-type, so it doesn't distort the wastage dashboard line's meaning.
3. Whether it needs per-entry staff attribution (which staff member consumed it) is a scoping question for the human — the brief doesn't presuppose an answer.
4. New dashboard line and/or ledger column for visibility, consistent with how `wastage_value` got its own line.

## Explicitly not in scope

- Any payroll/deduction logic tied to consumption value.
- Formal meal-plan/allowance rules (e.g. "each staff gets X per day free").

## Acceptance criteria

- [ ] Design decision (column vs. table, attribution or not) confirmed with the human before implementation — this brief deliberately leaves that open.
- [ ] Staff consumption reduces closing stock correctly, verified against a manual calculation.
- [ ] Staff consumption value is visibly distinct from `wastage_value` on the dashboard/ledger — not merged into it.
- [ ] `docs/01_DATA_MODEL.md` updated in the same piece of work.
- [ ] `scripts/acceptance/*.mjs` extended if this affects any oversell/closing-stock calculation path (it likely does).

---

## Agent-session prompt

> You are a full-stack engineer working on the Prosper Hotel Management System, a Next.js 14 + Supabase app for a Kenyan restaurant/canteen business (see `CLAUDE.md` at the repo root for full context — read it first). Implement staff meal / unpaid-food consumption accounting as described in `docs/backlog/02_staff_meals.md`. This brief deliberately leaves the exact data-model shape open (new column on `stock_entries` mirroring the existing `wastage` pattern, vs. a separate table) — read `docs/01_DATA_MODEL.md` §3.3 for how `wastage` is modeled today, propose the more consistent option, and confirm with the human before writing migrations. The key correctness constraint: consumption must reduce closing stock like wastage does, but must NOT be folded into `wastage_value` — it needs its own distinct dashboard line so the existing wastage figure doesn't silently change meaning. Read `docs/phases/phase9_context.md` first for current repo state. Follow `CLAUDE.md`'s non-negotiable constraints and update `docs/01_DATA_MODEL.md` in the same piece of work. Summarize your understanding back before writing code.
