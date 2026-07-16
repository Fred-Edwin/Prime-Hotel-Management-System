# Staff hard-delete backend semantics

**Status:** Deferred at Phase 10 scoping. UI-only stub exists; no real backend wired.
**Depends on:** Nothing.
**Phase-scale?** No — small, self-contained, normal post-launch work.

## What exists today (don't re-derive this)

Phase 10 added a guarded, visually distinct Delete action on the admin Staff screen (`app/(admin)/staff/StaffClient.tsx`) alongside the existing Deactivate/Reactivate from Phase 9 — destructive vs. reversible, with a stronger confirmation flow on Delete. Per Phase 10's explicit scope note, this was a **UI/confirmation-flow addition only** — whether/how it's wired to a real destructive API call was deliberately left as a decision for whichever phase actually implements it.

## The problem

Phase 9 established that `public.users` has no `ON DELETE CASCADE`/`SET NULL` from `stock_entries.created_by` / `ingredient_entries.created_by` / `expenses.created_by` / `orders.created_by` — so a real hard-delete would either fail on the FK constraint or (if the constraint were loosened) silently orphan historical records' attribution. That's exactly why Phase 9 built soft-deactivate (`users.active`) instead of delete. The Delete button that now exists in the UI needs a real decision about what it actually does when clicked.

## Scope for this item (needs human decision before implementation)

Pick one, confirm with the human, then implement:

1. **Delete button is purely cosmetic-strong-deactivate** — it calls the same deactivate endpoint as Reactivate/Deactivate but with a scarier confirmation copy, for staff the admin considers permanently gone vs. temporarily off. No new backend behavior, no schema change. Simplest, lowest-risk option.
2. **Real hard-delete, gated on zero historical records** — only allow the delete API call to succeed if the staff member has no rows in `stock_entries`/`ingredient_entries`/`expenses`/`orders` (i.e., they were created and never actually used the system). Otherwise return a clear error telling the admin to deactivate instead.
3. **Real hard-delete with FK relaxation** — change the foreign keys to `ON DELETE SET NULL` and add a `created_by_name_snapshot` (or similar) text column captured at write time so historical records keep a readable attribution even after the `users` row is gone. This is the only option that lets a staff member with history actually be removed, but it's a real schema change with the same "don't let a later value change change past truth" spirit as the price-snapshot rule.

## Explicitly not in scope

- Bulk staff deletion.
- Any change to the Deactivate/Reactivate flow itself (Phase 9, already correct).

## Acceptance criteria

- [ ] Design choice (1, 2, or 3 above, or a variant) confirmed with the human before implementation.
- [ ] Whatever is chosen, historical entries' attribution is never silently corrupted or orphaned — verified by testing (create a staff account, log an entry as them, then attempt delete, confirm the historical entry is still correctly attributed or the delete is correctly rejected).
- [ ] `docs/01_DATA_MODEL.md` updated if the FK/schema changes (option 3).
- [ ] Delete confirmation UI copy accurately reflects what will actually happen (don't say "permanently delete" if it's actually a stronger deactivate).

---

## Agent-session prompt

> You are a full-stack engineer working on the Prosper Hotel Management System, a Next.js 14 + Supabase app for a Kenyan restaurant/canteen business (see `CLAUDE.md` at the repo root for full context — read it first). The admin Staff screen (`app/(admin)/staff/StaffClient.tsx`) already has a guarded Delete button from Phase 10, but it's a UI-only stub with no real backend wired — your task, per `docs/backlog/06_staff_hard_delete.md`, is to decide and implement what it actually does. Read Phase 9's soft-deactivate reasoning in `docs/01_DATA_MODEL.md` (search for `users.active`) first — `public.users` has no cascade/set-null from historical records' `created_by` columns, which is exactly why hard-delete is risky. The brief lays out three options (cosmetic-strong-deactivate, gated hard-delete for never-used accounts only, or real hard-delete with FK relaxation plus a name snapshot column) — present these to the human and get a decision before implementing; do not silently pick one. Whatever is chosen, verify by testing (not by reading the schema) that historical entries' attribution is never silently corrupted. Update `docs/01_DATA_MODEL.md` if you touch the schema, and make sure the Delete confirmation copy in the UI accurately describes what actually happens.
