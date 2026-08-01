# GCP Migration Plan — Allocate

Execution plan to move Allocate off **Lovable** (frontend host + repo/deploy manager) and
**Supabase** (Postgres · Auth · auto-API · Edge Functions · pg_cron) onto **Execo's GCP**. Companion to
[GCP-HOSTING.md](GCP-HOSTING.md) (target architecture + cost) and [MIGRATION.md](MIGRATION.md).

> **Sequencing rule:** do the platform migration **and** the real-Omni cutover as **two separate
> steps**, not at once. Get the app running on GCP against the *current* data first; switch Omni to the
> real Execo tenant after. One variable at a time.

---

## 1. The one decision that drives everything

The app leans on Supabase for four things:

| What | Where it's used |
|---|---|
| **Postgres** | all data |
| **Auth** (`auth.uid()`) | every **RLS** policy, triggers, `SECURITY DEFINER` functions |
| **Auto-API** (PostgREST) | **every** `supabase.from(...)` call in the frontend |
| **Edge Functions** (Deno) | `hubspot-webhook`, `omni-webhook` |

How you replace **Auth + Auto-API** is ~80% of the effort. Three paths:

### ⭐ Path A — Self-host Supabase (Docker) on one Compute Engine VM  *(recommended: fastest, lowest risk)*
- Run the official Supabase self-host stack (Postgres + GoTrue + PostgREST + Realtime + Edge runtime) via
  `docker-compose` on one `e2-small` VM.
- **Keeps ALL the code** — RLS, `auth.uid()`, `supabase-js` client, edge functions — you just point at
  your own URL. Near-zero application rewrite.
- Trade-off: you operate one VM (patching, backups). Not serverless.
- Cost: ~**$15–25/mo** (VM + disk).

### Path B — Self-host only the pieces we use (PostgREST + GoTrue) on Cloud Run + Cloud SQL  *(serverless, moderate rewrite)*
- Cloud SQL for Postgres; **PostgREST** + **GoTrue** as Cloud Run containers, wired with a shared JWT
  secret so **RLS still enforces**. Frontend keeps `supabase-js` (env vars repointed).
- More GCP-native and scale-to-zero; more wiring (JWT config, Auth Proxy, cold starts).
- Cost: ~**$10–15/mo**.

### Path C — Full GCP-native rebuild (Identity Platform + custom API)  *(most native, most work)*
- Cloud SQL + **Identity Platform** (replaces Auth → rewire the RLS session context) + a **hand-built
  API** on Cloud Run to replace PostgREST + edge functions on Cloud Run.
- Biggest lift: you rebuild auth **and** the entire API surface the frontend depends on. Lowest
  lock-in, most managed.
- Cost: ~**$10–15/mo**.

**Recommendation:** For an internal tool this size (few users, tiny data) with one junior dev,
**Path A** gets you onto GCP with the least risk and preserves the system we just validated. **Path C is
more engineering than the app warrants right now** — revisit it only if Execo standardizes on Identity
Platform. *Pick the path before touching anything.* The phases below assume **Path A/B (keep the code)**;
Path C deltas are flagged with **[C]**.

### ✅ DECISION (2026-08-01): **Path B** — Cloud SQL + PostgREST + GoTrue on Cloud Run
Chosen because Execo runs on **Google Workspace** (want serverless/managed GCP, not a VM to patch) and
the **~$10–15/mo budget is approved** (Sharad → Oliver; IT = Marius Joyosa). Provisioning is in flight
via IT.

**Auth sub-decision (Google Workspace SSO):** login moves to **"Sign in with Google," restricted to
`@execo.com`.** Two ways to do this in Path B:
- **B1 — self-host GoTrue with Google as an OAuth provider** *(recommended, least rewrite).* GoTrue
  keeps issuing the same Supabase-style JWTs (UUID `sub`, `role: authenticated`), so **RLS, `auth.uid()`,
  `user_roles`, `profiles`, and the `supabase-js` client are all unchanged** — we only add Google as a
  sign-in provider (using the OAuth client from IT) and enforce the `@execo.com` domain. User IDs stay
  UUIDs.
