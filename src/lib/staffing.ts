import { useProjects, useAllocations } from "@/lib/queries";
import { todayStr } from "@/lib/dashboard";
import type { CurrentRole } from "@/lib/useCurrentRole";

// Per-role "pending action" flag — the generalisation of the PM ready-to-staff signal. Each
// workflow handoff surfaces the projects waiting for THIS user to act, derived on read from their
// RLS-scoped projects + allocations (no notifications table). Mirrors the dashboard split:
//   Governance        -> "verify"  : Draft projects to verify (Draft -> Active)
//   Project Manager   -> "staff"   : Active projects with nobody allocated
//   Service Line Lead -> "approve" : Active, staffed projects awaiting their sign-off
// One flag per role, but the system is open to more handoffs — add a kind here and it flows to
// the Projects nav badge + dashboard banners automatically.
export type PendingKind = "verify" | "staff" | "approve" | null;

export function pendingKindFor(role: CurrentRole | undefined | null): PendingKind {
  if (!role) return null;
  if (role.isGovernanceLead) return "verify"; // developer included
  if (role.isPm) return "staff";
  if (role.isSlLead) return "approve";
  return null;
}

export function usePendingActions(role: CurrentRole | undefined | null) {
  const kind = pendingKindFor(role);
  const needsAllocations = kind === "staff" || kind === "approve";
  const projects = useProjects({ enabled: kind !== null });
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
  let items = all;
  if (kind === "verify") {
    items = all.filter((p) => p.status === "Draft");
  } else if (kind === "staff") {
    items = all.filter((p) => p.status === "Active" && !staffed.has(p.id));
  } else if (kind === "approve") {
    items = all.filter(
      (p) => p.status === "Active" && staffed.has(p.id) && !p.staffing_approved_at,
    );
  } else {
    items = [];
  }

  return {
    kind,
    items,
    count: items.length,
    isLoading: projects.isLoading || (needsAllocations && allocations.isLoading),
  };
}
