// Shared helpers for the role-specific dashboards.
export type UtilView = "today" | "trend" | "both";

export const SL_COLORS: Record<string, string> = {
  DLaaS: "var(--color-chart-1)",
  CLM: "var(--color-chart-2)",
  MS: "var(--color-chart-3)",
  CCaaS: "var(--color-chart-4)",
  Legacy: "var(--color-chart-5)",
};

export const todayStr = () => new Date().toISOString().slice(0, 10);

export const horizonStr = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

export function weekKey(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

type SnapshotRow = {
  snapshot_date: string;
  service_line: string | null;
  resource_id: string | null;
  allocation_pct: number | null;
  allocation_type: string | null;
};

// Weekly utilization per service line from daily snapshots (last 13 weeks kept).
// Denominator is the current headcount per SL (roughly stable over the window).
export function computeUtilTrend(
  snapshots: SnapshotRow[],
  headcountBySl: Record<string, number>,
  shownSls: string[],
): { trendSeries: Record<string, number | string>[]; avgBySl: Record<string, number>; hasTrend: boolean } {
  const byDate: Record<string, Record<string, Record<string, number>>> = {};
  for (const s of snapshots) {
    if (s.allocation_type === "Leave") continue;
    const sl = s.service_line ?? "";
    if (!(sl in headcountBySl)) continue;
    (byDate[s.snapshot_date] ??= {});
    (byDate[s.snapshot_date][sl] ??= {});
    const rid = s.resource_id ?? "";
    byDate[s.snapshot_date][sl][rid] = (byDate[s.snapshot_date][sl][rid] ?? 0) + (s.allocation_pct ?? 0);
  }
  const weekBucket: Record<string, Record<string, number[]>> = {};
  for (const [date, slMap] of Object.entries(byDate)) {
    const wk = weekKey(date);
    (weekBucket[wk] ??= {});
    for (const [sl, resMap] of Object.entries(slMap)) {
      const hc = headcountBySl[sl] ?? 0;
      if (hc === 0) continue;
      const allocated = Object.values(resMap).reduce((s, v) => s + Math.min(100, v), 0);
      (weekBucket[wk][sl] ??= []).push(Math.round((allocated / (hc * 100)) * 100));
    }
  }
  const trendWeeks = Object.keys(weekBucket).sort().slice(-13);
  const trendSeries = trendWeeks.map((wk) => {
    const row: Record<string, number | string> = { week: wk.slice(5) };
    for (const sl of shownSls) {
      const arr = weekBucket[wk]?.[sl];
      if (arr?.length) row[sl] = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    }
    return row;
  });
  const avgBySl: Record<string, number> = {};
  for (const sl of shownSls) {
    const vals = trendWeeks.flatMap((wk) => weekBucket[wk]?.[sl] ?? []);
    if (vals.length) avgBySl[sl] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  // Need at least 2 weekly points for a line to mean anything — one flat point is not a trend.
  return { trendSeries, avgBySl, hasTrend: trendSeries.length >= 2 };
}
