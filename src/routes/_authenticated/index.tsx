import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { KpiCard } from "@/components/KpiCard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAllocations, useProjects, useResources } from "@/lib/queries";
import { computeBench } from "@/lib/bench";
import { isExtendedLeave, isCurrentLeave } from "@/lib/leave";
import { SERVICE_LINES } from "@/lib/constants";
import { useCurrentRole } from "@/lib/useCurrentRole";
import { SlLeadDashboard } from "@/components/SlLeadDashboard";
import { PmDashboard } from "@/components/PmDashboard";
import { UtilBullets } from "@/components/UtilBullets";
import { SL_COLORS, todayStr, horizonStr, computeUtilTrend, type UtilView } from "@/lib/dashboard";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "@tanstack/react-router";
import {
  Users,
  Briefcase,
  Gauge,
  AlertTriangle,
  Coffee,
  AlertOctagon,
  ArrowRight,
  CheckCircle2,
  UserX,
  BatteryMedium,
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export const Route = createFileRoute("/_authenticated/")({
  component: Dashboard,
});

// Role-adaptive dashboard: SL Leads get their service-line view;
// Governance / Finance / Developer get the company-wide operational view.
function Dashboard() {
  const { data: role, isLoading } = useCurrentRole();
  if (isLoading) {
    return (
      <AppShell title="Dashboard">
        <div className="h-64 grid place-items-center text-sm text-muted-foreground">Loading…</div>
      </AppShell>
    );
  }
  // Governance / Finance / Developer → company-wide view.
  // Project Manager → project-centric PM view. SL Lead + Resource → scoped SL view.
  if (role?.isGovernanceLead || role?.isFinance) return <GovernanceDashboard />;
  if (role?.isPm) return <PmDashboard />;
  return <SlLeadDashboard />;
}

function GovernanceDashboard() {
  const projects = useProjects();
  const resources = useResources();
  const allocations = useAllocations();

  const { data: role } = useCurrentRole();
  const canFilter = !!(role?.isGovernanceLead || role?.isFinance);
  const [slFilter, setSlFilter] = useState<string>("all");
  const [utilView, setUtilView] = useState<UtilView>("both");
  const matchesSl = (sl: string | null | undefined) => slFilter === "all" || sl === slFilter;

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
      const since = new Date();
      since.setDate(since.getDate() - 91);
      const { data } = await supabase
        .from("allocation_snapshots")
        .select("snapshot_date, service_line, resource_id, allocation_pct, allocation_type")
        .gte("snapshot_date", since.toISOString().slice(0, 10))
        .order("snapshot_date");
      return data ?? [];
    },
  });

  const loading = projects.isLoading || resources.isLoading || allocations.isLoading;

  // ---- service-line filter applied to every base dataset ----
  const fProjects = (projects.data ?? []).filter((p) => matchesSl(p.service_line));
  const fResources = (resources.data ?? []).filter((r) => matchesSl(r.service_line));
  const fCliff = (cliffEdge.data ?? []).filter((r) => matchesSl(r.service_line));
  const fResourceIds = new Set(fResources.map((r) => r.id));

  const activeProjects = fProjects.filter((p) => p.status === "Active");
  const activeResources = fResources.filter((r) => r.status === "Active");
  const bench = computeBench(activeResources, allocations.data ?? []);
  // On Bench = genuinely idle (0% allocated), not merely under 100%.
  const benchCount = bench.filter((b) => b.benchPct === 100).length;
  const overAllocated = bench.filter((b) => b.benchPct < 0).length;
  const onLeave = fResources.filter((r) => r.status === "On_Leave").length;
  // Partially allocated (1–99%) — has spare capacity but isn't idle; shown on none of the
  // other capacity cards, so surface it directly (bench already means genuinely idle).
  const partiallyAllocated = bench.filter((b) => b.benchPct > 0 && b.benchPct < 100).length;

  // Blended utilization across all active resources (capped at 100% per person).
  const avgUtil = activeResources.length > 0
    ? Math.round(bench.reduce((s, b) => s + Math.min(100, b.totalPct), 0) / activeResources.length)
    : 0;
  const avgUtilAccent = avgUtil >= 75 ? "success" : avgUtil >= 60 ? "warning" : "destructive";

  // Extended-leave escalation.
  const extendedLeaveCount = new Set(
    (allocations.data ?? [])
      .filter((a) => fResourceIds.has(a.resource_id) && isExtendedLeave(a) && isCurrentLeave(a))
      .map((a) => a.resource_id),
  ).size;

  const shownSls = slFilter === "all" ? [...SERVICE_LINES] : SERVICE_LINES.filter((s) => s === slFilter);

  // Coverage: does a resource have a billable/non-billable allocation covering a horizon date?
  const coveredAt = (resourceId: string, dateStr: string) =>
    (allocations.data ?? []).some(
      (a) =>
        a.resource_id === resourceId &&
        (a.allocation_type === "Billable" || a.allocation_type === "Non-Billable") &&
        a.allocation_start_date <= dateStr &&
        a.allocation_end_date >= dateStr,
    );
  const d30 = horizonStr(30), d60 = horizonStr(60), d90 = horizonStr(90);

  // Projects that currently have someone allocated (non-Leave allocation overlapping today).
  const nowStr = todayStr();
  const staffedProjectIds = new Set(
    (allocations.data ?? [])
      .filter((a) => a.allocation_type !== "Leave" && a.project_id && a.allocation_start_date <= nowStr && a.allocation_end_date >= nowStr)
      .map((a) => a.project_id),
  );

  // ---- Practice composition (billable mix, FTE/contractor, cross-SL loans) ----
  // Respects the SL filter via activeResources; capacity-weighted by allocation %.
  const activeResIds = new Set(activeResources.map((r) => r.id));
  const currentAllocs = (allocations.data ?? []).filter(
    (a) => activeResIds.has(a.resource_id) && a.allocation_type !== "Leave" && a.allocation_start_date <= nowStr && a.allocation_end_date >= nowStr,
  );
  let billablePctSum = 0, nonBillablePctSum = 0;
  for (const a of currentAllocs) {
    const pct = a.allocation_pct ?? 0;
    if (a.allocation_type === "Billable") billablePctSum += pct; else nonBillablePctSum += pct;
  }
  const billTotal = billablePctSum + nonBillablePctSum;
  const billablePct = billTotal ? Math.round((billablePctSum / billTotal) * 100) : 0;
  const contractorHeads = activeResources.filter((r) => r.employment_type !== "FTE").length;
  const contractorPct = activeResources.length ? Math.round((contractorHeads / activeResources.length) * 100) : 0;

  // ---- Per service line stats (today) + coverage rate ----
  const slData = shownSls.map((sl) => {
    const slRes = activeResources.filter((r) => r.service_line === sl);
    const slActiveProjects = activeProjects.filter((p) => p.service_line === sl);
    const slBench = computeBench(slRes, allocations.data ?? []);
    const allocated = slBench.reduce((s, b) => s + Math.min(100, b.totalPct), 0);
    const total = slRes.length * 100;
    const utilization = total > 0 ? Math.round((allocated / total) * 100) : 0;
    const target = slTargets.data?.[sl];
    const targetMin = target?.target_utilisation_min ?? 80;
    const targetMax = target?.target_utilisation_max ?? 95;
    const cov = (dateStr: string) =>
      slRes.length ? Math.round((slRes.filter((r) => coveredAt(r.id, dateStr)).length / slRes.length) * 100) : 0;
    return {
      sl, resources: slRes.length, utilization,
      projects: slActiveProjects.length,
      unstaffed: slActiveProjects.filter((p) => !staffedProjectIds.has(p.id)).length,
      bench: slBench.filter((b) => b.benchPct === 100).length,
      fully: slBench.filter((b) => b.benchPct === 0).length,
      targetMin, targetMax, inTarget: utilization >= targetMin,
      coverage30: cov(d30), coverage60: cov(d60), coverage90: cov(d90),
    };
  });

  // ---- 13-week utilization trend from daily snapshots ----
  const headcountBySl: Record<string, number> = {};
  for (const r of activeResources) headcountBySl[r.service_line] = (headcountBySl[r.service_line] ?? 0) + 1;
  const { trendSeries, avgBySl, hasTrend } = computeUtilTrend(snapTrend.data ?? [], headcountBySl, shownSls);
  const slDataWithAvg = slData.map((d) => ({ ...d, avg13: avgBySl[d.sl] ?? null }));

  // ---- Cliff exposure per SL ----
  const cliffBySl = shownSls.map((sl) => {
    const rows = fCliff.filter((r) => r.service_line === sl);
    return {
      sl,
      "≤30d": rows.filter((r) => (r.cliff_band ?? 90) <= 30).length,
      "31–60d": rows.filter((r) => r.cliff_band === 60).length,
      "61–90d": rows.filter((r) => r.cliff_band === 90).length,
    };
  });

  // ---- Projects by status donut ----
  const projectsByStatus = fProjects.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});
  const projectPie = Object.entries(projectsByStatus).map(([name, value]) => ({ name: name.replace("_", " "), value }));
  const pieColors = [
    "var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)",
    "var(--color-chart-4)", "var(--color-chart-5)", "var(--color-warning)", "var(--color-destructive)",
  ];

  // ---- Alerts / attention required (prioritized) ----
  const projectsWithCurrentAlloc = new Set(
    (allocations.data ?? [])
      .filter((a) => a.project_id && a.allocation_type !== "Leave" && a.allocation_start_date <= todayStr() && a.allocation_end_date >= todayStr())
      .map((a) => a.project_id),
  );
  type Alert = { key: string; label: string; sl: string; issue: string; tone: "destructive" | "warning" };
  const alerts: Alert[] = [
    ...bench
      .filter((b) => b.benchPct < 0)
      .map((b) => ({ key: `over-${b.resource.id}`, label: b.resource.full_name, sl: b.resource.service_line, issue: `Over-allocated at ${b.totalPct}%`, tone: "destructive" as const })),
    ...activeProjects
      .filter((p) => !projectsWithCurrentAlloc.has(p.id))
      .map((p) => ({ key: `nores-${p.id}`, label: p.project_code, sl: p.service_line, issue: "Active project with no resources assigned", tone: "warning" as const })),
    ...fCliff
      .filter((r) => (r.cliff_band ?? 90) <= 30)
      .map((r) => ({ key: `cliff-${r.resource_id}`, label: r.full_name ?? "—", sl: r.service_line ?? "—", issue: `Allocation ends ${r.last_covered_date} — no follow-on`, tone: "destructive" as const })),
  ];

  return (
    <AppShell
      title="Dashboard"
      actions={
        canFilter ? (
          <Select value={slFilter} onValueChange={setSlFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All service lines</SelectItem>
              {SERVICE_LINES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : undefined
      }
    >
      {slFilter !== "all" && (
        <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center rounded-full bg-primary/10 text-primary border border-primary/20 px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide">
            {slFilter}
          </span>
          Viewing a single service line — clear the filter to see the whole portfolio.
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
        <KpiCard label="Avg Utilization" value={loading ? "—" : `${avgUtil}%`} icon={Gauge} accent={avgUtilAccent} />
        <KpiCard label="Active Projects" value={loading ? "—" : activeProjects.length} icon={Briefcase} accent="info" />
        <KpiCard label="Total Resources" value={loading ? "—" : activeResources.length} icon={Users} />
        <KpiCard label="On Bench" value={loading ? "—" : benchCount} icon={Coffee} accent="warning" />
        <KpiCard label="Partially Allocated" value={loading ? "—" : partiallyAllocated} icon={BatteryMedium} accent="info" />
        <KpiCard label="Over-allocated" value={loading ? "—" : overAllocated} icon={AlertTriangle} accent="destructive" hint={onLeave ? `${onLeave} on leave` : undefined} />
      </div>

      {/* Cliff-edge alert banner */}
      {(() => {
        const cliffData = fCliff;
        const urgent = cliffData.filter((r) => (r.cliff_band ?? 90) <= 30).length;
        if (cliffEdge.isLoading || cliffData.length === 0) return null;
        return (
          <Link to="/cliff-edge" className="block mt-6">
            <div className={`rounded-xl border p-4 flex items-center justify-between gap-4 transition-colors hover:bg-muted/40 ${urgent > 0 ? "border-destructive/40 bg-destructive/5" : "border-warning/40 bg-warning/5"}`}>
              <div className="flex items-center gap-3">
                <AlertOctagon className={`size-5 ${urgent > 0 ? "text-destructive" : "text-warning-foreground"}`} />
                <div>
                  <div className="text-sm font-medium">
                    {cliffData.length} resource{cliffData.length === 1 ? "" : "s"} approaching a cliff edge in the next 90 days
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {urgent > 0 ? `${urgent} need action within 30 days` : "None urgent yet, but worth a look"}
                  </div>
                </div>
              </div>
              <ArrowRight className="size-4 text-muted-foreground" />
            </div>
          </Link>
        );
      })()}

      {extendedLeaveCount > 0 && (
        <div className="mt-4 rounded-xl border border-warning/40 bg-warning/5 p-4 flex items-center gap-3">
          <Coffee className="size-5 text-warning-foreground" />
          <div>
            <div className="text-sm font-medium">
              {extendedLeaveCount} resource{extendedLeaveCount === 1 ? "" : "s"} on extended leave (&gt;5 days)
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Escalate for coverage — extended absences may leave projects short-staffed (RA §5.4.1).
            </div>
          </div>
        </div>
      )}

      {/* Upper charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
        {/* Utilisation vs Target + trend toggle */}
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold">Utilisation vs Target</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Blended util % per SL vs the target band — green on target, red below
              </p>
            </div>
            <div className="flex rounded-md border p-0.5 text-xs shrink-0">
              {([["today", "Today"], ["trend", "13-Week"], ["both", "Both"]] as [UtilView, string][]).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setUtilView(v)}
                  className={`px-2.5 py-1 rounded transition-colors ${utilView === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="h-64 mt-4">
            {utilView === "trend" && !hasTrend ? (
              <div className="h-full grid place-items-center text-center text-sm text-muted-foreground px-6">
                Trend builds up as daily snapshots accumulate. Come back after a couple of weeks of history.
              </div>
            ) : utilView === "trend" ? (
              <ResponsiveContainer>
                <LineChart data={trendSeries} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="week" stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} unit="%" domain={[0, 100]} />
                  <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {shownSls.map((sl) => (
                    <Line key={sl} type="monotone" dataKey={sl} stroke={SL_COLORS[sl]} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <UtilBullets data={slDataWithAvg} showAvg={utilView === "both" && hasTrend} />
            )}
          </div>
          <div className="flex items-center gap-4 mt-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-success inline-block" /> On/above target</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-destructive inline-block" /> Below target</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-foreground/10 inline-block" /> Target band</span>
            {utilView === "both" && hasTrend && <span className="flex items-center gap-1.5"><span className="inline-block w-3 border-l-2" style={{ borderColor: "var(--color-chart-1)" }} /> 13-wk avg</span>}
          </div>
        </div>

        {/* Cliff exposure */}
        <div className="rounded-xl border bg-card p-5">
          <h2 className="font-display text-base font-semibold">30/60/90-Day Cliff Exposure</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Resources with no follow-on allocation, by SL and urgency band
          </p>
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

      {/* Service Line Summary (full width) */}
      <div className="mt-6 rounded-xl border bg-card overflow-hidden">
        <div className="p-5 border-b">
          <h2 className="font-display text-base font-semibold">Service Line Summary</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Today's health plus forward coverage — Unstaffed = active projects with nobody allocated today; Coverage = % of resources with allocations reaching 30 / 60 / 90 days out
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/40">
              <tr>
                <th className="text-left px-5 py-2.5 font-medium">Service Line</th>
                <th className="text-right px-3 py-2.5 font-medium">Resources</th>
                <th className="text-right px-3 py-2.5 font-medium">Projects</th>
                <th className="text-right px-3 py-2.5 font-medium">Unstaffed</th>
                <th className="text-right px-3 py-2.5 font-medium">Fully Alloc.</th>
                <th className="text-right px-3 py-2.5 font-medium">On Bench</th>
                <th className="text-right px-3 py-2.5 font-medium">Util %</th>
                <th className="text-right px-5 py-2.5 font-medium">Coverage 30 / 60 / 90</th>
              </tr>
            </thead>
            <tbody>
              {slData.map((r) => (
                <tr key={r.sl} className="border-t">
                  <td className="px-5 py-3 font-medium">{r.sl}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.resources}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.projects}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {r.unstaffed > 0
                      ? <span className="text-destructive font-medium">{r.unstaffed}</span>
                      : <span className="text-muted-foreground">0</span>}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.fully}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{r.bench}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    <span className={r.inTarget ? "text-success font-medium" : "text-destructive font-medium"}>
                      {r.utilization}%
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">
                    <span className="text-foreground font-medium">{r.coverage30}%</span>
                    {" / "}{r.coverage60}%{" / "}{r.coverage90}%
                  </td>
                </tr>
              ))}
              {slData.length === 0 && (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">No service lines to show.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Lower charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
        {/* Projects by Status */}
        <div className="rounded-xl border bg-card p-5">
          <h2 className="font-display text-base font-semibold">Projects by Status</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Portfolio distribution</p>
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

        {/* Alerts / Attention Required */}
        <div className="rounded-xl border bg-card overflow-hidden flex flex-col">
          <div className="p-5 border-b">
            <h2 className="font-display text-base font-semibold">Alerts / Attention Required</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Everything that needs action right now</p>
          </div>
          {alerts.length === 0 ? (
            <div className="flex-1 grid place-items-center p-10 text-center">
              <div>
                <CheckCircle2 className="size-10 mx-auto text-success" />
                <div className="mt-2 text-sm font-medium">All clear</div>
                <div className="text-xs text-muted-foreground mt-0.5">No over-allocations, unstaffed projects, or 30-day cliffs.</div>
              </div>
            </div>
          ) : (
            <div className="divide-y max-h-80 overflow-y-auto">
              {alerts.map((a) => (
                <div key={a.key} className="px-5 py-3 flex items-start gap-3">
                  {a.tone === "destructive"
                    ? <AlertTriangle className="size-4 text-destructive mt-0.5 shrink-0" />
                    : <UserX className="size-4 text-warning-foreground mt-0.5 shrink-0" />}
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {a.label}
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground uppercase tracking-wide">{a.sl}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{a.issue}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Practice composition — billable mix, margin exposure */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
        <div className="rounded-xl border bg-card p-5">
          <h2 className="font-display text-base font-semibold">Billable Mix</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Current allocations driving revenue</p>
          {billTotal === 0 ? (
            <div className="h-24 grid place-items-center text-sm text-muted-foreground">No current allocations</div>
          ) : (
            <div className="mt-5">
              <div className="flex items-end justify-between mb-2">
                <div><div className="font-display text-3xl font-semibold text-success">{billablePct}%</div><div className="text-xs text-muted-foreground">Billable</div></div>
                <div className="text-right"><div className="font-display text-3xl font-semibold text-muted-foreground">{100 - billablePct}%</div><div className="text-xs text-muted-foreground">Non-billable</div></div>
              </div>
              <div className="h-3 rounded-full overflow-hidden bg-muted flex">
                <div className="bg-success h-full" style={{ width: `${billablePct}%` }} />
                <div className="bg-warning h-full" style={{ width: `${100 - billablePct}%` }} />
              </div>
              <div className="text-xs text-muted-foreground mt-3">≈{Math.round(billablePctSum / 100)} FTE billable · ≈{Math.round(nonBillablePctSum / 100)} non-billable / bench / internal</div>
            </div>
          )}
        </div>

        <div className="rounded-xl border bg-card p-5">
          <h2 className="font-display text-base font-semibold">FTE vs Contractor</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Headcount mix — margin exposure</p>
          <div className="mt-5">
            <div className="flex items-end justify-between mb-2">
              <div><div className="font-display text-3xl font-semibold">{activeResources.length - contractorHeads}</div><div className="text-xs text-muted-foreground">FTE</div></div>
              <div className="text-right"><div className={`font-display text-3xl font-semibold ${contractorPct > 30 ? "text-warning-foreground" : ""}`}>{contractorHeads}</div><div className="text-xs text-muted-foreground">Contractor / Vendor</div></div>
            </div>
            <div className="h-3 rounded-full overflow-hidden bg-muted flex">
              <div className="h-full" style={{ width: `${100 - contractorPct}%`, background: "var(--color-chart-2)" }} />
              <div className="bg-warning h-full" style={{ width: `${contractorPct}%` }} />
            </div>
            <div className="text-xs text-muted-foreground mt-3">{contractorPct}% external — watch margin if bench sits idle</div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
