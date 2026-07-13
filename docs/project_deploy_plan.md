# Prime Hotel — Production Deployment Plan

Deployment happens in two stages, not one:

1. **Demo deploy (Phase 8, done)** — Vercel + Supabase production projects created under Fred's business Google account (`lobster.technologies.africa@gmail.com`), not his personal account. Personal Vercel/Google account is locked out (2FA/help-request pending). GitHub repo stays on Fred's personal GitHub; the business Vercel account has the Vercel GitHub App installed with access scoped to just this one repo — no repo transfer needed. This deploy's purpose is to let WaPrecious (the client) see and approve the working app.

2. **Final production migration (later, once the client is satisfied)** — the app gets redeployed under **the client's own Google business account** (her own Vercel + Supabase projects), so she owns the production infrastructure directly and can keep it on free tier with no recurring cost to either party, per `CLAUDE.md`'s "no monthly hosting fees, ever" constraint. This is a distinct, later step — not the same deploy as #1. **Not yet started.**

**Why two stages:** Fred doesn't want to hand over infrastructure he personally owns as the long-term production home for the client's business tool — she should own her own Vercel/Supabase accounts. The interim demo deploy under his business account is only for getting her sign-off.

**How to apply:** When picking up any "let's actually go to production" work, ask which stage is being requested — demo (business account, already live) or final migration (client's own account, not started) — rather than assuming the current deploy is the permanent one. Don't treat the business-account deploy as the final destination in any docs/phase-context write-up.

## Stage 1 status (as of 2026-07-13): demo deploy is live

- **Supabase production project:** `prime-hotel-demo`, ref `mqtlxuwbjzsjtywhjjtf`, region eu-north-1, under `lobster.technologies.africa@gmail.com`. All 17 migrations applied. Real 5-person roster seeded (WaPrecious/Janiffer/Sarah/Mercy/Anne), all PINs reset to a new 6-character value (Supabase's prod password policy requires 6+ chars, so the dev scripts' 4-digit PINs couldn't be reused as-is; see the team's private credentials record, not committed here).
- **Catalog data:** `items` seeded with the client's real 132-item catalog (Phase 8, `scripts/seed-data/seed_real_items.mjs`). `ingredients` (7 rows) and `delivery_locations` (4 Nyeri-area zones) were found completely empty later in Phase 8 — while producing demo recordings — and seeded with realistic placeholder data (`scripts/seed-data/seed_real_ingredients.mjs`, `seed_delivery_locations.mjs`). None of the original Stage-1 deploy steps had covered these two tables.
- **Vercel production project:** `lobster-technologies-projects/prime-hotel`, live at **https://prime-hotel.vercel.app**. Deployed via Vercel CLI (`vercel --prod`), **NOT** via GitHub auto-deploy — the Vercel↔GitHub integration cannot see the repo because it's owned by Fred's *personal* GitHub account while the business Vercel/GitHub App is on a different account; Vercel's own docs confirm importing a personally-owned repo requires being the repo *Owner*, which collaborator access doesn't satisfy. Adding `lobster-technologies` as a GitHub collaborator did not fix this.
  - **Auto-deploy-on-push is NOT wired up.** Any future change needs a manual `vercel --prod` redeploy from a machine with the Vercel CLI logged in as `lobster-technologies`, until the GitHub integration is sorted (or until Stage 2 potentially resolves this differently under the client's own accounts).
- Smoke-tested directly via curl against the live URL: login (admin + staff), role-scoped RLS (staff correctly 403s on admin routes), dashboard aggregation — all correct.
- Still open: decide whether to fix the GitHub auto-deploy gap for Stage 1, or just accept manual deploys until Stage 2. Stage 2 itself has not been started.
