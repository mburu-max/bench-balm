# GCP Migration Guide — Firebase + Cloud Run + Cloud SQL

**Goal:** move off Supabase/Lovable to a Google-native stack for a Google Workspace org,
**preserving the RLS/trigger model verbatim** (Strategy A). This is written for the MVP; each
section flags **MVP now** vs **harden for the real system**.

**Target architecture**

```
Firebase Hosting (SPA)         Cloud Run                         Cloud SQL (PostgreSQL)
  React app (Vite build)  ──►  ├─ PostgREST  (your data API)  ──►  your schema:
  Firebase Auth SDK            │    enforces RLS as today            RLS, triggers, functions,
  (Google, domain-locked)     └─ api  (Node, tiny)                  enums, views, pg_cron
        │                          ├─ POST /auth/token  (Firebase ID token → PostgREST JWT)
        └── ID token ─────────────►└─ POST /admin/create-user (Firebase Admin SDK + DB)
```

Why this shape: PostgREST *is* the "backend" you already rely on (every `supabase.from()` and
`supabase.rpc()` maps to it 1:1), so self-hosting it on Cloud Run keeps ~all data code unchanged.
The tiny Node service exists only for the two things PostgREST can't do: verify Firebase tokens and
create Firebase users.

---

## Phase 0 — Prerequisites

- A GCP project + billing enabled; `gcloud` + `firebase` CLIs authenticated.
- Enable APIs: Cloud SQL Admin, Cloud Run, Artifact Registry, Secret Manager, IAM.
- Your Workspace domain (e.g. `execo.com`) for restricting sign-in.
- `pg_dump`/`psql` locally, and the Supabase DB connection string (Project → Settings → Database).

---

## Phase 1 — Database → Cloud SQL

### 1.1 Create the instance
```bash
gcloud sql instances create rf-pg --database-version=POSTGRES_15 \
  --tier=db-g1-small --region=us-central1 --storage-size=10GB
gcloud sql databases create resourceflow --instance=rf-pg
gcloud sql users set-password postgres --instance=rf-pg --password='<root-pw>'
# pg_cron so the snapshot job survives:
gcloud sql instances patch rf-pg --database-flags=cloudsql.enable_pg_cron=on
```

### 1.2 Dump only what you own (skip Supabase-managed schemas)
```bash
pg_dump "$SUPABASE_DB_URL" \
  --schema=public --no-owner --no-privileges \
  --file=public.sql
# also grab the ENUM types + extensions if not in public (usually they are)
```
Do **not** dump Supabase's `auth`, `storage`, `graphql`, `realtime` schemas — you replace those.

### 1.3 Recreate the `auth` shim (so RLS keeps working unchanged)
Your policies call `auth.uid()`/`auth.jwt()`. Recreate them to read PostgREST's request GUC. The
`sub` will be your **internal UUID** (see Phase 2 mapping), so `uuid` columns/FKs stay identical.
```sql
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid;
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb, '{}'::jsonb);
$$;

-- Your own users table replaces auth.users. Keep the SAME uuids you have today so
-- user_roles.user_id / resources.user_id / projects.project_manager_user_id all still resolve.
create table if not exists auth.users (            -- keep the name so FKs need no change
  id uuid primary key,
  email text unique,
  firebase_uid text unique,
  full_name text,
  created_at timestamptz default now()
);
```
> **MVP shortcut:** keeping the table named `auth.users` means your existing FKs (`references
> auth.users(id)`) restore with zero edits. **Harden later:** rename to `public.app_users` and
> repoint FKs if you want to drop the `auth` namespace entirely.

### 1.4 PostgREST roles
```sql
create role anon nologin;
create role authenticated nologin;
create role authenticator noinherit login password '<authenticator-pw>';
grant anon, authenticated to authenticator;
grant usage on schema public, auth to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
alter default privileges in schema public grant select,insert,update,delete on tables to authenticated;
-- anon gets nothing (your app requires login).
```

