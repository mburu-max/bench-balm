import { useProjects, useAllocations } from "@/lib/queries";
import { todayStr } from "@/lib/dashboard";
import type { CurrentRole } from "@/lib/useCurrentRole";
import { inSlScope } from "@/lib/scope";

// Per-role "pending action" flags — every workflow handoff surfaces the projects waiting for THIS
// user to act, derived on read from their RLS-scoped projects + allocations (no notifications
// table). A user has one effective role, but a role can carry MORE THAN ONE flag:
//   Governance        -> "verify"  : Draft projects to verify (Draft -> Active)
//   Project Manager   -> "staff"   : their own Active projects with nobody allocated
//   Service Line Lead -> "approve" : Active, staffed projects awaiting their sign-off, AND
//                        "rework"   : projects Governance rejected, to fix & resubmit
// Each item carries its own pendingKind so the nav badge, notification inbox and dashboard banners
// can render mixed flags together. Add a kind here and it flows to all three automatically.
export type PendingKind = "verify" | "staff" | "approve" | "rework" | "notify" | "assign_pm";

export type PendingItem = {
  id: string;
  project_code: string;
  service_line: string;
  status: string;
  customers?: { customer_name?: string | null } | null;
  pendingKind: PendingKind;
  [k: string]: any;
};

export function usePendingActions(role: CurrentRole | undefined | null) {
  // Role gating mirrors the old priority (Governance > PM > SL Lead); Developer counts as
  // Governance. Only the SL Lead branch emits two kinds.
  const isGov = !!role?.isGovernanceLead;
  const isPm = !!role?.isPm && !isGov && !role?.isSlLead;
  const isSl = !!role?.isSlLead && !isGov;
  const enabled = isGov || isPm || isSl;
  const needsAllocations = isPm || isSl;
  const projects = useProjects({ enabled });
  const allocations = useAllocations({ enabled: needsAllocations });
  const today = todayStr();

  const staffed = new Set(
    (allocations.data ?? [])
      .filter(
        (a) =>
          a.allocation_type !== "Leave" &&
          a.project_id &&
          a.allocation_start_date <= today &&
          a.allocation_end_date >= today,
      )
      .map((a) => a.project_id),
  );

  const all = projects.data ?? [];
  const items: PendingItem[] = [];
  const tag = (p: any, pendingKind: PendingKind) => items.push({ ...p, pendingKind });

  if (isGov) {
    for (const p of all) {
      if (p.status !== "Draft") continue;
      // HubSpot-sourced drafts are pre-approved (HubSpot was the gate) — Governance is notified,
      // not asked to verify. Manually-created drafts still need Governance verification.
      if ((p as any).hubspot_deal_id) tag(p, "notify");
      else tag(p, "verify");
    }
  }
  if (isPm) {
    // PM: their OWN active, unstaffed projects. RLS scopes a real PM; the ownership check also
    // keeps a developer's PM-account preview faithful (role.userId is the previewed PM's id).
    for (const p of all)
      if (p.status === "Active" && !staffed.has(p.id) && (p as any).project_manager_user_id === role?.userId)
        tag(p, "staff");
  }
  if (isSl) {
    for (const p of all) {
      if (!inSlScope(role, p.service_line)) continue;
      if (p.status === "Active" && staffed.has(p.id) && !p.staffing_approved_at) tag(p, "approve");
      else if (p.status === "Rejected") tag(p, "rework");
      // HubSpot-sourced draft awaiting a PM — assigning one activates it (no Governance step).
      else if (p.status === "Draft" && (p as any).hubspot_deal_id && !(p as any).project_manager_user_id)
        tag(p, "assign_pm");
    }
  }

  const byKind = (k: PendingKind) => items.filter((i) => i.pendingKind === k);
  return {
    items,
    count: items.length,
    byKind,
    countOf: (k: PendingKind) => byKind(k).length,
    isLoading: projects.isLoading || (needsAllocations && allocations.isLoading),
  };
}
