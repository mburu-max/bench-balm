import type { AllocationRow, ResourceRow } from "./queries";
import { isExtendedLeave } from "./leave";

export type BenchRow = {
  resource: ResourceRow;
  totalPct: number;
  benchPct: number;
  rows: AllocationRow[];
};

function overlapsToday(start: string, end: string, today: string) {
  return start <= today && end >= today;
}

export function computeBench(
  resources: ResourceRow[],
  allocations: AllocationRow[],
  date: string = new Date().toISOString().slice(0, 10),
): BenchRow[] {
  return resources.map((r) => {
    const rows = allocations.filter(
      (a) =>
        a.resource_id === r.id &&
        overlapsToday(a.allocation_start_date, a.allocation_end_date, date),
    );
    const counted = rows.filter((a) => {
      // Exclude Leave from "allocated" total — leave is its own bucket
      if (a.allocation_type === "Leave") return false;
      // Project must be active (or no project)
      const proj = (a as any).projects;
      if (proj && proj.status && proj.status !== "Active") return false;
      return true;
    });
    const totalPct = counted.reduce((s, a) => s + (a.allocation_pct ?? 0), 0);
    // Extended leave (>5 days) frees the resource's held allocation for backfill while they're out —
    // their allocation is retained (they resume it on return), but it doesn't count as "allocated"
    // for bench purposes, so their capacity shows as available. Short leave doesn't free anything.
    const extLeavePct = Math.min(
      100,
      rows.filter((a) => isExtendedLeave(a)).reduce((s, a) => s + (a.allocation_pct ?? 0), 0),
    );
    const effectiveAllocated = Math.max(0, totalPct - extLeavePct);
    const benchPct = 100 - effectiveAllocated;
    return { resource: r, totalPct: effectiveAllocated, benchPct, rows };
  });
}
