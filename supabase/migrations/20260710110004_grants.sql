-- ============================================================
-- SCHEMA-LEVEL GRANTS
--
-- Gap discovered during Phase 2 seeding: 01_DATA_MODEL.md documents
-- RLS policies in full but never states the baseline GRANT statements
-- every Supabase project needs alongside them. RLS and table-level
-- privileges are two separate Postgres mechanisms -- a role can pass
-- every RLS check and still be refused by the grant system underneath
-- it. A stock Supabase project (created via the dashboard) ships this
-- as an invisible bootstrap migration; a project built by hand-writing
-- migrations from this doc does not get it for free. Discovered when
-- scripts/seed-staff.ts's service-role insert into public.users failed
-- with "permission denied for table users" despite service_role having
-- rolbypassrls = true (RLS bypass and GRANT privileges are independent).
--
-- Documented here and flagged in docs/01_DATA_MODEL.md + this phase's
-- context file per CLAUDE.md's change-handling rule, rather than
-- silently patching it. Anyone re-provisioning a fresh Supabase project
-- for this app needs this migration -- it is not automatic.
-- ============================================================

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;

-- Ensures tables/sequences/functions created by FUTURE migrations get
-- the same baseline grants automatically, matching what a
-- dashboard-created Supabase project does by default.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on routines to anon, authenticated, service_role;
