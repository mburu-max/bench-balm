import { useMemo } from "react";
import { useCurrentRole, type CurrentRole } from "@/lib/useCurrentRole";
import { useAllocations, useProjects } from "@/lib/queries";

// Service-line scope of the current view. Empty = unrestricted (Governance / Finance / Developer,
// and PM / Resource whose scope isn't service-line based). For a real SL Lead this is their
// assigned service line(s); for a developer previewing an SL-Lead account it mirrors that account's
// service lines — so these client-side filters stay faithful even though RLS answers as the real
// developer account. A no-op for real SL Leads (RLS already scopes their data server-side).
export function inSlScope(
  role: CurrentRole | null | undefined,
  sl: string | null | undefined,
): boolean {
  const scope = (role?.serviceLines ?? []) as readonly string[];
  return scope.length === 0 || (sl != null && scope.includes(sl));
}

// Filter a list of service lines (e.g. a filter dropdown's options) to the current view's scope.
export function scopedServiceLines<T extends string>(
  role: CurrentRole | null | undefined,
  all: readonly T[],
): readonly T[] {
  const scope = (role?.serviceLines ?? []) as readonly string[];
  return scope.length ? all.filter((s) => scope.includes(s)) : all;
}

// ---- Project Manager scope -------------------------------------------------------------------
// A PM is scoped by project OWNERSHIP (project_manager_user_id === them) plus the resources
// allocated to those projects — not by service line. RLS enforces this for a real PM, so these
// sets already contain everything they can see and the predicates below are no-ops. For a
// developer previewing a PM account, role.userId is the PM's id and RLS returns everything, so
// this reproduces the PM's scope client-side. `active` is false for every non-PM view.
export type PmScope = {
  active: boolean;
  projectIds: Set<string>;
  resourceIds: Set<string>;
  serviceLines: string[];
};

export function usePmScope(): PmScope {
  const { data: role } = useCurrentRole();
  const projects = useProjects();
  const allocations = useAllocations();
  const active = !!(role?.isPm && !role?.isGovernanceLead && !role?.isSlLead && !role?.isDeveloper);
  const uid = role?.userId;
  return useMemo(() => {
    if (!active || !uid) {
      return { active: false, projectIds: new Set<string>(), resourceIds: new Set<string>(), serviceLines: [] };
    }
    const owned = (projects.data ?? []).filter(
      (p) => (p as { project_manager_user_id?: string | null }).project_manager_user_id === uid,
    );
    const projectIds = new Set(owned.map((p) => p.id));
    const serviceLines = Array.from(new Set(owned.map((p) => p.service_line as string)));
    const resourceIds = new Set(
      (allocations.data ?? [])
        .filter((a) => a.project_id != null && projectIds.has(a.project_id))
        .map((a) => a.resource_id)
        .filter((id): id is string => id != null),
    );
    return { active: true, projectIds, resourceIds, serviceLines };
  }, [active, uid, projects.data, allocations.data]);
}

export const inPmProjects = (pm: PmScope, projectId: string | null | undefined) =>
  !pm.active || (projectId != null && pm.projectIds.has(projectId));

export const inPmResources = (pm: PmScope, resourceId: string | null | undefined) =>
  !pm.active || (resourceId != null && pm.resourceIds.has(resourceId));

export const inPmServiceLines = (pm: PmScope, sl: string | null | undefined) =>
  !pm.active || (sl != null && pm.serviceLines.includes(sl));
