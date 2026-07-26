# Migration & Handoff Guide

How to move this system off the personal-email MVP (Supabase via Lovable, seed data only) to its
production home. The destination is a **late-binding decision** — the MVP work transfers either way
because all DB logic lives in `supabase/migrations/*.sql` and the code lives in git.

> **Do the handoff on seed/dummy data. Do NOT connect the real Omni roster (employee PII) until the
> system is on the work account and hardened.** The earlier "don't connect" warning was about the
> Lovable AI-builder environment (broad DB access + public preview), not Supabase itself.

## What's portable vs. path-specific
- **Portable to both destinations, unchanged:** the entire database (schema, RLS, triggers,
  functions) via the migrations, plus all app code and business logic. This is ~80–90% of the system.
- **Path-specific (the only real switching cost):** three Supabase-bundled pieces — Auth
  (`auth.uid()`), the auto-generated API (`supabase-js`), and the Edge Functions (webhooks).

## Destination A — Supabase (work account)  *[primary — straight migration]*
1. Create the repo under the work org (or GitHub → Transfer repository); push the code.
2. Create a new Supabase project in the work org; apply `supabase/migrations/*` (rebuilds schema,
   RLS, triggers, `import_hubspot_deal`, cap/leave logic — everything).
3. Migrate data if wanted: `pg_dump` from personal → `pg_restore` into work (or start clean + reseed).
4. Redeploy the edge functions (`hubspot-webhook`, `omni-webhook`, `admin-create-user`); re-set their
   secrets. Keep them `verify_jwt = false`.
5. Update `.env` (Supabase URL + anon key) to the work project; recreate the auth users.
- **Running cost:** ~$25/mo (Supabase Pro — includes DB + auth + API + functions). Migration effort: ~none.

## Destination B — GCP  *[fallback — build 3 components, migrate the DB]*
Keep the DB (replay migrations into **Cloud SQL for PostgreSQL**); rebuild the three Supabase pieces:
- **Auth** → Identity Platform (rewire `auth.uid()` / the `is_*()` role functions).
- **API** → a Cloud Run service (replaces the auto-generated PostgREST API).
- **Edge Functions** → Cloud Run / Cloud Functions (port `hubspot-webhook`, `omni-webhook`).

### GCP cost guardrails (PRECAUTION)
Workload = few managers, tiny data, mostly reads. Most pieces are **~$0** on free tiers; Cloud SQL is
the only guaranteed cost. Estimates — verify with the GCP Pricing Calculator.

| Piece | Service | ~ / month |
|---|---|---|
| Database | Cloud SQL `db-f1-micro`, single-zone, HDD | ~$9–13 |
| Frontend hosting | Firebase Hosting **or** Cloud Run | ~$0 (free tier) |
| API + webhook functions | Cloud Run | ~$0 (2M req/mo free) |
| Auth | Identity Platform | ~$0 (< 50k users) |
| Secrets / images / CI / logs | Secret Manager, Artifact Registry, Cloud Build, Cloud Ops | ~$0 (free tiers) |
| Egress | — | ~$0–2 |
| **All-in target** | | **~$15–20/mo** |

**DO NOT add these unless truly needed — they blow the budget:**
- **HTTP(S) Load Balancer** (~$18–25/mo) — not needed; Cloud Run / Firebase give HTTPS + custom
  domain + free SSL directly.
- **Cloud SQL public IP** (~$7/mo) — use **private IP / the Cloud SQL connector** (cheaper + right
  for PII).
- **Cloud NAT** (~$32/mo) — avoid by using the Cloud SQL connector for the DB and Cloud Run's default
  egress for the HubSpot/Omni API calls.
- **Cloud SQL HA** (~2× the DB cost, ~$100/mo tier) — optional; only if guaranteed uptime is required
  (adds the 99.95% SLA, which shared-core `f1-micro` does **not** have).

## Security at handoff (either destination)
- **Regenerate the HubSpot token** during the move (it was shown in screenshots) and store the fresh
  one as a secret in the new project. Never commit tokens; secrets live server-side only.
- For PII on GCP: **private IP (no public), IAM DB auth, automated backups + PITR, audit logging**,
  and consider CMEK.
- Connect Omni (the real roster) only **after** the system is on the work account with auth/RLS
  reviewed. Validate the field mapping first with an Omni sandbox org or dummy employees.

## Discipline that keeps the handoff cheap (already followed)
- All DB changes go in `supabase/migrations/*` (never hand-applied only in a dashboard).
- Auth checks go through the role helpers (`useCurrentRole`, the `is_*()` SQL functions), not scattered raw calls.
- Integrations stay isolated in the edge functions.
