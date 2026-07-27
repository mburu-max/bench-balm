# System Gaps & Recommendations

_Assessment as of 2026-07-27. Overall: a strong, well-architected MVP (~7/10). The domain modeling,
integrity enforcement (triggers), RBAC/RLS, audit trail, and automated snapshots are done properly —
the gaps below are about **hardening for production**, not missing core features. Closing #1 and #2
takes this to ~8.5–9._

## Summary

| # | Gap | Severity | Effort |
|---|---|---|---|
| 1 | No automated tests | High | Medium |
| 2 | Not production-hardened (dev/personal env) | High | Medium |
| 3 | Integrations not live / unvalidated | Medium | Low–Medium |
| 4 | Access-control tables not audited | Medium | Low |
| 5 | Partial features (demand / forecast) | Medium | Medium |
| 6 | Blocked dashboard metrics | Low | Medium |
| 7 | Migration-tracking drift risk | Low | Low |
| 8 | Exposed HubSpot token | Low | Low |

---

## 1. No automated tests — **High**
There are currently no application tests. Every change is verified manually, so regressions in the
trickier logic (allocation cap, leave/bench derivation, status transitions) can slip through silently.

**Recommendation**
- **Unit tests (Vitest)** for the pure logic: `src/lib/bench.ts`, `src/lib/leave.ts`, `src/lib/staffing.ts`,
  `src/lib/dashboard.ts` (the leave/bench/on-leave derivations have real edge cases — start here).
- **Database tests (pgTAP or a seeded test project)** for the triggers and RLS: `validate_allocation_cap`
  (incl. Leave exemption), `validate_project_transition` (draft→active, hold→active, reject→resubmit),
  and the audit triggers.
- **A few e2e happy-paths (Playwright)** for the critical workflows: create→verify→activate a project,
  PM staffs → SL approves, hold-with-remarks → resolve.
- Wire it into CI so it runs on every push.

## 2. Not production-hardened — **High**
The system runs on a personal Lovable account with a publicly published preview, and auth/RLS haven't
had a formal review. No HA/backups configured (expected for dev).

**Recommendation** (see `MIGRATION.md` for the mechanics)
- Move to the **work account** — new repo + new Supabase project + replay migrations + reset secrets.
- **Review RLS end-to-end** and confirm every table denies by default; test each role.
- Turn on **automated backups + point-in-time recovery**; lock down the preview/URL behind auth.
- Keep the environment off the AI-builder before real data goes in.
- Only then connect real data.

## 3. Integrations not live / unvalidated — **Medium**
HubSpot is connected but the **backfill field-mapping is unverified at scale**; Omni is fully built but
deliberately not connected (correct — it carries employee PII, wait for the hardened work account).

**Recommendation**
- HubSpot: run a full backfill against real data, verify company/deal → customer/project + enrichment
  (service line, region, deal owner) land correctly; tune mappings as needed.
- Omni: validate the field mapping with an **Omni sandbox org or dummy employees** first (docs specify
  webhook payloads but not the `/employee/list/` shape), then connect only on the hardened work account.
- Redeploy the edge functions (`hubspot-webhook`, `omni-webhook`) so the latest logic is live.

## 4. Access-control tables not audited — **Medium**
`projects`, `allocations`, `resources`, `customers`, `demand_requests`, `profiles` are audited, but
`user_roles` (who has which role) and `user_service_lines` (who's scoped to which lines) are **not** —
these are the highest-value security-audit targets.

**Recommendation**
- Add the existing `audit_row_change()` trigger to `user_roles` and `user_service_lines` (both have an
  `id` column, so it drops in unchanged) and add them to the Audit page filter. Do this before go-live.

## 5. Partial features — demand & forecast — **Medium**
`demand_requests` and `headcount_forecast` tables exist (with workflow columns) but have no dedicated
UI — scaffolded, not finished.

**Recommendation**
- Decide the intent: **build the capacity-planning/demand UI** (demand intake → fulfilment against
  bench, headcount forecasting) or **hide/remove** the scaffolding so it isn't dead weight. If building,
  it's a natural next module that ties bench supply to demand.

## 6. Blocked dashboard metrics — **Low**
Bench Cost Runway and Non-Billable Breakdown can't be built yet — they need cost/rate and cost-category
fields that don't exist in the schema.

**Recommendation**
- Add the required schema fields (resource/allocation cost or bill-rate, non-billable category), then
  build the two metrics. Until then, keep them off the dashboard rather than showing placeholders.

## 7. Migration-tracking drift risk — **Low**
Several DB changes this cycle were applied directly to the database *and* committed as migration files.
They're idempotent, but Lovable's migration history may not "know" they ran, and Lovable can regenerate
a function and revert a hand-edit (it regenerated `validate_project_transition` once).

**Recommendation**
- Treat the `supabase/migrations/*` files as the **source of truth**; if a behavior ever reverts,
  re-run the matching migration.
- When asking Lovable for DB work, tell it **not** to modify `validate_project_transition`,
  `validate_allocation_cap`, or the audit triggers.
- At the work-account handoff, rebuild from migrations so tracking and schema match cleanly.

## 8. Exposed HubSpot token — **Low (hygiene)**
The HubSpot token appeared in screenshots earlier and is a live credential.

**Recommendation**
- Rotate it and store the new value only as a server-side edge-function secret (never in source or
  tracked files). Do this at the work-account handoff at the latest.

---

## Suggested order to production
1. **Tests** around the trigger/bench/leave logic (#1) — protects everything else during the move.
2. **Work-account handoff + hardening** (#2) — replay migrations, RLS review, backups, rotate token (#8).
3. **Audit the access-control tables** (#4) — quick, high security value.
4. **Validate integrations** on the hardened env (#3) — HubSpot real data, then Omni sandbox.
5. **Decide demand/forecast** (#5) and **cost-metric fields** (#6).

_Strengths for context: full project lifecycle with trigger-enforced transitions, 100% allocation-cap
enforcement, leave-aware bench (short vs extended), RBAC + RLS + SL scoping + "view as", audit trail
across 8 tables with actor names, automated allocation snapshots + utilization trend, and two built
integrations (HubSpot, Omni HR)._
