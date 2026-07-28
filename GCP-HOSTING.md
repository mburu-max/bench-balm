# GCP Hosting Plan

_Target architecture for hosting this system on Google Cloud (as of 2026-07-28). Organised by layer —
frontend, backend, database — with where each is hosted and what it costs. Companion to
[MIGRATION.md](MIGRATION.md), which covers the move off Supabase/Lovable._

> **Scale assumption:** a few managers, tiny data (roster + projects + allocations), read-heavy. This
> is what keeps everything except the database inside free tiers.

## Architecture

```
                        Managers' browsers
                                │
                                ▼
   ┌─────────────────────────────────────────────────────────┐
   │  FRONTEND — the React UI                                  │
   │  Hosted on:  Firebase Hosting   (or Cloud Run if SSR)     │
   └─────────────────────────────────────────────────────────┘
                                │  (calls the API over HTTPS)
                                ▼
   ┌─────────────────────────────────────────────────────────┐
   │  BACKEND — server-side logic                             │
   │   • API layer (serves data, enforces auth)               │
   │   • Webhook receivers (Omni + HubSpot pushes)            │
   │   • Admin / service functions                            │
   │  Hosted on:  Cloud Run                                    │
   │  Auth:       Identity Platform   Secrets: Secret Manager  │
   └─────────────────────────────────────────────────────────┘
                                │  (Cloud SQL Auth Proxy)
                                ▼
   ┌─────────────────────────────────────────────────────────┐
   │  DATABASE — data + in-DB logic                           │
   │   tables · RLS · triggers · functions · pg_cron snapshot │
   │  Hosted on:  Cloud SQL for PostgreSQL                     │
   └─────────────────────────────────────────────────────────┘

   External:  Omni HR / HubSpot ──(webhook push)──► Cloud Run (backend)
```

## Layer by layer

### Frontend — the app managers open in the browser
- **What:** React / TanStack Start client UI.
- **Hosted on:** **Firebase Hosting** (static build — free SSL, CDN, custom domain). *Or* **Cloud Run** if server-side rendering is kept.
- **Cost:** ~$0 (free tier).

### Backend — server-side logic
- **What:** the API layer (serves data to the frontend, enforces auth, talks to the DB), the **webhook receivers** (Omni + HubSpot change events), and admin/service functions.
- **Hosted on:** **Cloud Run.**
- **Auth:** **Identity Platform** (managed; replaces Supabase Auth — rewire `auth.uid()`).
- **Secrets:** **Secret Manager** (DB password, Omni/HubSpot tokens, JWT keys).
- **Cost:** ~$0 (free tiers — Cloud Run 2M req/mo, Identity Platform <50k users).

### Database — the data and in-DB logic
- **What:** PostgreSQL — tables, RLS policies, triggers, SECURITY DEFINER functions, and **pg_cron** (the daily snapshot). Everything replays from `supabase/migrations/*`.
- **Hosted on:** **Cloud SQL for PostgreSQL** (`db-f1-micro`, single-zone).
- **Cost:** ~$10–13 — the one real line item.

## Shared / supporting services (used by all layers)
| Service | Purpose | Cost |
|---|---|---|
| Artifact Registry | Stores the container images Cloud Run runs | ~$0 (cents) |
| Cloud Build | Builds + deploys from the repo (CI/CD) | ~$0 (free minutes) |
| Cloud SQL Auth Proxy | Secure, IAM-auth'd backend ↔ database connection | $0 (built into Cloud Run) |
| Cloud Logging + Monitoring | Logs, metrics, alerts (e.g. "webhook failed") | ~$0 (free tier) |
| IAM | Permissions across everything | $0 |
| Cloud Storage (GCS) — optional | File storage (avatars/docs/exports) + off-DB `pg_dump` backups | ~$0 (cents) |

**Sync model:** roster changes arrive via **webhooks** (Omni/HubSpot push → Cloud Run). The **manual
"Sync" backfill button** (already built) is the reconciliation backstop for any missed webhook — so
there is **no scheduler** in this design. (Optionally a free GitHub Actions cron for a hands-off
weekly reconcile.)

## Deliberately NOT using (keeps it lean)
- **Cloud Scheduler** — not needed; webhooks are change-driven, the snapshot uses pg_cron, and the
  backstop is the manual button.
- **Serverless VPC Access connector** — would add ~$10/mo (always-on instances); the Auth Proxy is
  free and secure.
- **High Availability (standby)** — ~doubles the DB cost; skip for an internal tool. Add later if
  guaranteed uptime is ever required (that also brings the 99.95% SLA, which `db-f1-micro` lacks).
- **Load Balancer / Cloud Armor / Cloud CDN** — ~$18–25/mo; Cloud Run and Firebase Hosting already
  provide HTTPS, a custom domain, and a CDN.

## Cost summary
| Layer | GCP host | ~ / month |
|---|---|---|
| Frontend | Firebase Hosting (or Cloud Run) | $0 |
| Backend (API + webhooks + auth) | Cloud Run + Identity Platform | $0 |
| Database | Cloud SQL (`db-f1-micro`, single-zone) | ~$10–13 |
| Supporting | Registry / Build / Logging / IAM / Auth Proxy | ~$0 |
| **Total (running)** | | **~$10–15/mo** |

The **running** cost is essentially just Cloud SQL. The **re-platform** — rebuilding auth (Identity
Platform), an API layer to replace Supabase's auto-generated one, and porting the edge functions to
Cloud Run — is a **one-time engineering effort**, not a recurring fee.

## Supabase → GCP mapping
| Supabase | GCP |
|---|---|
| Postgres | Cloud SQL for PostgreSQL |
| Auth (GoTrue, `auth.uid()`) | Identity Platform (+ rewire RLS session context) |
| Auto-API (PostgREST) | A small API service on Cloud Run |
| Edge Functions (Deno) | Cloud Run services / functions |
| Edge-function secrets | Secret Manager |
| pg_cron / webhooks | Same pattern (pg_cron in Cloud SQL; webhook endpoints on Cloud Run) |
