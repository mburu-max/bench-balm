## Goal
Add strict, server-enforced RBAC for four roles (PM, DL, Finance/Governance, Developer) with a simplified Draft → Verified → Active project lifecycle, hidden/disabled UI per role, and a developer-only role admin screen.

## Assumptions (please correct if wrong)
1. **Role mapping onto existing enum.** I'll reuse the existing `app_role` enum and treat it as the single source of truth:
   - `pm` → `project_manager`
   - `dl` → `delivery_lead`
   - `finance` → `finance` (governance_lead kept as alias = Finance/Governance)
   - `developer` → add new `developer` value to the enum (replaces "admin" usage; existing `admin` rows migrated to `developer`)
2. **Each user has exactly one effective role.** Keep the `user_roles` table (one row per user) and add a helper `current_role()`. No multi-role stacking. New users default to `project_manager`.
3. **Lifecycle simplification.** Collapse current 4-state workflow to spec: `Draft → Verified → Active`. Map existing rows: `Pending_Delivery_Lead`→`Draft`, `Pending_Finance`→`Verified`. Keep `On_Hold/Closed/Rejected` as side states.
4. **"Assigned PM" for a project** = `projects.project_manager_id` (already exists, references resources). I'll add a nullable `project_manager_user_id` (FK to auth.users) so we can scope PM permissions to the *logged-in user*, not just a resource record. PMs without this set cannot edit allocations for that project.
5. **Signed contract gate** = existing `contract_signed` boolean on projects. Finance cannot move Verified → Active unless `contract_signed = true`.
6. **Developer flag** = the `developer` role itself acts as the global override (no separate boolean). Identified by role, not email — matches your "not by email" requirement.

## Data model changes (single migration)
- Add `developer` to `app_role` enum; migrate `admin` → `developer`; drop `admin` from enum.
- Add `projects.project_manager_user_id uuid` (FK `auth.users`, nullable, indexed).
- Update `project_status` enum: add `Verified`; migrate existing data; (keep old values temporarily then drop `Pending_Delivery_Lead`, `Pending_Finance`).
- New SECURITY DEFINER helpers:
  - `current_role()` → returns single `app_role` for `auth.uid()`
  - `is_developer()` → role = developer
  - `is_finance()` → role in (finance, governance_lead)
  - `is_dl()`, `is_pm()`
  - `is_project_pm(project_id)` → true if `projects.project_manager_user_id = auth.uid()`
- Rewrite RLS policies on **projects, allocations, customers, resources, user_roles**:

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| projects | all authenticated | pm/dl/finance/dev (status forced=Draft for pm) | pm: own Draft only; dl: Draft→Verified; finance: Verified→Active (requires contract_signed); dev: all | finance/dev |
| allocations | all authenticated | pm (only for own projects, project must be Active) / finance / dev | same scope | same scope |
| customers | all authenticated | finance/dev | finance/dev | finance/dev |
| resources | all authenticated | finance/dev | finance/dev | finance/dev |
| user_roles | self + dev | dev | dev | dev |

- Status-transition enforcement via a `BEFORE UPDATE` trigger on `projects` that validates allowed transitions per role and the `contract_signed` gate (RLS handles row visibility; trigger handles state machine + clearer errors).

## Backend (server functions)
- New `src/lib/auth.functions.ts` with `getCurrentRole()` returning `{ role, userId }` (uses `requireSupabaseAuth`). Cached via TanStack Query (`['currentRole']`).
- New `src/lib/admin.functions.ts`:
  - `listUsersWithRoles()` (developer only — verified server-side via `has_role`)
  - `setUserRole({ userId, role })` (developer only)
- Update `src/lib/queries.ts` mutations (projects status transitions, allocations CRUD, customers/resources CRUD) to go through server functions that re-check role server-side rather than direct supabase calls from the browser. RLS is the final gate, but server-fn checks give clean errors.

## Frontend
- **`useCurrentRole()` hook** wrapping the server fn; exposes booleans `isPm/isDl/isFinance/isDev` + `can(action, resource?)` helper.
- **AppShell sidebar** filtered by role:
  - PM, DL: Dashboard, Projects, Resource Allocation, Bench
  - Finance: + Customers, Resources, Project Allocation
  - Developer: everything + "Users" (role admin)
- **Action buttons** (`New Project`, `Approve to Verified`, `Lock to Active`, `New Customer`, edit/delete on Customers/Resources, allocation create/edit) hidden when `!can(...)` AND the underlying server fn rejects unauthorized callers.
- **Project rows & detail**: prominent `StatusBadge` for `Draft / Verified / Active` plus disabled-with-tooltip CTAs (e.g. "Lock to Active" disabled with reason "Signed contract required" when applicable).
- **Allocation editing** for PMs: project picker filtered to projects where they're the assigned PM (Active only).
- **Access denied UX**: shared `<AccessDenied/>` component + toast on server-fn 403. New `/_authenticated/forbidden` route for direct-URL hits.
- **`/_authenticated/admin/users`** route (developer only, guarded both in `beforeLoad` via role server fn and in RLS): table of users with role dropdown to reassign.

## Constants / labels
Update `src/lib/constants.ts`:
- `PROJECT_STATUSES = ["Draft","Verified","Active","On_Hold","Closed","Rejected"]`
- Add `ROLE_LABEL` map.

## Verification
- `tsgo` clean build.
- Manual Playwright pass: sign in as each seeded role; confirm sidebar, button visibility, and that direct API calls (via console) for forbidden mutations return 403 from RLS.
- Supabase linter run after migration.

## Open question before I start
Is mapping `admin`/`governance_lead` rows from existing data into the new scheme acceptable as: existing `admin` → `developer`, existing `governance_lead` → `finance`? If you'd rather keep both `governance_lead` and `finance` as distinct roles with identical permissions, say so and I'll keep both enum values.