- **B2 — Identity Platform** *(managed, but invasive here).* Firebase UIDs are **not** UUIDs, so switching
  means retyping/remapping `user_roles.user_id` + `profiles.id`, rewiring `auth.uid()` and PostgREST's JWT
  validation (incl. the missing `role` claim). More risk for little gain on an app this size.

→ **Go with B1.** The **OAuth client** IT is issuing is needed either way; **Identity Platform can stay
enabled but unused** (harmless) — no need to change the IT request. If Execo later mandates Identity
Platform org-wide, B2 is a contained follow-up.

---

## 2. Target architecture (recap)
```
   Managers' browsers
          │
   Firebase Hosting (or Cloud Run if SSR)      ← FRONTEND (React build)
          │  HTTPS
   API + Auth + Webhooks                        ← BACKEND
     Path A: Supabase stack on 1 VM
     Path B: PostgREST + GoTrue on Cloud Run
     [C]:    Identity Platform + custom API on Cloud Run
          │  Cloud SQL Auth Proxy (Path B/C)
   PostgreSQL (Cloud SQL, or Postgres in the VM)  ← DATABASE
     tables · RLS · triggers · functions · pg_cron
   Secrets → Secret Manager · Images → Artifact Registry · CI → Cloud Build/GitHub Actions
   HubSpot / Omni ──webhook──► backend
```

---

## 3. Phased execution

### Phase 0 — Foundations & ownership  *(no app changes yet)*
- **Own the pipeline:** GitHub is already the source of truth — set up **CI (GitHub Actions or Cloud
  Build)** to build/deploy, so deploys no longer depend on Lovable.
- **GCP project:** new project *or* Execo's existing org (confirm billing impact first — a shared org
  still bills our resources). Enable APIs: Cloud SQL, Cloud Run, Artifact Registry, Cloud Build, Secret
  Manager, (Compute Engine for Path A / Identity Platform for **[C]**).
- **IAM:** project roles for Pucci + Sharad + Marius.
- **Budget + alerts** ($15 / $20 thresholds).
- **Confirm the frontend build mode:** is TanStack Start used as an **SSR** app (server routes) or an
  effectively client-only SPA? SPA → Firebase Hosting; SSR → Cloud Run. Decide here.

### Phase 1 — Database
- Provision **Cloud SQL** Postgres (`db-f1-micro`, single-zone) **[B/C]**, or Postgres inside the
  self-host stack **[A]**.
