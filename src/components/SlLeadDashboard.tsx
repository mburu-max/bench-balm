import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { KpiCard } from "@/components/KpiCard";
import { useAllocations, useProjects, useResources } from "@/lib/queries";
import { computeBench } from "@/lib/bench";
import { SERVICE_LINES } from "@/lib/constants";
import { SL_COLORS, todayStr, computeUtilTrend, type UtilView } from "@/lib/dashboard";
import { supabase } from "@/integrations/supabase/client";
import {
  Users, Briefcase, Activity, Coffee, AlertTriangle, UserMinus, AlertOctagon, ArrowRight, CheckCircle2,
} from "lucide-react";
import {
  Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, Pie, PieChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

const STATUS_META: Record<string, { rank: number; label: string; cls: string }> = {
  over: { rank: 0, label: "Over-Allocated", cls: "bg-destructive/15 text-destructive" },
  below: { rank: 1, label: "Below Target", cls: "bg-warning/20 text-warning-foreground" },
  full: { rank: 2, label: "Fully Allocated", cls: "bg-success/15 text-success" },
  bench: { rank: 3, label: "On Bench", cls: "bg-muted text-muted-foreground" },
};
function resStatus(totalPct: number) {
  if (totalPct > 100) return "over";
  if (totalPct === 100) return "full";
  if (totalPct > 0) return "below";
  return "bench";
}
const PROJECT_ORDER: Record<string, number> = { Active: 0, On_Hold: 1, Closed: 2 };
const pieColors = [
  "var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)",
  "var(--color-chart-4)", "var(--color-chart-5)", "var(--color-warning)", "var(--color-destructive)",
];

export function SlLeadDashboard() {
  const projects = useProjects();
  const resources = useResources();
  const allocations = useAllocations();
  const [utilView, setUtilView] = useState<UtilView>("today");

  const slTargets = useQuery({
    queryKey: ["sl-targets"],
    queryFn: async () => {
      const { data } = await supabase.from("service_lines").select("id, target_utilisation_min, target_utilisation_max");
      return Object.fromEntries((data ?? []).map((s) => [s.id, s])) as Record<string, { target_utilisation_min: number | null; target_utilisation_max: number | null }>;
    },
  });
  const cliffEdge = useQuery({
    queryKey: ["cliff-edge-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_cliff_edge").select("*");
      if (error) throw error;
      return data ?? [];
    },
  });
  const snapTrend = useQuery({
    queryKey: ["snap-trend"],
    queryFn: async () => {
      const since = new Date(); since.setDate(since.getDate() - 91);
      const { data } = await supabase.from("allocation_snapshots")
        .select("snapshot_date, service_line, resource_id, allocation_pct, allocation_type")
        .gte("snapshot_date", since.toISOString().slice(0, 10)).order("snapshot_date");
      return data ?? [];
    },
  });

  const loading = projects.isLoading || resources.isLoading || allocations.isLoading;
  const today = todayStr();

  // Data already scoped to the lead's service line(s) by RLS.
  const allProjects = projects.data ?? [];
  const allResources = resources.data ?? [];
  const allAllocations = allocations.data ?? [];
  const activeProjects = allProjects.filter((p) => p.status === "Active");
  const activeResources = allResources.filter((r) => r.status === "Active");
  const bench = computeBench(activeResources, allAllocations);
  const benchCount = bench.filter((b) => b.benchPct > 0).length;
  const fullyAllocated = bench.filter((b) => b.benchPct === 0).length;
  const overAllocated = bench.filter((b) => b.benchPct < 0).length;
  const inactiveCount = allResources.filter((r) => r.status !== "Active").length;

  const shownSls = SERVICE_LINES.filter(
    (sl) => allResources.some((r) => r.service_line === sl) || allProjects.some((p) => p.service_line === sl),
  );

  const headcountBySl: Record<string, number> = {};
  for (const r of activeResources) headcountBySl[r.service_line] = (headcountBySl[r.service_line] ?? 0) + 1;

  const slData = shownSls.map((sl) => {
    const slRes = activeResources.filter((r) => r.service_line === sl);
    const slBench = computeBench(slRes, allAllocations);
    const allocated = slBench.reduce((s, b) => s + Math.min(100, b.totalPct), 0);
    const total = slRes.length * 100;
    const utilization = total > 0 ? Math.round((allocated / total) * 100) : 0;
    const target = slTargets.data?.[sl];
    const targetMin = target?.target_utilisation_min ?? 80;
    const targetMax = target?.target_utilisation_max ?? 95;
    return { sl, utilization, targetMin, targetMax, inTarget: utilization >= targetMin };
  });
  const { trendSeries, avgBySl, hasTrend } = computeUtilTrend(snapTrend.data ?? [], headcountBySl, shownSls);
  const slDataWithAvg = slData.map((d) => ({ ...d, avg13: avgBySl[d.sl] ?? null }));

  const cliff = cliffEdge.data ?? [];
  const cliffBySl = shownSls.map((sl) => {
    const rows = cliff.filter((r) => r.service_line === sl);
    return {
      sl,
      "≤30d": rows.filter((r) => (r.cliff_band ?? 90) <= 30).length,
      "31–60d": rows.filter((r) => r.cliff_band === 60).length,
      "61–90d": rows.filter((r) => r.cliff_band === 90).length,
    };
  });

  // ---- Resource Allocation Breakdown ----
  const breakdown = bench.map((b) => {
    const projRows = b.rows.filter((a: any) => a.allocation_type !== "Leave" && a.project_id);
    const projMap = new Map<string, string>();
    for (const a of projRows) projMap.set(a.project_id as string, (a as any).projects?.project_code ?? a.project_id);
    const endDate = projRows.length ? projRows.map((a) => a.allocation_end_date).sort().slice(-1)[0] : null;
    const st = resStatus(b.totalPct);
    return {
      id: b.resource.id, name: b.resource.full_name, role: (b.resource as any).position ?? "—",
      pct: b.totalPct, projects: [...projMap.entries()].map(([id, code]) => ({ id, code })),
      endDate, status: st,
    };
  }).sort((a, b) => STATUS_META[a.status].rank - STATUS_META[b.status].rank || b.pct - a.pct);

  // ---- Active Projects table + current resource counts ----
  const currentAllocs = allAllocations.filter(
    (a) => a.allocation_type !== "Leave" && a.allocation_start_date <= today && a.allocation_end_date >= today,
  );
  const resByProject: Record<string, Set<string>> = {};
  for (const a of currentAllocs) if (a.project_id) (resByProject[a.project_id] ??= new Set()).add(a.resource_id);
  const projectRows = [...allProjects].sort(
    (a, b) => (PROJECT_ORDER[a.status] ?? 9) - (PROJECT_ORDER[b.status] ?? 9),
  );

  // ---- Upcoming gaps (≤30 days) ----
  const gaps = cliff.filter((r) => (r.cliff_band ?? 90) <= 30);

  // ---- Projects by status donut ----
  const projectsByStatus = allProjects.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1; return acc;
  }, {});
  const projectPie = Object.entries(projectsByStatus).map(([name, value]) => ({ name: name.replace("_", " "), value }));

  // ---- Billable vs Non-billable (current allocations) ----
  let billable = 0, nonBillable = 0;
  for (const a of currentAllocs) (a.allocation_type === "Billable" ? billable++ : nonBillable++);
  const billTotal = billable + nonBillable;
  const billablePct = billTotal ? Math.round((billable / billTotal) * 100) : 0;

  const projStatusCls = (s: string) =>
    s === "Active" ? "bg-success/15 text-success"
    : s === "On_Hold" ? "bg-warning/20 text-warning-foreground"
    : s === "Closed" ? "bg-muted text-muted-foreground"
    : "bg-secondary text-secondary-foreground";

  return (
    <AppShell title="Service Line Dashboard">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiCard label="Total Resources" value={loading ? "—" : activeResources.length} icon={Users} />
        <KpiCard label="Active Projects" value={loading ? "—" : activeProjects.length} icon={Briefcase} accent="info" />
        <KpiCard label="Fully Allocated" value={loading ? "—" : fullyAllocated} icon={Activity} accent="success" />
        <KpiCard label="On Bench" value={loading ? "—" : benchCount} icon={Coffee} accent="warning" />
        <KpiCard label="On Leave / Inactive" value={loading ? "—" : inactiveCount} icon={UserMinus} />
        <KpiCard label="Over-allocated" value={loading ? "—" : overAllocated} icon={AlertTriangle} accent="destructive" />
      </div>

      {/* Cliff banner */}
      {(() => {
        const urgent = cliff.filter((r) => (r.cliff_band ?? 90) <= 30).length;
        if (cliffEdge.isLoading || cliff.length === 0) return null;
        return (
          <Link to="/cliff-edge" className="block mt-6">
            <div className={`rounded-xl border p-4 flex items-center justify-between gap-4 transition-colors hover:bg-muted/40 ${urgent > 0 ? "border-destructive/40 bg-destructive/5" : "border-warning/40 bg-warning/5"}`}>
              <div className="flex items-center gap-3">
                <AlertOctagon className={`size-5 ${urgent > 0 ? "text-destructive" : "text-warning-foreground"}`} />
                <div>
                  <div className="text-sm font-medium">{cliff.length} resource{cliff.length === 1 ? "" : "s"} approaching a cliff edge in the next 90 days</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{urgent > 0 ? `${urgent} need action within 30 days` : "None urgent yet, but worth a look"}</div>
                </div>
              </div>
              <ArrowRight className="size-4 text-muted-foreground" />
            </div>
          </Link>
        );
      })()}

      {/* Upper charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold">Utilisation vs Target</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Blended util % vs target floor</p>
            </div>
            <div className="flex rounded-md border p-0.5 text-xs shrink-0">
              {([["today", "Today"], ["trend", "13-Week"], ["both", "Both"]] as [UtilView, string][]).map(([v, label]) => (
                <button key={v} onClick={() => setUtilView(v)} className={`px-2.5 py-1 rounded transition-colors ${utilView === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{label}</button>
              ))}
            </div>
          </div>
          <div className="h-64 mt-4">
            {utilView === "trend" && !hasTrend ? (
              <div className="h-full grid place-items-center text-center text-sm text-muted-foreground px-6">
                Trend builds up as daily snapshots accumulate. Check back after a couple of weeks.
              </div>
            ) : utilView === "trend" ? (
              <ResponsiveContainer>
                <LineChart data={trendSeries} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="week" stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} unit="%" domain={[0, 100]} />
                  <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {shownSls.map((sl) => <Line key={sl} type="monotone" dataKey={sl} stroke={SL_COLORS[sl]} strokeWidth={2} dot={{ r: 2 }} connectNulls />)}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer>
                <ComposedChart data={slDataWithAvg} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="sl" stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} unit="%" domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
                    formatter={(value: number, name: string, props: any) => name === "avg13" ? [`${value}%`, "13-wk avg"] : [`${value}% (target ${props.payload.targetMin}–${props.payload.targetMax}%)`, "Today"]}
                  />
                  {slDataWithAvg.map((d) => <ReferenceLine key={`min-${d.sl}`} y={d.targetMin} stroke="var(--color-muted-foreground)" strokeDasharray="3 3" strokeOpacity={0.4} />)}
                  <Bar dataKey="utilization" radius={[6, 6, 0, 0]}>
                    {slDataWithAvg.map((d) => <Cell key={d.sl} fill={d.inTarget ? "var(--color-success, #22c55e)" : "var(--color-destructive)"} fillOpacity={0.85} />)}
                  </Bar>
                  {utilView === "both" && <Line type="monotone" dataKey="avg13" stroke="var(--color-chart-1)" strokeWidth={2} dot={{ r: 3 }} connectNulls />}
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <h2 className="font-display text-base font-semibold">30/60/90-Day Cliff Exposure</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Resources with no follow-on allocation, by urgency band</p>
          <div className="h-64 mt-4">
            <ResponsiveContainer>
              <ComposedChart data={cliffBySl} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="sl" stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="≤30d" stackId="a" fill="var(--color-destructive)" fillOpacity={0.85} />
                <Bar dataKey="31–60d" stackId="a" fill="var(--color-warning)" fillOpacity={0.85} />
                <Bar dataKey="61–90d" stackId="a" fill="#3b82f6" fillOpacity={0.8} radius={[6, 6, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Resource Allocation Breakdown */}
      <div className="mt-6 rounded-xl border bg-card overflow-hidden">
        <div className="p-5 border-b">
          <h2 className="font-display text-base font-semibold">Resource Allocation Breakdown</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Every resource — over-allocated first, then below target, fully allocated, bench</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/40">
              <tr>
                <th className="text-left px-5 py-2.5 font-medium">Resource</th>
                <th className="text-left px-3 py-2.5 font-medium">Role</th>
                <th className="text-right px-3 py-2.5 font-medium">Allocation %</th>
                <th className="text-left px-3 py-2.5 font-medium">Projects</th>
                <th className="text-left px-3 py-2.5 font-medium">Alloc. End</th>
                <th className="text-left px-5 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="px-5 py-3 font-medium">{r.name}</td>
                  <td className="px-3 py-3 text-muted-foreground">{r.role}</td>
                  <td className="px-3 py-3 text-right tabular-nums font-medium">{r.pct}%</td>
                  <td className="px-3 py-3">
                    {r.projects.length === 0 ? <span className="text-muted-foreground">—</span> : (
                      <div className="flex flex-wrap gap-1">
                        {r.projects.map((p) => (
                          <Link key={p.id} to="/projects/$projectId" params={{ projectId: p.id }} className="font-mono text-xs text-primary hover:underline">{p.code}</Link>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs tabular-nums text-muted-foreground">{r.endDate ?? "—"}</td>
                  <td className="px-5 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_META[r.status].cls}`}>{STATUS_META[r.status].label}</span>
                  </td>
                </tr>
              ))}
              {breakdown.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">No resources.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Lower: Projects by Status + Upcoming Gaps */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
        <div className="rounded-xl border bg-card p-5">
          <h2 className="font-display text-base font-semibold">Projects by Status</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Distribution across your service line</p>
          <div className="h-72 mt-4">
            {projectPie.length === 0 ? (
              <div className="h-full grid place-items-center text-sm text-muted-foreground">No projects yet</div>
            ) : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={projectPie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                    {projectPie.map((_, i) => <Cell key={i} fill={pieColors[i % pieColors.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-xl border bg-card overflow-hidden flex flex-col">
          <div className="p-5 border-b">
            <h2 className="font-display text-base font-semibold">Upcoming Gaps</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Allocations ending within 30 days, no follow-on</p>
          </div>
          {gaps.length === 0 ? (
            <div className="flex-1 grid place-items-center p-10 text-center">
              <div>
                <CheckCircle2 className="size-10 mx-auto text-success" />
                <div className="mt-2 text-sm font-medium">No gaps in the next 30 days</div>
                <div className="text-xs text-muted-foreground mt-0.5">Everyone has follow-on coverage.</div>
              </div>
            </div>
          ) : (
            <div className="divide-y max-h-80 overflow-y-auto">
              {gaps.map((g) => (
                <div key={g.resource_id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{g.full_name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      <span className="font-mono">{g.ending_project_code ?? "—"}</span> · ends {g.last_covered_date}
                    </div>
                  </div>
                  <span className={`text-xs font-medium tabular-nums shrink-0 ${(g.days_until_cliff ?? 0) <= 0 ? "text-destructive" : "text-warning-foreground"}`}>
                    {(g.days_until_cliff ?? 0) <= 0 ? "Now" : `${g.days_until_cliff}d`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom: Active Projects + Billable split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
        <div className="lg:col-span-2 rounded-xl border bg-card overflow-hidden">
          <div className="p-5 border-b">
            <h2 className="font-display text-base font-semibold">Projects</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Active first, then On Hold, then Closed</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/40">
                <tr>
                  <th className="text-left px-5 py-2.5 font-medium">Code</th>
                  <th className="text-left px-3 py-2.5 font-medium">Project</th>
                  <th className="text-left px-3 py-2.5 font-medium">Customer</th>
                  <th className="text-left px-3 py-2.5 font-medium">Status</th>
                  <th className="text-right px-3 py-2.5 font-medium">Resources</th>
                  <th className="text-left px-5 py-2.5 font-medium">End</th>
                </tr>
              </thead>
              <tbody>
                {projectRows.map((p: any) => {
                  const count = resByProject[p.id]?.size ?? 0;
                  return (
                    <tr key={p.id} className="border-t hover:bg-muted/30">
                      <td className="px-5 py-3 font-mono text-xs">
                        <Link to="/projects/$projectId" params={{ projectId: p.id }} className="text-primary hover:underline">{p.project_code}</Link>
                      </td>
                      <td className="px-3 py-3">{p.project_description}</td>
                      <td className="px-3 py-3 text-muted-foreground">{p.customers?.customer_name ?? "—"}</td>
                      <td className="px-3 py-3">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${projStatusCls(p.status)}`}>{p.status.replace("_", " ")}</span>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        <Link to="/projects/$projectId" params={{ projectId: p.id }} className="text-primary hover:underline">{count}</Link>
                      </td>
                      <td className="px-5 py-3 text-xs tabular-nums text-muted-foreground">{p.end_date}</td>
                    </tr>
                  );
                })}
                {projectRows.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">No projects.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <h2 className="font-display text-base font-semibold">Billable vs Non-Billable</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Current allocations by billing type</p>
          {billTotal === 0 ? (
            <div className="h-40 grid place-items-center text-sm text-muted-foreground">No current allocations</div>
          ) : (
            <div className="mt-6">
              <div className="flex items-end justify-between mb-2">
                <div><div className="font-display text-3xl font-semibold">{billablePct}%</div><div className="text-xs text-muted-foreground">Billable</div></div>
                <div className="text-right"><div className="font-display text-3xl font-semibold text-muted-foreground">{100 - billablePct}%</div><div className="text-xs text-muted-foreground">Non-billable</div></div>
              </div>
              <div className="h-3 rounded-full overflow-hidden bg-muted flex">
                <div className="bg-success h-full" style={{ width: `${billablePct}%` }} />
                <div className="bg-warning h-full" style={{ width: `${100 - billablePct}%` }} />
              </div>
              <div className="text-xs text-muted-foreground mt-3">{billable} billable · {nonBillable} non-billable / internal / bench allocations</div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