### 1.5 Restore + reseat the signup trigger
```bash
psql "$CLOUDSQL_URL" -f public.sql   # RLS, triggers, functions, enums, views, data
```
`handle_new_user` currently fires on `auth.users` insert to assign a default role. Keep that trigger
on the new `auth.users` table (the token-exchange service inserts rows there — Phase 2).

### 1.6 Snapshot job
Either keep `pg_cron` (enabled in 1.1) with your existing `cron.schedule('daily-snapshot', ...)`,
**or** delete it and use Cloud Scheduler → Cloud Run `POST /admin/snapshot` → `select take_allocation_snapshot()`.

---

## Phase 2 — Auth → Firebase (Google Workspace)

### 2.1 Firebase setup
- Create/attach a Firebase project to the same GCP project.
- **Authentication → Google provider = ON.** Add your Hosting domain to authorized domains.
- **Restrict to your org:** in the sign-in call pass `hd: 'execo.com'`, and reject non-domain
  emails in the token-exchange service (belt and suspenders).

### 2.2 Identity model (this is the elegant part)
- Firebase issues an **ID token** with a Firebase UID (a string, *not* a UUID).
- Your DB keeps **UUIDs**. The exchange service maps Firebase UID → your internal UUID via
  `auth.users.firebase_uid`. So `auth.uid()` still returns a UUID and **nothing in the schema changes**.
- **Provisioning gate (reuses your admin model):** Firebase can authenticate anyone in the domain,
  but the exchange service only issues a PostgREST token if the user exists in `auth.users`
  (admin-provisioned). Unknown domain user → 403. This is your "no self-registration" rule, enforced
  at exchange instead of in GoTrue.

### 2.3 Migrate existing users
- **Email/password users:** GoTrue stores **bcrypt**; Firebase `importUsers` accepts bcrypt. Export
  from Supabase `auth.users` (id, email, encrypted_password) and import, **preserving your UUID** as
  a mapping (store it in `auth.users.id`, set `firebase_uid` after import).
- **Google users:** no password to move — they just sign in with Google; link by email to the
  existing UUID row on first exchange.
> **MVP shortcut:** you have ~3 users. Skip the bulk import — recreate them via `/admin/create-user`
> and, for the two existing UUID-linked expectations, just insert the `auth.users` rows with the
> UUIDs you already use.

---

## Phase 3 — PostgREST on Cloud Run (your data API)

### 3.1 Container
Use the official `postgrest/postgrest` image. Config via env:
```
PGRST_DB_URI              = postgres://authenticator:<pw>@/resourceflow?host=/cloudsql/<conn-name>
PGRST_DB_SCHEMAS          = public
PGRST_DB_ANON_ROLE        = anon
PGRST_JWT_SECRET          = <HS256 secret shared with the exchange service>   # see note
PGRST_JWT_ROLE_CLAIM_KEY  = ."role"
PGRST_DB_POOL             = 10
```
> **Token verification choice.** Firebase ID tokens are RS256 and Firebase **rotates keys**, which a
> static PostgREST JWKS can't track. So the exchange service (Phase 4) verifies the Firebase token
> (Firebase Admin SDK handles rotation) and **re-mints a short-lived HS256 JWT** containing
> `{ sub: <internal-uuid>, role: "authenticated", exp }`. PostgREST verifies that with a static
> HS256 secret — simple and robust. PostgREST auto-populates `request.jwt.claims`, so `auth.uid()`
> works with no extra wiring.

### 3.2 Deploy (with the Cloud SQL connector)
```bash
gcloud run deploy postgrest --image=postgrest/postgrest \
  --add-cloudsql-instances=<conn-name> --region=us-central1 \
  --set-env-vars=PGRST_DB_URI=...,PGRST_DB_SCHEMAS=public,PGRST_DB_ANON_ROLE=anon,PGRST_JWT_ROLE_CLAIM_KEY=."role" \
  --set-secrets=PGRST_JWT_SECRET=pgrst-jwt:latest \
  --allow-unauthenticated   # PostgREST does its own JWT auth
```
Your `supabase.rpc('next_project_code' | 'allocatable_resources' | 'request_leave' | 'return_from_leave')`
calls all work unchanged — they hit PostgREST's `/rpc/<fn>`.

