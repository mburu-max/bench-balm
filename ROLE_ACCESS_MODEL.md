# Role & Access Model — Resource Flow (bench-balm)

**Status:** Source of truth for who-can-see and who-can-do. Reflects the implemented system
as of 2026-07-09 (top-down project creation: SL Lead initiates + assigns the PM). Where the code
and this document disagree, treat it as a bug in one of them and reconcile. Sections marked
**⚠ GAP** are known open items.

**Scope:** This is a **management tool**. Its active users are the management roles — Governance
Lead, Finance, Service Line Lead, Project Manager (and Developer). **Resources (the
allocated employees) do not use the system in v1.** The `resource` self-service role and its
surface (My Profile, leave request/return, forced-password-change) are built and retained as a
**future-expansion placeholder** — dormant by design — so the system is ready if resources are
onboarded later. Nothing scopes to a resource today because none are linked.

This document is written to double as a **test oracle** — §7 maps every rule to the exact DB
object (policy / trigger / function) that enforces it, so each row can be asserted directly.

---

## 1. Roles & hierarchy

| Level | Role (enum) | One-line purpose |
|---|---|---|
| L0 | `developer` (`admin` legacy) | Full access to everything. Superuser. Manages users/roles. |
| L1 | `governance_lead` | Owns master data + dashboard; final gate on project activation. Sees everything. |
| L1r | `finance` | **Read-only** everywhere. No write under any circumstance. |
| L2 | `service_line_lead` | Initiates projects (own SL) & assigns the owning PM; validates drafts; manages allocations & resources within assigned service line(s). Sole validator (Delivery Lead cut). |
| L3 | `project_manager` | Owns and staffs the projects an SL Lead assigns to them; manages allocations on those projects. Sees only their projects. **Does not create projects.** |
| L5 | `resource` | **Future expansion — not used in v1.** Self-service view of own profile + allocations; requests leave. Retained but dormant (see Scope note above). |

Notes:
- **Decision (ruled, July sync):** the **Delivery Lead role is cut** — validation sits entirely
  with the Service Line Lead. The `delivery_lead` enum value stays in the DB (Postgres can't drop
  it) but grants **nothing**: `is_dl()` and `is_sl_lead()` no longer match it, and it can't be
  assigned or previewed in the UI. `is_dl()` is retained only as an internal alias of the SL-Lead
  validator capability so existing policy gates still read.
- **Developer** implies every capability below it; assume "Developer" in every "yes" cell.
- **Governance Lead** in the UI includes Developer; in DB policies it is written
  `is_developer() OR is_governance_lead()`.
- Legacy/unused: `admin`, `viewer`, and a dangling `resource_manager` enum value (**⚠ GAP** — never
  wired; decide to scrub or ignore).

---

## 2. Access matrix (entity × role)

`R` = read, `W` = write. Scope in parentheses. Blank = no access.

