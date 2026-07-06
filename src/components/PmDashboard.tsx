import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { KpiCard } from "@/components/KpiCard";
import { useAllocations, useProjects, useResources } from "@/lib/queries";
import { todayStr } from "@/lib/dashboard";
import { supabase } from "@/integrations/supabase/client";
import { ProjectStatusBadge } from "@/components/StatusBadge";
import {
  FolderKanban, Clock, Users, AlertOctagon, AlertTriangle, ArrowRight, CheckCircle2, UserX,
} from "lucide-react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

const pieColors = [
  "var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)",
  "var(--color-chart-4)", "var(--color-chart-5)", "var(--color-warning)", "var(--color-destructive)",
];
const STATUS_ORDER: Record<string, number> = { Active: 0, Draft: 1, Verified: 2, On_Hold: 3, Rejected: 4, Closed: 5 };
const PREVIEW_CAP = 5; // dashboard is a preview — deep-dive lives on the full pages

// A PM only sees allocations on their own projects, so resource-level utilisation/bench would be
// computed from partial data and mislead. This view is project- and continuity-focused instead.
export function PmDashboard() {
  const projects = useProjects();
  const resources = useResources();
  const allocations = useAllocations();
  const today = todayStr();

  const cliffEdge = useQuery({
    queryKey: ["cliff-edge-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_cliff_edge").select("*");
      if (error) throw error;
      return data ?? [];
    },
  });

  const loading = projects.isLoading || resources.isLoading || allocations.isLoading;

  const myProjects = projects.data ?? [];
  const activeProjects = myProjects.filter((p) => p.status === "Active");
  const pendingProjects = myProjects.filter((p) => p.status === "Draft" || p.status === "Verified");

  const allAllocations = allocations.data ?? [];
  const currentAllocs = allAllocations.filter(
    (a) => a.allocation_type !== "Leave" && a.allocation_start_date <= today && a.allocation_end_date >= today,
  );
  const resByProject: Record<string, Set<string>> = {};
  for (const a of currentAllocs) if (a.project_id) (resByProject[a.project_id] ??= new Set()).add(a.resource_id);
  const teamSize = new Set(currentAllocs.map((a) => a.resource_id)).size;
  const unstaffedActive = activeProjects.filter((p) => !resByProject[p.id] || resByProject[p.id].size === 0);

  const cliff = cliffEdge.data ?? [];
  const rolloffs30 = cliff.filter((r) => (r.cliff_band ?? 90) <= 30);
  const gaps = rolloffs30;

  // My team: current allocations grouped by resource (% is "on your projects" only).
  const teamMap = new Map<string, { name: string; omni: string; projects: { id: string; code: string }[]; pct: number; nextEnd: string | null }>();
  for (const a of currentAllocs) {
    const key = a.resource_id;
    const entry = teamMap.get(key) ?? { name: a.resource_name, omni: a.omni_id, projects: [], pct: 0, nextEnd: null };
    entry.pct += a.allocation_pct ?? 0;
    if (a.project_id && !entry.projects.some((p) => p.id === a.project_id)) {
      entry.projects.push({ id: a.project_id, code: (a as any).projects?.project_code ?? "" });
    }
    entry.nextEnd = entry.nextEnd == null || a.allocation_end_date < entry.nextEnd ? a.allocation_end_date : entry.nextEnd;
    teamMap.set(key, entry);
  }
  const team = [...teamMap.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => (a.nextEnd ?? "").localeCompare(b.nextEnd ?? ""));

  // Surface risk first: unstaffed-active, then active by fewest resources, then by status.
  const projectRows = [...myProjects].sort((a, b) => {
    const ca = resByProject[a.id]?.size ?? 0, cb = resByProject[b.id]?.size ?? 0;
    const ra = a.status === "Active" && ca === 0 ? -1 : (STATUS_ORDER[a.status] ?? 9);
    const rb = b.status === "Active" && cb === 0 ? -1 : (STATUS_ORDER[b.status] ?? 9);
    return ra - rb || ca - cb;
  });

  const projectsByStatus = myProjects.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1; return acc;
  }, {});
  const projectPie = Object.entries(projectsByStatus).map(([name, value]) => ({ name: name.replace("_", " "), value }));

  return (
    <AppShell title="My Projects">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiCard label="Active Projects" value={loading ? "—" : activeProjects.length} icon={FolderKanban} accent="info" />
        <KpiCard label="Pending" value={loading ? "—" : pendingProjects.length} icon={Clock} accent="warning" hint="Draft / Verified" />
        <KpiCard label="Team" value={loading ? "—" : teamSize} icon={Users} hint="on your projects" />
        <KpiCard label="Unstaffed Active" value={loading ? "—" : unstaffedActive.length} icon={UserX} accent={unstaffedActive.length > 0 ? "destructive" : "success"} />
        <KpiCard label="Roll-offs ≤30d" value={loading ? "—" : rolloffs30.length} icon={AlertTriangle} accent="warning" />
        <KpiCard label="Roll-offs ≤90d" value={loading ? "—" : cliff.length} icon={AlertOctagon} />
      </div>

      {/* Cliff banner */}
      {cliff.length > 0 && (
        <Link to="/cliff-edge" className="block mt-6">
          <div className={`rounded-xl border p-4 flex items-center justify-between gap-4 transition-colors hover:bg-muted/40 ${rolloffs30.length > 0 ? "border-destructive/40 bg-destructive/5" : "border-warning/40 bg-warning/5"}`}>
            <div className="flex items-center gap-3">
              <AlertOctagon className={`size-5 ${rolloffs30.length > 0 ? "text-destructive" : "text-warning-foreground"}`} />
              <div>
                <div className="text-sm font-medium">{cliff.length} on your projects rolling off within 90 days with no follow-on</div>
                <div className="text-xs text-muted-foreground mt-0.5">{rolloffs30.length > 0 ? `${rolloffs30.length} within 30 days — line up their next allocation` : "None urgent yet, but worth planning"}</div>
              </div>
            </div>
            <ArrowRight className="size-4 text-muted-foreground" />
          </div>
        </Link>
      )}

      {/* Needs attention + Upcoming gaps */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
        {/* Unstaffed active projects */}
        <div className="rounded-xl border bg-card overflow-hidden flex flex-col">
          <div className="p-5 border-b flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold">Needs attention</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Active projects with no resources assigned today</p>
            </div>
            {unstaffedActive.length > PREVIEW_CAP && (
              <Link to="/projects" className="text-xs text-primary hover:underline shrink-0">View all {unstaffedActive.length} →</Link>
            )}
          </div>
          {unstaffedActive.length === 0 ? (
            <div className="flex-1 grid place-items-center p-10 text-center">
              <div>
                <CheckCircle2 className="size-10 mx-auto text-success" />
                <div className="mt-2 text-sm font-medium">Every active project is staffed</div>
              </div>
            </div>
          ) : (
            <div className="divide-y">
              {unstaffedActive.slice(0, PREVIEW_CAP).map((p: any) => (
                <Link key={p.id} to="/projects/$projectId" params={{ projectId: p.id }} className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-muted/40">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      <span className="font-mono text-xs text-muted-foreground mr-2">{p.project_code}</span>{p.project_description}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{p.customers?.customer_name ?? "—"} · ends {p.end_date}</div>
                  </div>
                  <span className="text-xs font-medium text-destructive shrink-0">No one assigned</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming gaps ≤30d */}
        <div className="rounded-xl border bg-card overflow-hidden flex flex-col">
          <div className="p-5 border-b flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold">Upcoming Gaps</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Allocations ending within 30 days, no follow-on</p>
            </div>
            {gaps.length > PREVIEW_CAP && (
              <Link to="/cliff-edge" className="text-xs text-primary hover:underline shrink-0">View all {gaps.length} →</Link>
            )}
          </div>
          {gaps.length === 0 ? (
            <div className="flex-1 grid place-items-center p-10 text-center">
              <div>
                <CheckCircle2 className="size-10 mx-auto text-success" />
                <div className="mt-2 text-sm font-medium">No roll-offs in the next 30 days</div>
              </div>
            </div>
          ) : (
            <div className="divide-y">
              {gaps.slice(0, PREVIEW_CAP).map((g) => (
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

      {/* My Projects table */}
      <div className="mt-6 rounded-xl border bg-card overflow-hidden">
        <div className="p-5 border-b flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold">Projects</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Top {PREVIEW_CAP} needing attention — unstaffed & active first</p>
          </div>
          {myProjects.length > PREVIEW_CAP && (
            <Link to="/projects" className="text-xs text-primary hover:underline shrink-0">View all {myProjects.length} →</Link>
          )}
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
                <th className="text-left px-5 py-2.5 font-medium">Dates</th>
              </tr>
            </thead>
            <tbody>
              {projectRows.slice(0, PREVIEW_CAP).map((p: any) => {
                const count = resByProject[p.id]?.size ?? 0;
                const unstaffed = p.status === "Active" && count === 0;
                return (
                  <tr key={p.id} className="border-t hover:bg-muted/30">
                    <td className="px-5 py-3 font-mono text-xs">
                      <Link to="/projects/$projectId" params={{ projectId: p.id }} className="text-primary hover:underline">{p.project_code}</Link>
                    </td>
                    <td className="px-3 py-3">{p.project_description}</td>
                    <td className="px-3 py-3 text-muted-foreground">{p.customers?.customer_name ?? "—"}</td>
                    <td className="px-3 py-3"><ProjectStatusBadge status={p.status} /></td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <Link to="/projects/$projectId" params={{ projectId: p.id }} className={unstaffed ? "text-destructive font-medium hover:underline" : "text-primary hover:underline"}>{count}</Link>
                    </td>
                    <td className="px-5 py-3 text-xs tabular-nums text-muted-foreground">{p.start_date} → {p.end_date}</td>
                  </tr>
                );
              })}
              {projectRows.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">You don't own any projects yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* My Team + Projects by status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
        <div className="lg:col-span-2 rounded-xl border bg-card overflow-hidden">
          <div className="p-5 border-b flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold">My Team</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Top {PREVIEW_CAP} by soonest roll-off</p>
            </div>
            {team.length > PREVIEW_CAP && (
              <Link to="/project-allocations" className="text-xs text-primary hover:underline shrink-0">View all {team.length} →</Link>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/40">
                <tr>
                  <th className="text-left px-5 py-2.5 font-medium">Resource</th>
                  <th className="text-left px-3 py-2.5 font-medium">On projects</th>
                  <th className="text-right px-3 py-2.5 font-medium">% on your projects</th>
                  <th className="text-left px-5 py-2.5 font-medium">Next roll-off</th>
                </tr>
              </thead>
              <tbody>
                {team.slice(0, PREVIEW_CAP).map((t) => (
                  <tr key={t.id} className="border-t hover:bg-muted/30">
                    <td className="px-5 py-3">
                      <div className="font-medium">{t.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{t.omni}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {t.projects.map((p) => (
                          <Link key={p.id} to="/projects/$projectId" params={{ projectId: p.id }} className="font-mono text-xs text-primary hover:underline">{p.code}</Link>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium">{t.pct}%</td>
                    <td className="px-5 py-3 text-xs tabular-nums text-muted-foreground">{t.nextEnd ?? "—"}</td>
                  </tr>
                ))}
                {team.length === 0 && <tr><td colSpan={4} className="px-5 py-10 text-center text-muted-foreground">No one is allocated to your projects today.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <h2 className="font-display text-base font-semibold">Projects by Status</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Your pipeline</p>
          <div className="h-64 mt-4">
            {projectPie.length === 0 ? (
              <div className="h-full grid place-items-center text-sm text-muted-foreground">No projects yet</div>
            ) : (
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={projectPie} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
                    {projectPie.map((_, i) => <Cell key={i} fill={pieColors[i % pieColors.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
