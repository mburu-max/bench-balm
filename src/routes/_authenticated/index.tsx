import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { KpiCard } from "@/components/KpiCard";
import { useAllocations, useCustomers, useProjects, useResources } from "@/lib/queries";
import { computeBench } from "@/lib/bench";
import { SERVICE_LINES } from "@/lib/constants";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Users,
  Briefcase,
  Building2,
  Activity,
  AlertTriangle,
  Coffee,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
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

  const trend = useQuery({
    queryKey: ["util-trend"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_utilisation_weekly").select("*");
      if (error) throw error;
      return data ?? [];
    },
  });

  const loading =
    customers.isLoading || projects.isLoading || resources.isLoading || allocations.isLoading;

  const activeProjects = (projects.data ?? []).filter((p) => p.status === "Active");
  const activeResources = (resources.data ?? []).filter((r) => r.status === "Active");
  const bench = computeBench(activeResources, allocations.data ?? []);
  const benchCount = bench.filter((b) => b.benchPct > 0).length;
  const fullyAllocated = bench.filter((b) => b.benchPct === 0).length;
  const overAllocated = bench.filter((b) => b.benchPct < 0).length;
  const onLeave = (resources.data ?? []).filter((r) => r.status === "On_Leave").length;

  // Per service line stats
  const slData = SERVICE_LINES.map((sl) => {
    const slRes = activeResources.filter((r) => r.service_line === sl);
    const slBench = computeBench(slRes, allocations.data ?? []);
    const allocated = slBench.reduce((s, b) => s + Math.min(100, b.totalPct), 0);
    const total = slRes.length * 100;
    const utilization = total > 0 ? Math.round((allocated / total) * 100) : 0;
    return {
      sl,
      resources: slRes.length,
      utilization,
      bench: slBench.filter((b) => b.benchPct > 0).length,
      fully: slBench.filter((b) => b.benchPct === 0).length,
    };
  });

  const projectsByStatus = (projects.data ?? []).reduce<Record<string, number>>((acc, p) => {
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
    <AppShell title="Dashboard">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiCard label="Customers" value={loading ? "—" : customers.data?.length ?? 0} icon={Building2} />
        <KpiCard label="Active Projects" value={loading ? "—" : activeProjects.length} icon={Briefcase} accent="info" />
        <KpiCard label="Total Resources" value={loading ? "—" : activeResources.length} icon={Users} />
        <KpiCard label="Fully Allocated" value={loading ? "—" : fullyAllocated} icon={Activity} accent="success" />
        <KpiCard label="On Bench" value={loading ? "—" : benchCount} icon={Coffee} accent="warning" />
        <KpiCard label="Over-allocated" value={loading ? "—" : overAllocated} icon={AlertTriangle} accent="destructive" hint={onLeave ? `${onLeave} on leave` : undefined} />
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
            {(projects.data ?? []).slice(0, 6).map((p) => (
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
            {(projects.data ?? []).length === 0 && (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">
                No projects yet. Create one from the Projects screen.
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