| Entity | Developer | Governance Lead | Finance | SL Lead | Project Manager | Resource |
|---|---|---|---|---|---|---|
| **Customer Master** | R·W | R·W | R (all) | R (all) | R (all) | R (all) |
| **Project Registry** | R·W | R·W | R (all) | R (own SLs) · W (create + edit own SLs) | R (own projects) | R (allocated projects) |
| **Resource Master** | R·W | R·W | R (all) | R (own SLs) · W (own SLs) | R (own projects' resources) | R (self) |
| **Allocation Ledger** | R·W | R·W | R (all) | R (own SLs) · W (own SLs) | R (own projects) · W (own projects) | R (self) · W (leave via RPC) |
| **Snapshots** | R·W | R·W | R (all) | R (all) | R (all) | R (all) |
| **Audit Log** | R | R | R | | | |
| **Service Lines (config)** | R·W | R·W | R | R | R | R |
| **Headcount Forecast** | R·W | R·W | R | R | R | R |
| **User Roles / SL assignments** | R·W | | | | | |

Key points that were deliberate decisions:
- **Customer Master is global-read for everyone** (RA §9.1 "read = all stakeholders"). It is the one
  entity not scoped by service line.
- **Finance has zero write** anywhere (tracker RBAC-03). Its value is read/visibility only.
- **PM read of Resource Master is strict** (only resources already on their projects). To *staff*
  from the bench the allocation form uses a separate widened pool — see §5.2.

---

## 3. Visibility scoping (the data subset each role sees) — VERIFIED

Read scope is enforced in Postgres RLS, so it applies to every query including dashboards, lists,
and exports. Verified 2026-07-02 by simulating each role's real session:

| Role | Projects / Resources / Allocations they can read |
|---|---|
| Developer / Governance / Finance | **Everything** (global). |
| SL Lead | Only rows in their **assigned service line(s)** (`user_service_lines`). *Verified: a CLM+DLaaS lead saw only CLM/DLaaS and none of MS/CCaaS/Legacy.* |
| Project Manager | Only their **own projects** + the resources/allocations on them. *Verified: a PM owning one project saw exactly that project, its 2 resources, its 2 allocations.* |
| Resource | Only **themselves** + their own allocations + projects they're allocated to. *Verified: saw 1 resource (self), 1 allocation, 1 project.* |

"Assigned" is dynamic — read from `user_service_lines` (SLs) and `projects.project_manager_user_id`
(project ownership). It is **not** "one service line per person": a lead may hold several SLs, a PM
several project codes, and they see the union.

### Dashboard & filter behavior
| Role | Dashboard | Service-line filter |
|---|---|---|
| Governance / Finance / Developer | Company-wide operational view | All 5 SLs; defaults to company-wide |
| Multi-SL Lead | Service-line view | Dropdown limited to **their** assigned SLs |
| Single-SL Lead | Service-line view | No dropdown (locked to their one SL by RLS) |
| Project Manager | "My Projects" view | No dropdown |
| Resource | My Profile only | — |

---

## 4. Action hierarchy — project lifecycle

Status flow: `Draft → Active → (On_Hold ⇄ Active) → Closed`, with `Rejected` as an exit from Draft.
The legacy `Verified` state stays in the enum for old rows but is no longer used — Governance
verifies a Draft **straight to Active** (single approval gate).

| Transition | Who may perform it | Notes |
|---|---|---|
| *(create)* → **Draft** | SL Lead (own SL), Governance, Developer | Step 1. **PM can no longer create** — the SL Lead initiates the project and assigns its owning PM. |
| Draft → **Active** *(Verify)* | Governance, Developer | **Single approval gate** — Governance *verifies* a Draft straight to Active (the "Verify" action). Surfaced via the Governance verification queue. **SL Leads no longer verify.** Activating raises the assigned PM's "assign resources" flag. No contract gate (Finance gate deferred, June 30). |
| Active → **On_Hold** | Governance, Developer | **Governance-only** — SL Leads are prohibited (trigger raises on a non-Governance hold). Hold button shows on Active rows only. |
| Draft → **Rejected** | Governance, SL Lead (own SL), Developer | |
| → **Closed** | Governance, SL Lead *(trigger)* | **⚠ GAP** — no UI action exposes "Close" yet. |
| *(delete)* | Governance, Developer | Blocked if the project has allocations, or is Closed (retention). |

Other actions:
- **Edit project fields** (description/customer/SL/dates/HubSpot): Governance + SL Lead
  (scoped to their SLs). **PM cannot edit** (UI). Project code is auto-generated and locked.
- **Allocate a resource** (create/edit/delete allocation rows): Governance, SL Lead (own SL),
  PM (own projects). Finance/Resource cannot.
- **Resource status** Active/On_Leave/Exited: Resource-Master writers. A Resource self-serves
  leave via `request_leave` / `return_from_leave`.

---

## 5. Process flows

### 5.1 Project Activation Lifecycle (top-down)
1. **SL Lead** creates a project in one of their **assigned service lines** → saved as **Draft**
   (code auto-generated `[SL]-[CUST]-NNN`, e.g. `DLA-AIM-001`), and assigns the owning **PM** on creation
   (`project_manager_user_id`, picked from `list_project_managers()`).
2. The Draft goes to the **Governance Lead's** verification queue. (The PM can already see the
   project on their dashboard, but it isn't actionable until it's Active.)
3. **Governance Lead** clicks **Verify** → **Active** in one step — the single approval gate
   (the legacy `Verified` state is skipped).
4. Activation raises the "assign resources" flag on the assigned **PM's** dashboard, and the
   project becomes selectable for allocation — the PM then staffs it.

### 5.2 Direct Resource Allocation
- **PM or SL Lead** allocates directly (no demand-raising step — removed June 30).
- **Decision (ruled):** the design doc's "PM raises a demand request (Day 0)" and the "Day-30
  check" are **superseded by Sharad's decision** — direct ledger submission, no intermediate
  approval/review steps. Not built, by design.
- The resource picker draws from an **allocatable pool** (`allocatable_resources()`): global/SL-lead
  see their normal scope; a **PM can pull from the bench in their projects' service line(s)** even
  though their dashboard stays limited to their own project team.
- On insert the rules engine (§6) runs: active project, active resource, ≤100% cap, dates-in-window.

### 5.3 Leave (self-service)
- Resource calls `request_leave` → inserts a `Leave` allocation and sets status `On_Leave`.
- `return_from_leave` closes it and restores `Active`.
- Leave > 5 days is flagged as **Extended Leave** (escalation indicator).

### 5.4 Resource exit / off-boarding
- Status set to **Exited**; the record is **retained** (cannot be deleted).
- **⚠ GAP** — auto-closing the exited resource's open allocations to the exit date is **not built**
  (RA §7.3 specifies it). Currently must be done manually.

### 5.5 User provisioning
- **Developer** creates a login via Admin → Users → Create user (`admin-create-user` edge function,
  service-role). Assigns role + service lines in one step.
- New user gets a temp password and is **forced to change it on first login**.
- Public self-registration is disabled in the UI. **⚠ GAP** — fully closing signups (incl. new Google
  users) requires the Supabase Auth dashboard toggle "Allow new users to sign up = OFF".

