import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { KpiCard } from "@/components/KpiCard";
import { useAllocations, useProjects, useResources } from "@/lib/queries";
import { computeBench } from "@/lib/bench";
import { SERVICE_LINES } from "@/lib/constants";
import { useCurrentRole } from "@/lib/useCurrentRole";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SL_COLORS, computeUtilTrend, type UtilView } from "@/lib/dashboard";
import { supabase } from "@/integrations/supabase/client";
import {
  Users, Briefcase, Activity, Coffee, AlertTriangle, UserMinus, AlertOctagon, ArrowRight, CheckCircle2,
} from "lucide-react";
import {
  Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, Pie, PieChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

const pieColors = [
  "var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)",
  "var(--color-chart-4)", "var(--color-chart-5)", "var(--color-warning)", "var(--color-destructive)",
];

export function SlLeadDashboard() {
  const projects = useProjects();
  const resources = useResources();
  const allocations = useAllocations();
  const { data: role } = useCurrentRole();
  const [utilView, setUtilView] = useState<UtilView>("today");

  // A multi-SL lead can slice between their OWN assigned service lines; a single-SL lead
  // (or a PM) has no dropdown — their scope is fixed by RLS.
  const assignedSls = role?.serviceLines ?? [];
  const canPickSl = assignedSls.length > 1;
  const [slFilter, setSlFilter] = useState<string>("all");
  const matchesSl = (sl: string | null | undefined) => slFilter === "all" || sl === slFilter;
  const isLead = !!(role?.isSlLead || role?.isDl);

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

  // RLS already scopes to the lead's service line(s) / the PM's projects; this optional
  // filter lets a multi-SL lead slice between their own service lines.
  const allProjects = (projects.data ?? []).filter((p) => matchesSl(p.service_line));
  const allResources = (resources.data ?? []).filter((r) => matchesSl(r.service_line));
  const allAllocations = (allocations.data ?? []).filter((a) => matchesSl(a.service_line));
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

  const cliff = (cliffEdge.data ?? []).filter((r) => matchesSl(r.service_line));
  const cliffBySl = shownSls.map((sl) => {
    const rows = cliff.filter((r) => r.service_line === sl);
    return {
      sl,
      "≤30d": rows.filter((r) => (r.cliff_band ?? 90) <= 30).length,
      "31–60d": rows.filter((r) => r.cliff_band === 60).length,
      "61–90d": rows.filter((r) => r.cliff_band === 90).length,
    };
  });

  // ---- Upcoming gaps (≤30 days) ----
  const gaps = cliff.filter((r) => (r.cliff_band ?? 90) <= 30);

  // ---- Projects by status donut ----
  const projectsByStatus = allProjects.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1; return acc;
  }, {});
  const projectPie = Object.entries(projectsByStatus).map(([name, value]) => ({ name: name.replace("_", " "), value }));

  return (
    <AppShell
      title={isLead ? "Service Line Dashboard" : "My Projects"}
      actions={
        canPickSl ? (
          <Select value={slFilter} onValueChange={setSlFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All my service lines</SelectItem>
              {assignedSls.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : undefined
      }
    >
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

    </AppShell>
  );
}
