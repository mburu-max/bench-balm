import type { AllocationRow, ResourceRow } from "./queries";

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
    const benchPct = 100 - totalPct;
    return { resource: r, totalPct, benchPct, rows };
  });
}