---

## 6. Allocation rules engine

| Rule | Statement | Enforcement | Level |
|---|---|---|---|
| R-01 | Total allocation ≤ 100% at any point | `validate_allocation_cap` | Hard block; Governance override w/ reason |
| R-02 | Allocation dates within project window | `validate_allocation_dates` | Warning + override, else hard block |
| R-03 | Only Active projects can receive allocations | `validate_allocation_project_active` | Hard block (insert) |
| R-04 | On-Leave/Exited resources get no new allocations | `validate_resource_active_for_allocation` | Hard block (insert; Leave exempt) |
| R-05 | Every allocation has an end date | `allocations.allocation_end_date NOT NULL` | Schema |
| R-06 | Bench > 10 days review | *(not enforced)* | **⚠ GAP** — soft alert only |
| R-07 | Contractor billing set correctly | UI hint | Advisory |
| R-08 | Non-billable needs INT-/NB- code | *(not enforced)* | **⚠ GAP** — advisory only |
| — | No duplicate allocation rows | `uq_allocation_no_dupe` unique index | Hard block |
| — | Allocation model is mandatory (engagement pattern) | UI-required, nullable column | Soft |

---

## 7. Enforcement map (test oracle)

Each guarantee → the object that enforces it. A regression = any of these not behaving as stated.

| Guarantee | Enforced by |
|---|---|
| Read scope (projects/resources/allocations) | policies `projects_select`, `resources_select`, `allocations_select` + `has_sl_access()`, `my_pm_project_ids()`, `my_allocated_project_ids()`, `pm_project_resource_ids()`, `my_resource_ids()` |
| Customers global-read | policy `customers_select` = `true` |
| Finance zero-write | Finance absent from `*_write` / insert / update / delete policies |
| Master-data write = Governance | `customers_write`, `resources_write` (+ `is_sl_lead` for resources) |
| Project create = SL Lead (own SL)/Gov/Dev | policy `projects_insert` = `is_developer() OR is_governance_lead() OR is_sl_lead(service_line)` |
| PM assignment roster (creation dropdown) | function `list_project_managers()` (SECURITY DEFINER; PM users only) |
| Project transitions (incl. On-Hold = Governance-only) | trigger `validate_project_transition` |
| Delete protection | triggers `prevent_project_delete_with_allocations`, `prevent_closed_project_delete`, `prevent_exited_resource_delete` |
| Allocation rules R-01…R-04 | triggers listed in §6 |
| Duplicate allocations | index `uq_allocation_no_dupe` |
| Audit trail | triggers `trg_audit_*` → `audit_row_change()` |
| Project code generation | function `next_project_code(service_line, customer_id)` → `[SL]-[CUST]-NNN` (SL = first 3 letters of the service line; CUST = first 3 letters of the customer name; NNN per SL+customer) |
| PM staffing pool | function `allocatable_resources()` |
| Cross-SL-accurate load (bench/utilisation) | function `resource_current_load()` — totals across the whole ledger so loaned-out resources count as unavailable |
| Role/SL resolution | `is_developer/is_governance_lead/is_finance/is_dl/is_sl_lead/is_pm/is_resource_role/has_sl_access` |
| Provisioning | edge function `admin-create-user` (developer-gated) |
| Force password change | `ForcePasswordGate` + `user_metadata.must_change_password` |

---

## 8. Known gaps & open decisions

1. **Finance live write-block** — verified structurally (absent from all write policies); a live
   UPDATE-as-Finance test still to be run to close the loop.
2. **Resource exit auto-close allocations** (§5.4) — not built.
3. **Close-project UI action** (§4) — trigger allows it; no button exposes it.
4. **PM edit** — hidden in UI, but `projects_update` RLS still allows a PM to edit their own Draft.
   Decide: tighten RLS to match the UI, or accept.
5. **Multi-project PM filter by project code** — not built (PM sees all their projects combined).
6. **Forecast Accuracy KPI** — dark; needs a headcount-input screen for `headcount_forecast`.
7. **`resource_manager` enum value** — dangling/unused; scrub or ignore.
8. **`contract_signed` column** — vestigial after the contract gate removal.
9. **Google new-user signups** — needs the Supabase Auth dashboard toggle.
10. **No automated tests** — the RLS scoping proven by hand has no regression guard. Highest-value
    next investment: a small automated version of the §3 simulations.
11. **Migration-file vs live-DB drift** — DDL was applied directly via the DB tool *and* written to
    migration files; they are believed consistent but not machine-verified.

---

## 9. How to use this document

- **Building a feature:** find the role in §2/§4, confirm the intended access, implement against the
  object in §7. If the feature needs access not in the matrix, update this doc first.
- **Reviewing a change:** if it touches a policy/trigger/function in §7, re-assert the matching §3
  guarantee (ideally with the RLS simulation).
- **Resolving ambiguity:** this document wins over memory. If it's silent, it's a gap — add it here
  as a decision before coding.