---

## Phase 4 — Tiny Node service on Cloud Run (`api`)

Two endpoints. ~150 lines total.

- **`POST /auth/token`** — `Authorization: Bearer <firebase-id-token>`:
  1. `getAuth().verifyIdToken(token)` (also assert `email` ends with your domain).
  2. Look up `auth.users` by `firebase_uid` (or link by `email` for migrated users). If none → 403.
  3. Sign HS256 `{ sub: users.id, role: 'authenticated', exp: now+1h }` with the shared secret → return it.
- **`POST /admin/create-user`** (developer-gated — verify caller's role via DB):
  1. `getAuth().createUser({ email, password })` → Firebase UID.
  2. Insert `auth.users(id = gen_random_uuid(), email, firebase_uid, full_name)`.
  3. Insert `user_roles` + `user_service_lines` (service-role DB connection).
  This replaces the `admin-create-user` edge function 1:1.

Deploy with `--add-cloudsql-instances`, Firebase Admin creds via the default service account, and the
HS256 secret in Secret Manager.

> **MVP shortcut:** skip the force-password-change flow for Google sign-in (Workspace SSO has no
> password). Keep it only if you also allow email/password.

---

## Phase 5 — Frontend → Firebase Hosting

### 5.1 Point the data client at PostgREST + Firebase token
`src/integrations/supabase/client.ts` — keep `supabase-js` for data (all 31 `.from()` calls stay),
swap the URL and feed it the exchanged token:
```ts
createClient(POSTGREST_URL, "anon", {
  accessToken: async () => await getExchangedPostgrestToken(),  // caches; re-exchanges near expiry
});
```
`getExchangedPostgrestToken()` = get Firebase ID token → `POST /auth/token` → cache the HS256 token.

### 5.2 Replace the 13 `supabase.auth.*` calls with Firebase Auth
Map: `signInWithPassword`→`signInWithEmailAndPassword`; Google → `signInWithPopup(GoogleAuthProvider, {hd})`;
`getUser`/`getSession`→`auth.currentUser`/`onAuthStateChanged`; `signOut`→`auth.signOut()`;
`updateUser({password})`→`updatePassword()`. Drop the Lovable OAuth wrapper (`src/integrations/lovable`).
`useCurrentRole` is unaffected — it reads `user_roles` via PostgREST, keyed by `auth.uid()`.

### 5.3 Build as a SPA + deploy
Your authenticated layout is already `ssr:false`; produce a client-only build (Nitro static / SPA
preset) so Firebase Hosting (free) can serve it.
```bash
firebase init hosting     # public dir = the built assets; single-page rewrite to /index.html
firebase deploy --only hosting
```
Add a rewrite so `/api/**` and data calls hit the Cloud Run services (or just use their URLs directly).
> **Alternative (keep SSR):** switch Nitro to the `node-server` preset, containerize, deploy the
> frontend to Cloud Run too, and use Firebase Hosting only as CDN/rewrite. More cost, keeps SSR.

---

## Phase 6 — Cutover checklist

1. Restore DB to Cloud SQL; run the §7 RLS simulations from `ROLE_ACCESS_MODEL.md` against Cloud SQL
   to prove scoping survived the move.
2. Deploy PostgREST + `api`; smoke-test `/auth/token` and a scoped `select` for each role.
3. Migrate/recreate users; verify one real login per role end-to-end.
4. Point the frontend env at the new URLs; deploy to Firebase Hosting.
5. Verify the snapshot job runs (pg_cron or Scheduler).
6. Freeze Supabase writes, final data sync, flip DNS/hosting, decommission Lovable/Supabase.

---

## Cost (paid Cloud SQL, your call)

| Service | MVP tier | ~Monthly |
|---|---|---|
| Cloud SQL | `db-g1-small` (or `db-f1-micro`) + 10GB | ~$25 (or ~$10 micro) |
| Cloud Run (PostgREST + api) | scale-to-zero | ~$0–5 |
| Firebase Hosting + Auth | Spark (free) | $0 |
| Secret Manager / egress | minimal | ~$0–2 |
| **Total** | | **~$12–35 / month** |

---

## MVP now vs. harden for the real system

| Area | MVP | Real system |
|---|---|---|
| DB access | Cloud SQL public IP + connector | Private IP + VPC, no public exposure |
| Secrets | Secret Manager, manual | Rotation, least-privilege SAs |
| Token exchange | HS256 shared secret | Short TTLs, key rotation, audit |
| Deploy | manual `gcloud`/`firebase` | CI/CD (Cloud Build), staging env |
| Users | admin-provisioned allowlist | SCIM/Workspace directory sync |
| Backups | Cloud SQL automated daily | PITR + tested restores |
| Auth shim | reuse `auth.users` name | own `public.app_users`, drop `auth` ns |

---

## Verdict

Fully feasible and **preserves the verified RLS model** — because your logic is standard Postgres and
PostgREST replicates the data API you already use. The only genuinely new code is one small Node
service (token exchange + admin create-user, ~150 lines). The rest is data migration + config +
swapping the auth SDK. Realistic effort for the MVP cutover: **~1–2 weeks**. Everything organization-
specific (Google Workspace SSO, domain lock, GCP-native ops) lands cleanly.

---

## Appendix A — Clean rebuild / de-Lovable checklist

The real system will live in your work account/GitHub. **Scaffold a fresh TanStack Start project and
port `src/` into it — don't clone this repo.** That gives a clean git history (no Lovable commits, no
`Co-Authored-By` trailers), no `@lovable.dev` deps from the start, and a codebase that reads as a
plain TanStack + Firebase + PostgREST app. Renaming files *in this repo* wouldn't achieve that — the
old commits would still show it.

