import { useProjects, useAllocations } from "@/lib/queries";
import { todayStr } from "@/lib/dashboard";

// PM "ready to staff" signal — the project-manager equivalent of the cliff-edge flag.
// Derived on read from the PM's RLS-scoped projects + allocations (no notifications table,
// no trigger, no email): the projects a PM owns that are Active but have nobody allocated
// today, i.e. the ones waiting for the PM to start allocating resources. A project only
// surfaces here once Governance activates it (PMs can't staff Draft/Verified projects) and
// drops off the moment someone is allocated.
export function usePmStaffingQueue(enabled: boolean) {
  const projects = useProjects({ enabled });
  const allocations = useAllocations({ enabled });
  const today = todayStr();

  const staffedProjectIds = new Set(
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

  const unstaffedActive = (projects.data ?? []).filter(
    (p) => p.status === "Active" && !staffedProjectIds.has(p.id),
  );

  return {
    unstaffedActive,
    count: unstaffedActive.length,
    isLoading: projects.isLoading || allocations.isLoading,
  };
}
