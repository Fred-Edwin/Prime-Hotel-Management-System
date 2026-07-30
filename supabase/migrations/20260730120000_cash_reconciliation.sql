-- ============================================================
-- Cash reconciliation — post-launch feature (client feedback,
-- 2026-07-30): "the cash I receive from staff at the end of the day
-- is sometimes more or less than what the app shows as correct."
-- Staff sometimes forget to log a sale, or log one that didn't
-- happen; WaPrecious wants to record what she actually received in
-- cash each day, per location, and see the variance against the
-- system's own recorded sales — for any past date, not just today.
--
-- SCOPE (confirmed with the human):
--   - One row per location, per day — restaurant and canteen are
--     reconciled independently, matching every other per-location
--     figure in this schema, since WaPrecious receives cash from each
--     location's staff separately.
--   - "Expected cash" = that location/day's full stock_entries
--     sales_value total (till sales + order-driven sales, §3.4 — both
--     already summed into quantity_sold/sales_value, no separate
--     order aggregation needed, same free lunch dashboard_stock_summary
--     already gets). Deliberately NOT split by payment method (cash vs.
--     M-Pesa vs. credit) — the client's own framing of the problem is
--     "what the app shows as correct" vs. "what I physically received,"
--     a single comparison, not a payment-method reconciliation. Credit
--     sales (Phase 11, §6) are already tracked as a separate
--     outstanding-balance concept and are not treated specially here.
--   - Admin-only, both write and read — WaPrecious is the one who
--     physically receives the cash and is the one asking for this
--     figure; no staff-facing screen or RLS grant.
--
-- expected_cash is SNAPSHOTTED at save time (read from
-- dashboard_stock_summary()-equivalent per-day sales_value at the
-- moment the admin enters actual_cash), not live-recomputed on every
-- read — same "price/figure snapshot, not a live reference" discipline
-- as selling_price_snapshot elsewhere (see CLAUDE.md's non-negotiable
-- constraints). A stock_entries row for that date CAN still change
-- later (an admin ledger edit, §3.4) -- if that happens after a
-- reconciliation was already saved, the reconciliation's expected_cash
-- deliberately does NOT silently drift; see save_cash_reconciliation()
-- below for how a re-save picks up the current figure explicitly.
-- ============================================================

create table public.cash_reconciliations (
  id uuid primary key default gen_random_uuid(),
  location location_type not null,
  reconciliation_date date not null,
  expected_cash numeric(10,2) not null,
  actual_cash numeric(10,2) not null check (actual_cash >= 0),
  variance numeric(10,2) not null,  -- actual_cash - expected_cash, stored not generated (see CLAUDE.md)
  note text,

  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (location, reconciliation_date)
);

create index cash_reconciliations_location_date_idx on public.cash_reconciliations (location, reconciliation_date);

create trigger cash_reconciliations_set_updated_at
  before update on public.cash_reconciliations
  for each row execute function public.set_updated_at();

alter table public.cash_reconciliations enable row level security;

-- Admin-only in every direction — no staff equivalent, see scope note above.
create policy "cash_reconciliations_admin_all" on public.cash_reconciliations
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- dashboard_expected_cash(p_location, p_date): that location/day's
-- sales_value total straight off stock_entries — the same figure
-- dashboard_stock_summary() would show for a single-day range, but
-- scoped to exactly one location/date rather than the dashboard's
-- period-toggle shape, since this is read once at save time, not
-- aggregated across a range. quantity_sold already includes
-- order-driven sales (§3.4), so this needs no separate orders join.
-- Returns 0 (not null) when no stock_entries rows exist for that
-- location/date at all -- a genuinely quiet day has zero expected
-- cash, not an unknown figure, unlike stock quantity carry-forward
-- (§3.9) which has a real "unknown vs. confirmed-zero" distinction
-- this figure doesn't need.
-- ============================================================

create or replace function public.dashboard_expected_cash(
  p_location location_type,
  p_date date
)
returns numeric
language sql
security invoker
stable
as $$
  select coalesce(sum(sales_value), 0)
  from public.stock_entries
  where location = p_location
    and entry_date = p_date;
$$;

-- ============================================================
-- save_cash_reconciliation(): single write path (admin only, RLS
-- above is the real enforcement). Upserts on (location,
-- reconciliation_date) -- a same-day re-save (e.g. correcting a
-- mistyped actual_cash) updates the existing row rather than
-- erroring, same upsert convention as stock_entries/ingredient_entries.
--
-- expected_cash is ALWAYS freshly read from dashboard_expected_cash()
-- at save time, never accepted from the client -- this is what keeps
-- it an honest snapshot of "what the system showed at the moment she
-- reconciled" while still reflecting any admin ledger edit made to
-- that date's stock_entries BEFORE this particular save (a save after
-- such an edit correctly picks up the corrected figure; a save
-- BEFORE such an edit keeps its own already-stored value untouched
-- until the admin explicitly re-saves, same "we don't rewrite
-- history automatically" posture as every other snapshot in this
-- schema, e.g. §3.11's wastage_value formula change).
-- ============================================================

create or replace function public.save_cash_reconciliation(
  p_location location_type,
  p_reconciliation_date date,
  p_actual_cash numeric,
  p_created_by uuid,
  p_note text default null
)
returns public.cash_reconciliations
language plpgsql
security invoker
as $$
declare
  v_expected numeric(10,2);
  v_row public.cash_reconciliations;
begin
  v_expected := public.dashboard_expected_cash(p_location, p_reconciliation_date);

  insert into public.cash_reconciliations (
    location, reconciliation_date, expected_cash, actual_cash, variance, note, created_by
  )
  values (
    p_location, p_reconciliation_date, v_expected, p_actual_cash, p_actual_cash - v_expected, p_note, p_created_by
  )
  on conflict (location, reconciliation_date) do update set
    expected_cash = excluded.expected_cash,
    actual_cash = excluded.actual_cash,
    variance = excluded.variance,
    note = excluded.note
  returning * into v_row;

  return v_row;
end;
$$;