Most Lovable pieces are removed by the migration itself (auth wrapper → Firebase, vite config →
standard, error reporting → your own). Full inventory to strip:

| Touchpoint | What it is | Action |
|---|---|---|
| `.lovable/` (project.json, plan.md) | Lovable project metadata | **Delete** — not created in a fresh scaffold |
| `src/integrations/lovable/` | Google OAuth wrapper (`@lovable.dev/cloud-auth-js`) | **Replaced** by Firebase Auth (Phase 5.2) |
| `src/lib/lovable-error-reporting.ts` | Lovable error telemetry | **Delete/replace** (own logger or Cloud Error Reporting) |
| dep `@lovable.dev/vite-tanstack-config` + `vite.config.ts` | Vite config wrapper | **Replace** with the standard `@tanstack/react-start` Vite plugin config |
| dep `@lovable.dev/cloud-auth-js` | Auth dep | **Remove** |
| `src/routes/auth.tsx` | Uses the Lovable OAuth wrapper | **Rewrite** to Firebase `signInWithPopup({ hd })` |
| `src/routes/__root.tsx` | Wires Lovable error reporting | Remove those lines |
| `src/integrations/supabase/{client,client.server,auth-middleware}.ts` | Comments + Lovable env handling | **Rewritten** anyway when repointed at PostgREST + Firebase |

Rebuild steps:
1. `npm create @tanstack/start@latest` (or the current scaffold) in the new work repo.
2. Copy `src/routes`, `src/lib`, `src/components`, `src/integrations/supabase` (→ rename to a neutral
   name like `src/lib/db`), and `supabase/migrations` (→ `db/migrations`).
3. Delete the three Lovable files/dirs above; drop both `@lovable.dev/*` deps.
4. Replace `vite.config.ts`, `auth.tsx`, `__root.tsx`, and the data client per Phase 5.
5. Grep to confirm zero hits: `grep -ri lovable src/ vite.config.ts package.json` → empty.
6. First commit in the fresh repo — clean slate.
