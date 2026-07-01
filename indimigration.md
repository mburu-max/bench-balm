# Independence from Lovable

Steps and effort required to run this app fully independently of the Lovable platform.

---

## 4 Main Dependencies to Replace

### 1. Auth — `@lovable.dev/cloud-auth-js` *(Most involved — ~1 day)*

Lovable wraps Supabase Auth with their own package. Replace it with standard `@supabase/supabase-js` auth directly. The underlying Supabase Auth (Google OAuth, email/password) is already there — it's just the wrapper that's Lovable-specific. Requires changes to the auth routes throughout the app.

### 2. Build config — `@lovable.dev/vite-tanstack-config` *(Easy — ~1 hour)*

Lovable's Vite config wrapper. Replace with a standard `vite.config.ts` using `@tanstack/start`. Their config is mostly sensible defaults — not hard to replicate.

### 3. Database & backend *(see full options below)*

### 4. Hosting *(Easy — ~1 hour)*

Since this is TanStack Start (SSR), you need a Node-capable host — **Vercel**, **Netlify**, or **Cloudflare Workers** all work. Static hosting won't work.

---

## Database Options

> **Important constraint:** This app uses Postgres-specific features heavily — RLS (Row Level Security), ENUM types, triggers, `pg_cron`, `generate_series`, and CTEs. Any option that isn't Postgres-compatible requires a significant rewrite of the migration files and backend logic. All options below are Postgres or Postgres-compatible for this reason.

---

### Option A — Supabase (own project, managed) ✅ Recommended for MVPs
**Best for:** Staying on the current stack with minimal migration effort.

- Create your own Supabase project at [supabase.com](https://supabase.com)
- Run the 7 migration files in `supabase/migrations/` via the dashboard SQL editor
- Free tier: 500MB DB, 2 projects, good for an internal MVP
- Pro tier ($25/month): daily backups, larger DB, no pausing — appropriate for org use
- You own the data; Supabase is just the host
- `npx supabase gen types typescript` replaces Lovable's types regen

**Tradeoffs:** Supabase is a US company (AWS us-east-1 by default, but EU regions available). Data stays in their cloud. If your org has strict data residency requirements, consider self-hosted instead.

---

### Option B — Supabase Self-Hosted (Docker)
**Best for:** Orgs that need on-premises or private cloud deployment, full data control.

- Runs the full Supabase stack (Postgres, Auth, PostgREST, Studio) in Docker on your own server
- All migrations, RLS, triggers work identically — zero code changes
- Requires a Linux server or VM (DigitalOcean Droplet, AWS EC2, on-prem machine)
- [docs.supabase.com/guides/self-hosting](https://supabase.com/docs/guides/self-hosting)

**Tradeoffs:** You manage the infra — updates, backups, SSL. More ops overhead than managed.

---

### Option C — Railway
**Best for:** Simplest managed Postgres + app hosting in one place, good developer experience.

- Managed Postgres with automatic backups, no pausing, generous free tier
- Also hosts the TanStack Start app on the same platform (no separate Vercel needed)
- Has a built-in Postgres dashboard, one-click deploys from GitHub
- Auth would need a separate solution (see Auth options below) since Railway is DB + hosting only

**Tradeoffs:** No built-in RLS enforcement at the API layer (that's Supabase's PostgREST layer). You'd need to handle auth/API separately — either via the app server directly (TanStack Start server functions can enforce roles server-side) or by keeping a Supabase project just for auth while using Railway for the DB.

---

### Option D — Neon (Serverless Postgres)
**Best for:** Cost-efficiency, scales to zero when not in use (good for an MVP that isn't used 24/7).

- Serverless Postgres with branching (like git branches for your DB — useful for testing schema changes)
- Very cheap: free tier generous, scales to zero between sessions
- Compatible with all the migration files — Postgres is Postgres
- Auth needs to be separate (Clerk, Auth0, or custom JWT)
- No native RLS enforcement at the connection layer (same tradeoff as Railway — enforce in server code)

**Tradeoffs:** Cold starts when the DB wakes up. RLS still exists in the DB schema but isn't auto-enforced via PostgREST like Supabase does — you'd rely on the app's server functions to check roles.

---

### Option E — AWS RDS / Azure Database for PostgreSQL / Google Cloud SQL
**Best for:** Orgs already running on a cloud provider and needing enterprise-grade reliability, compliance, and support.

- Fully managed Postgres on your existing cloud account
- SLA-backed uptime, point-in-time recovery, VPC isolation
- All migrations work as-is
- Auth handled separately (Azure AD / AWS Cognito / Auth0 depending on your cloud)
- More expensive than the above options but fits into existing enterprise procurement

**Tradeoffs:** More complex setup, more expensive, overkill for a small-team internal MVP but the right choice if you need SSO with your org's identity provider (e.g. Microsoft Entra ID / Azure AD).

---

### Option F — DigitalOcean Managed Postgres + App Platform
**Best for:** Simple, affordable, good for small teams without a cloud team.

- $15–25/month for managed Postgres with daily backups and failover
- App Platform can also host the TanStack Start SSR app directly from GitHub
- Good middle ground between managed simplicity and full cloud complexity
- Auth needs to be separate

---

## Auth Options (if not using Supabase)

If you move away from Supabase (Options C–F above), you'll need a separate auth solution:

| Option | Best for | Cost |
|---|---|---|
| **Supabase Auth only** | Keep Supabase just for auth, point it at your own DB | Free–$25/month |
| **Clerk** | Best developer experience, excellent RBAC, easy org/team management | Free up to 10,000 MAU |
| **Auth0** | Enterprise SSO, Microsoft Entra / Google Workspace integration | Free up to 7,500 MAU |
| **Keycloak (self-hosted)** | Full control, on-prem, integrates with corporate directory (LDAP/AD) | Free (self-hosted) |
| **Custom JWT** | Simple roll-your-own if the team is small and roles rarely change | Free (dev cost only) |

For an internal org tool that may need **SSO with your company's Microsoft/Google accounts**, **Auth0** or **Clerk** are the fastest path. Keycloak is worth it if you already have Active Directory and want full on-prem control.

---

## Recommendation for Your Use Case

Given this is an **internal org MVP** for resource allocation across service lines:

| Priority | Recommendation |
|---|---|
| Fastest path, least effort | **Option A** — own Supabase Pro project ($25/mo). Zero code changes, all features work including RLS, triggers, pg_cron. Add SSO later via Auth0 if needed. |
| On-premises / data residency required | **Option B** — Supabase self-hosted on a VM you control. Same code, full data sovereignty. |
| Already on Microsoft Azure | **Option E (Azure DB for PostgreSQL)** + **Auth0 with Entra ID SSO**. Fits into existing org procurement and IT approval process. |

---

## Bonus: `types.ts` Regeneration

Once on your own Supabase project (or any Postgres with Supabase CLI pointed at it):

```bash
npx supabase gen types typescript --project-id <your-project-id> > src/integrations/supabase/types.ts
```

---

## Migration Effort Summary

| Item | Supabase own project | Self-hosted / Other Postgres |
|---|---|---|
| Auth swap | ~1 day | ~1–2 days |
| Build config | ~1 hour | ~1 hour |
| DB migration (run 7 SQL files) | ~2 hours | ~2 hours |
| Hosting setup | ~1 hour | ~2 hours |
| Auth integration (SSO etc.) | Optional, later | ~1 day if adding SSO |
| **Total** | **~1–2 days** | **~2–4 days** |

Everything else — RLS policies, triggers, migrations, UI components, queries — is completely portable.
