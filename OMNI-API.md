# Omni HR API — Authentication & Data Access

How to authenticate to the Omni API and pull employee data. **Verified live against the
`integrationtest` sandbox (2026-07-31).** Two things differ from Omni's published docs and cost us
time — they're called out as ⚠️ **Gotchas** below.

> **Never commit credentials or tokens.** The values below are placeholders — real ones live only in
> a secrets manager / gitignored `.env.local` / edge-function secrets.

## Key facts (read first)
- **Base URL:** `https://api.omnihr.co/api/v1`
- **Tenant scoping:** every request needs an **`X-Subdomain: <tenant>`** header. The tenant is the
  subdomain of your Omni login URL — e.g. `https://integrationtest.omnihr.co/...` → `integrationtest`.
- **Auth is a JWT.** A **Personal Access Token (PAT)** is a *durable* credential, but it is **not**
  accepted directly on data endpoints — you **exchange the PAT for a short-lived JWT**, then use the JWT.

## The flow at a glance
```
  email + password ──► JWT access ──► create PAT ──► [store PAT as a secret]
                                                          │
  PAT ──exchange──► short-lived JWT ──► call /employee/... endpoints
       (POST /auth/token/pat/)          (Authorization: Bearer <jwt> + X-Subdomain)
```

---

## Step 1 — Log in to get a JWT (needed only to create the PAT)
```bash
curl -X POST https://api.omnihr.co/api/v1/auth/token/ \
  -H "Content-Type: application/json" \
  -H "X-Subdomain: <tenant>" \
  -d '{"username":"<email>","password":"<password>"}'
# → { "access": "<jwt>", "refresh": "<jwt>" }
```
⚠️ **Gotcha 1 — X-Subdomain is required.** Without it the API replies `{"detail":"You have entered an
invalid email or password."}` even with correct credentials, because it can't resolve the tenant.

## Step 2 — Create a PAT (using the JWT from Step 1)
```bash
curl -X POST https://api.omnihr.co/api/v1/auth/personal-access-tokens/ \
  -H "Authorization: Bearer <jwt-from-step-1>" \
  -H "X-Subdomain: <tenant>" \
  -H "Content-Type: application/json" \
  -d '{"name":"resource-tool","expires_at":"01/01/2027 00:00:00"}'
# → { "id": 4, "name": "...", "token": "omni_pat_XXXXXXXX", "expires_at": "..." }
```
- The **`token` (`omni_pat_…`) is shown once** — store it immediately as a secret.
- ⚠️ **Gotcha 2 — date format.** `expires_at` must be **`DD/MM/YYYY hh:mm:ss`**, *not* ISO 8601.
  ISO (`2027-01-01T00:00:00Z`) returns `"Datetime has wrong format. Use ... DD/MM/YYYY hh:mm:ss."`

## Step 3 — Exchange the PAT for a JWT (before every batch of API calls)
```bash
curl -X POST https://api.omnihr.co/api/v1/auth/token/pat/ \
  -H "Authorization: Bearer omni_pat_XXXXXXXX" \
  -H "X-Subdomain: <tenant>"
# → { "access": "<jwt>", "access_exp": "<unix>" }
```
⚠️ **Gotcha 3 — the PAT is NOT a Bearer for data endpoints.** Calling `/employee/list/` with the raw
PAT returns `{"detail":"Given token not valid for any token type","code":"token_not_valid"}`. You must
exchange it here first. Re-exchange when `access_exp` passes.

## Step 4 — Call the API with the JWT
```bash
curl https://api.omnihr.co/api/v1/employee/list/ \
  -H "Authorization: Bearer <jwt-from-step-3>" \
  -H "X-Subdomain: <tenant>"
# → { "count": 35, "next": ".../employee/list/?page=2", "results": [ {employee...}, ... ] }
```
⚠️ **Gotcha 4 — the API lives at `api.omnihr.co`, not your tenant subdomain.** Your subdomain
(`<tenant>.omnihr.co`) serves the *frontend*; hitting `/api/v1/...` there returns `405 Not Allowed`
(nginx). Always call `api.omnihr.co` and pass the tenant via the `X-Subdomain` header.

---

## Managing PATs
```bash
# list
curl https://api.omnihr.co/api/v1/auth/personal-access-tokens/ \
  -H "Authorization: Bearer <jwt>" -H "X-Subdomain: <tenant>"
# revoke
curl -X DELETE https://api.omnihr.co/api/v1/auth/personal-access-tokens/<id>/ \
  -H "Authorization: Bearer <jwt>" -H "X-Subdomain: <tenant>"
```

## Employee endpoints
| Endpoint | Format | Contents |
|---|---|---|
| `GET /employee/list/` | **JSON**, paginated (`count`/`next`/`results`) | Core fields: `employee_id`, `full_name`/`preferred_name`, `primary_email.value`, `position`, `department` (flat), `location_name`, `employee_type`, `employment_status_display` (Active/Terminated). **No** manager / service line / classification. |
| `GET /employee/report/employees/` | **CSV** ("Resource Type Report") | Everything incl. **Manager Name** + the org's **custom fields** as `Group | Field` columns (Service Line / Classification appear here in the real Execo tenant). |
| `GET /employee/2.0/users/<user_id>/base-data/` | JSON | One employee's personal/base section (name, DOB, nationality, etc.). |

## How this app uses it (`supabase/functions/omni-webhook/index.ts`)
- Secret **`OMNI_TOKEN`** = the PAT (`omni_pat_…`).
- Secret **`OMNI_SUBDOMAIN`** = the tenant (e.g. `integrationtest`; the real Execo tenant later).
- `getOmniJwt()` exchanges the PAT → JWT once per invocation (Step 3) and caches it; `omni()` sends
  `Authorization: Bearer <jwt>` + `X-Subdomain` on every call. If `OMNI_TOKEN` isn't a `omni_pat_`
  value it's treated as an already-valid JWT.
- Backfill pulls the **CSV report** (`/employee/report/employees/`) — the only source with
  **Manager Name** + the org's custom fields (**Service Line / Classification** in the real Execo
  tenant) — parses the CSV, dedupes by `Employee ID` (prefers the Active row), maps each record
  (`mapReportRow`), and upserts into `resources`. It **falls back to `/employee/list/`** if the
  report is unavailable/empty; set `OMNI_BACKFILL_SOURCE=list` to force the JSON list. Webhooks
  handle real-time change events (they carry JSON, mapped by `mapEmployee`). See
  [[omni-hr-integration]] for the field mapping.