- Recreate the schema by **replaying `supabase/migrations/*`** (they're the source of truth) — do **not**
  hand-copy.
- Migrate data: `pg_dump` from Supabase → restore into the new DB. Verify **row counts** per table.
- Verify carry-over: **RLS policies, triggers, `SECURITY DEFINER` functions, enums (COS/OPEX)**, and the
  **pg_cron** daily snapshot (install the extension; on Cloud SQL set the `cloudsql.enable_pg_cron` flag).

### Phase 2 — Auth (Path B → **B1: GoTrue + Google SSO**)
- Run **GoTrue** on Cloud Run → issues the same Supabase-style JWTs, so `auth.uid()` + RLS are
  **unchanged**.
- Enable the **Google** external provider using the **OAuth client from IT**; set the redirect URL to the
  GoTrue callback.
- **Restrict sign-in to `@execo.com`** — via the Google provider config and/or a signup check (reject
  non-execo emails in a `before-user-created` hook or a trigger on the auth users table).
- **Migrate users:** existing role/profile rows key on the Supabase auth UUID. On first Google login,
  match by **email** and map each person to their `user_roles` / `profiles` row (link the new identity, or
  pre-seed the mapping) so roles carry over. IDs stay UUIDs — no schema change.
- *(Alt **B2 — Identity Platform**: managed, but requires retyping user IDs UUID→Firebase-UID across
  `user_roles`/`profiles`, rewiring `auth.uid()` + PostgREST JWT validation. Deferred — see the decision
  in §1.)*

### Phase 3 — API layer
- **[A/B]** **PostgREST** against the DB, configured with the JWT secret so **RLS enforces**. Frontend
  keeps `supabase-js`; repoint `SUPABASE_URL` / `ANON_KEY` to the new gateway.
- **[C]** Build the REST/RPC endpoints the frontend needs (replace every `supabase.from(...)`), enforce
  authz in code.

### Phase 4 — Edge functions → backend
- Port **`hubspot-webhook`** + **`omni-webhook`** (Deno) — keep them in the Supabase edge runtime **[A]**
  or containerize onto **Cloud Run** **[B/C]** (Deno runs fine in a container).
- Move secrets to **Secret Manager**: `OMNI_TOKEN`, `OMNI_SUBDOMAIN`, `OMNI_WEBHOOK_SECRET`, the
  **HubSpot token (ROTATE during the move — it was exposed)**, DB service creds, JWT secret.
- **Re-point external webhooks:** update callback URLs in **HubSpot** and **Omni** to the new endpoints;
  keep public + signature verification (HMAC).

### Phase 5 — Frontend
- Build the app; point the client env vars at the new API + auth URLs.
- Deploy to **Firebase Hosting** (free SSL/CDN/custom domain), or **Cloud Run** if SSR (per Phase 0).

### Phase 6 — Cutover
- Short **write freeze** on Supabase → final `pg_dump` delta → restore → flip **DNS**/domain →
  **smoke-test the critical flows**: login, HubSpot sync, Omni sync (roster + leave), create allocation,
  Bench report, Upcoming Leave. Watch logs.
- **Rollback:** keep Supabase live with **low DNS TTL**; if anything breaks, point back. **Don't
  decommission for 1–2 weeks.**

### Phase 7 — Post-migration
- Decommission **Lovable + Supabase** once stable.
- **Backups:** Cloud SQL automated backups **[B/C]**, or scheduled `pg_dump` → GCS **[A]**.
- **Monitoring:** Cloud Logging + an uptime check + alerts (webhook failures, 5xx).
- Update docs; then — separately — do the **real-Omni-tenant cutover** (service account + verify Service
  Line/Classification + least-privilege test, per [OMNI-API.md](OMNI-API.md)).

---

## 4. Cross-cutting checklists

**Secrets / external re-pointing**
- [ ] **Rotate** the HubSpot token (exposed earlier) — do it as part of the move.
- [ ] All secrets into **Secret Manager** (nothing in code/env files committed).
- [ ] Re-register webhook URLs: **HubSpot**, **Omni**.
- [ ] DNS: app domain → frontend host; API domain → backend.

**Data integrity**
- [ ] Row-count parity per table after restore.
- [ ] Spot-check a few resources/projects/allocations end-to-end.
- [ ] Confirm the pg_cron snapshot fires once on the new DB.

**Don't add (keeps cost ~$10–15/mo, per GCP-HOSTING.md)**
- No Serverless VPC connector (use Cloud SQL Auth Proxy), no HA standby, no Load Balancer/Cloud Armor.

---

## 5. Risks & effort (honest)

| Risk | Mitigation |
|---|---|
| Auth/RLS is the crux | **Path A/B preserves it** (recommended). **[C]** = isolate + heavy test. |
| pg_cron on Cloud SQL | Enable `cloudsql.enable_pg_cron` flag. |
| Deno edge fns on Cloud Run | Containerize; re-test HMAC signature verification. |
| Data loss on cutover | Row-count checks + keep Supabase as live rollback for 1–2 weeks. |
| SSR assumption wrong | Confirm build mode in Phase 0 before choosing Firebase vs Cloud Run. |
| Cost creep | Budget alerts; avoid the "don't add" list above. |

**Rough effort:** Path A ≈ **days** (infra + data + DNS). Path B ≈ **1–2 weeks** (container wiring).
Path C ≈ **3–5+ weeks** (auth + API rewrite + test). Real-Omni go-live happens **after** the platform is
stable — never both at once.
