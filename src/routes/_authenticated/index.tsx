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
import { useAllocations, useCustomers, useProjects, useResources } from "@/lib/queries";
import { computeBench } from "@/lib/bench";
import { isExtendedLeave, isCurrentLeave } from "@/lib/leave";
import { SERVICE_LINES } from "@/lib/constants";
import { useCurrentRole } from "@/lib/useCurrentRole";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "@tanstack/react-router";
import {
  Users,
  Briefcase,
  Building2,
  Activity,
  AlertTriangle,
  Coffee,
  AlertOctagon,
  ArrowRight,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ProjectStatusBadge } from "@/components/StatusBadge";

export const Route = createFileRoute("/_authenticated/")({
  component: Dashboard,
});

function Dashboard() {
  const customers = useCustomers();
  const projects = useProjects();
  const resources = useResources();
  const allocations = useAllocations();

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

  const { data: role } = useCurrentRole();
  // Global-view roles can narrow the whole dashboard to one service line.
  const canFilter = !!(role?.isGovernanceLead || role?.isFinance);
  const [slFilter, setSlFilter] = useState<string>("all");
  const matchesSl = (sl: string | null | undefined) => slFilter === "all" || sl === slFilter;

  const loading =
    customers.isLoading || projects.isLoading || resources.isLoading || allocations.isLoading;

  // Apply the optional service-line filter to every base dataset.
  const fProjects = (projects.data ?? []).filter((p) => matchesSl(p.service_line));
  const fResources = (resources.data ?? []).filter((r) => matchesSl(r.service_line));
  const fCliff = (cliffEdge.data ?? []).filter((r) => matchesSl(r.service_line));
  const fCustomers = slFilter === "all"
    ? (customers.data ?? [])
    : (customers.data ?? []).filter((c) => fProjects.some((p) => p.customer_id === c.id));
  const fResourceIds = new Set(fResources.map((r) => r.id));

  const activeProjects = fProjects.filter((p) => p.status === "Active");
  const activeResources = fResources.filter((r) => r.status === "Active");
  const bench = computeBench(activeResources, allocations.data ?? []);
  const benchCount = bench.filter((b) => b.benchPct > 0).length;
  const fullyAllocated = bench.filter((b) => b.benchPct === 0).length;
  const overAllocated = bench.filter((b) => b.benchPct < 0).length;
  const onLeave = fResources.filter((r) => r.status === "On_Leave").length;

  // Extended-leave escalation: resources currently on a Leave allocation longer than 5 days.
  const extendedLeaveResourceIds = new Set(
    (allocations.data ?? [])
      .filter((a) => fResourceIds.has(a.resource_id) && isExtendedLeave(a) && isCurrentLeave(a))
      .map((a) => a.resource_id),
  );
  const extendedLeaveCount = extendedLeaveResourceIds.size;

  const shownSls = slFilter === "all" ? SERVICE_LINES : SERVICE_LINES.filter((s) => s === slFilter);

  // Per service line stats with target bands
  const slData = shownSls.map((sl) => {
    const slRes = activeResources.filter((r) => r.service_line === sl);
    const slBench = computeBench(slRes, allocations.data ?? []);
    const allocated = slBench.reduce((s, b) => s + Math.min(100, b.totalPct), 0);
    const total = slRes.length * 100;
    const utilization = total > 0 ? Math.round((allocated / total) * 100) : 0;
    const target = slTargets.data?.[sl];
    const targetMin = target?.target_utilisation_min ?? 80;
    const targetMax = target?.target_utilisation_max ?? 95;
    const inTarget = utilization >= targetMin;
    return {
      sl, resources: slRes.length, utilization,
      bench: slBench.filter((b) => b.benchPct > 0).length,
      fully: slBench.filter((b) => b.benchPct === 0).length,
      targetMin, targetMax, inTarget,
    };
  });

  // Cliff exposure per SL (30 / 60-90 day bands)
  const cliffBySl = shownSls.map((sl) => {
    const rows = fCliff.filter((r) => r.service_line === sl);
    return {
      sl,
      "≤30d": rows.filter((r) => (r.cliff_band ?? 90) <= 30).length,
      "31–60d": rows.filter((r) => r.cliff_band === 60).length,
      "61–90d": rows.filter((r) => r.cliff_band === 90).length,
    };
  });

  const projectsByStatus = fProjects.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});
  const projectPie = Object.entries(projectsByStatus).map(([name, value]) => ({ name, value }));

  const pieColors = [
    "var(--color-chart-1)",
    "var(--color-chart-2)",
    "var(--color-chart-3)",
    "var(--color-chart-4)",
    "var(--color-chart-5)",
    "var(--color-warning)",
    "var(--color-destructive)",
  ];

  return (
    <AppShell
      title="Dashboard"
      actions={
        canFilter ? (
          <Select value={slFilter} onValueChange={setSlFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All service lines</SelectItem>
              {SERVICE_LINES.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
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
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiCard label="Customers" value={loading ? "—" : fCustomers.length} icon={Building2} />
        <KpiCard label="Active Projects" value={loading ? "—" : activeProjects.length} icon={Briefcase} accent="info" />
        <KpiCard label="Total Resources" value={loading ? "—" : activeResources.length} icon={Users} />
        <KpiCard label="Fully Allocated" value={loading ? "—" : fullyAllocated} icon={Activity} accent="success" />
        <KpiCard label="On Bench" value={loading ? "—" : benchCount} icon={Coffee} accent="warning" />
        <KpiCard label="Over-allocated" value={loading ? "—" : overAllocated} icon={AlertTriangle} accent="destructive" hint={onLeave ? `${onLeave} on leave` : undefined} />
      </div>

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
        {/* Utilisation vs Target */}
        <div className="rounded-xl border bg-card p-5">
          <h2 className="font-display text-base font-semibold">Utilisation vs Target</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Today's blended util % per SL — green bars are on target, red are below
          </p>
          <div className="h-64 mt-4">
            <ResponsiveContainer>
              <BarChart data={slData} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="sl" stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} unit="%" domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
                  formatter={(value: number, _: string, props: any) => {
                    const d = props.payload;
                    return [`${value}% (target ${d.targetMin}–${d.targetMax}%)`, "Utilisation"];
                  }}
                />
                {/* Per-SL target min reference lines */}
                {slData.map((d) => (
                  <ReferenceLine key={`min-${d.sl}`} y={d.targetMin} stroke="var(--color-muted-foreground)" strokeDasharray="3 3" strokeOpacity={0.4} />
                ))}
                <Bar dataKey="utilization" radius={[6, 6, 0, 0]}>
                  {slData.map((d) => (
                    <Cell
                      key={d.sl}
                      fill={d.inTarget ? "var(--color-success, #22c55e)" : "var(--color-destructive)"}
                      fillOpacity={0.85}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-4 mt-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-success inline-block" /> On/above target</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-destructive inline-block" /> Below target</span>
            <span className="flex items-center gap-1.5"><span className="inline-block w-5 border-t border-dashed border-muted-foreground/50" /> Target floor</span>
          </div>
        </div>

        {/* Cliff Exposure per SL */}
        <div className="rounded-xl border bg-card p-5">
          <h2 className="font-display text-base font-semibold">30/60/90-Day Cliff Exposure</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Resources with no follow-on allocation, by SL and urgency band
          </p>
          <div className="h-64 mt-4">
            <ResponsiveContainer>
              <BarChart data={cliffBySl} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="sl" stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="≤30d" stackId="a" fill="var(--color-destructive)" fillOpacity={0.85} radius={[0, 0, 0, 0]} />
                <Bar dataKey="31–60d" stackId="a" fill="var(--color-warning)" fillOpacity={0.85} />
                <Bar dataKey="61–90d" stackId="a" fill="var(--color-chart-3)" fillOpacity={0.7} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>


      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
        <div className="lg:col-span-2 rounded-xl border bg-card p-5">
          <div className="flex items-baseline justify-between">
            <div>
              <h2 className="font-display text-base font-semibold">Service Line Utilization</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Avg allocation across active resources, today
              </p>
            </div>
          </div>
          <div className="h-72 mt-4">
            <ResponsiveContainer>
              <BarChart data={slData} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="sl" stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={12} tickLine={false} axisLine={false} unit="%" />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  cursor={{ fill: "var(--color-muted)" }}
                />
                <Bar dataKey="utilization" radius={[6, 6, 0, 0]} fill="var(--color-chart-2)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <h2 className="font-display text-base font-semibold">Projects by Status</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Pipeline & workflow snapshot</p>
          <div className="h-72 mt-4">
            {projectPie.length === 0 ? (
              <div className="h-full grid place-items-center text-sm text-muted-foreground">
                No projects yet
              </div>
            ) : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={projectPie}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={85}
                    paddingAngle={2}
                  >
                    {projectPie.map((_, i) => (
                      <Cell key={i} fill={pieColors[i % pieColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-popover)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="p-5 border-b">
            <h2 className="font-display text-base font-semibold">Service Line Summary</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Live, computed from allocations</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/40">
                <tr>
                  <th className="text-left px-5 py-2.5 font-medium">Service Line</th>
                  <th className="text-right px-3 py-2.5 font-medium">Resources</th>
                  <th className="text-right px-3 py-2.5 font-medium">Fully Alloc.</th>
                  <th className="text-right px-3 py-2.5 font-medium">Bench</th>
                  <th className="text-right px-5 py-2.5 font-medium">Util %</th>
                </tr>
              </thead>
              <tbody>
                {slData.map((r) => (
                  <tr key={r.sl} className="border-t">
                    <td className="px-5 py-3 font-medium">{r.sl}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.resources}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.fully}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.bench}</td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      <span
                        className={
                          r.utilization > 100
                            ? "text-destructive font-medium"
                            : r.utilization >= 80
                              ? "text-warning-foreground font-medium"
                              : "text-success font-medium"
                        }
                      >
                        {r.utilization}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="p-5 border-b">
            <h2 className="font-display text-base font-semibold">Recent Projects</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Latest activity</p>
          </div>
          <div className="divide-y">
            {fProjects.slice(0, 6).map((p) => (
              <div key={p.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">
                    <span className="font-mono text-xs text-muted-foreground mr-2">
                      {p.project_code}
                    </span>
                    {p.project_description}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {(p as any).customers?.customer_name ?? "—"} · {p.service_line}
                  </div>
                </div>
                <ProjectStatusBadge status={p.status} />
              </div>
            ))}
            {fProjects.length === 0 && (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                {slFilter === "all" ? "No projects yet. Create one from the Projects screen." : `No ${slFilter} projects.`}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
