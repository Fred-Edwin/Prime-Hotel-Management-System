-- ============================================================
-- AUDIT LOG
-- Post-launch addition (docs/backlog/03_audit_log.md). First pass is
-- scoped to Staff edit/deactivate/PIN-reset (Phase 9's existing
-- feature) -- not a blanket trigger on every table. Written via an
-- explicit shared helper (write_audit_log(), called from
-- lib/audit.ts) rather than a database trigger, matching how this
-- codebase already centralizes logic (lib/calculations.ts,
-- recalculate_stock_entry()) instead of hiding it in trigger bodies.
--
-- The log is admin-read-only and, critically, no one -- including
-- admin -- can write or delete rows through the client. Writes only
-- happen via write_audit_log(), a security definer function invoked
-- by route handlers using the server (anon-key) client, never a
-- direct table insert. This is the entire point of an audit trail:
-- if the admin role could edit/delete entries, the log couldn't be
-- trusted as a record of what the admin did.
-- ============================================================

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.users(id) on delete restrict,
  action text not null,              -- e.g. 'staff.edit', 'staff.deactivate', 'staff.pin_reset'
  target_table text not null,        -- e.g. 'users'
  target_id uuid not null,
  changes jsonb,                     -- before/after snapshot, shape depends on action
  created_at timestamptz not null default now()
);

create index audit_log_target_idx on public.audit_log (target_table, target_id);
create index audit_log_actor_idx on public.audit_log (actor_id);
create index audit_log_created_at_idx on public.audit_log (created_at desc);

alter table public.audit_log enable row level security;

-- Admin can read. No insert/update/delete policy exists for any role --
-- writes only happen through write_audit_log() below, which runs as
-- security definer and bypasses RLS by design (the same pattern
-- canteen_supplied_total() uses for its narrow cross-location read,
-- see docs/01_DATA_MODEL.md §4).
create policy "audit_log_select_admin_only" on public.audit_log
  for select using (public.is_admin());

-- Write path. security definer so it can insert regardless of the
-- caller's own RLS grants -- callers (route handlers) never insert
-- into audit_log directly, they call this function.
create or replace function public.write_audit_log(
  p_actor_id uuid,
  p_action text,
  p_target_table text,
  p_target_id uuid,
  p_changes jsonb default null
)
returns void
language plpgsql
security definer
as $$
begin
  insert into public.audit_log (actor_id, action, target_table, target_id, changes)
  values (p_actor_id, p_action, p_target_table, p_target_id, p_changes);
end;
$$;

grant execute on function public.write_audit_log(uuid, text, text, uuid, jsonb) to authenticated;
