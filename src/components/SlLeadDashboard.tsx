import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { KpiCard } from "@/components/KpiCard";
import { UtilBullets } from "@/components/UtilBullets";
import { Button } from "@/components/ui/button";
import { useAllocations, useProjects, useResources } from "@/lib/queries";
import { SERVICE_LINES } from "@/lib/constants";
import { useCurrentRole } from "@/lib/useCurrentRole";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SL_COLORS, todayStr, computeUtilTrend, type UtilView } from "@/lib/dashboard";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Users, Briefcase, Activity, Coffee, AlertTriangle, UserMinus, AlertOctagon, ArrowRight, CheckCircle2, ClipboardCheck, BatteryMedium,
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
  const [utilView, setUtilView] = useState<UtilView>("both");

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
  // Cross-SL-accurate load per resource (total across the WHOLE ledger, not just this SL).
  const loadQ = useQuery({
    queryKey: ["resource-load"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("resource_current_load");
      if (error) throw error;
      return (data ?? []) as { resource_id: string; home_sl: string; total_pct: number; other_sl_pct: number }[];
    },
  });
  const loadMap = new Map((loadQ.data ?? []).map((l) => [l.resource_id, l]));
  const loadOf = (id: string) => loadMap.get(id)?.total_pct ?? 0;

  const qc = useQueryClient();
  const verify = async (p: any) => {
    const { error } = await supabase.from("projects").update({ status: "Verified" }).eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success(`${p.project_code} verified`);
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  const loading = projects.isLoading || resources.isLoading || allocations.isLoading;
  const today = todayStr();

  // RLS already scopes to the lead's service line(s) / the PM's projects; this optional
  // filter lets a multi-SL lead slice between their own service lines.
  const allProjects = (projects.data ?? []).filter((p) => matchesSl(p.service_line));
  const allResources = (resources.data ?? []).filter((r) => matchesSl(r.service_line));
  const allAllocations = (allocations.data ?? []).filter((a) => matchesSl(a.service_line));
  const activeProjects = allProjects.filter((p) => p.status === "Active");
  const activeResources = allResources.filter((r) => r.status === "Active");
  // Load-based (cross-SL accurate): counts a loaned-out resource as genuinely unavailable.
  const overAllocated = activeResources.filter((r) => loadOf(r.id) > 100).length;
  const fullyAllocated = activeResources.filter((r) => loadOf(r.id) === 100).length;
  // On Bench = genuinely idle (0% total load), i.e. who needs work now — not merely under 100%.
  const benchCount = activeResources.filter((r) => loadOf(r.id) === 0).length;
  // On leave = temporarily unavailable (returning). Exited are departed, not a capacity signal.
  const inactiveCount = allResources.filter((r) => r.status === "On_Leave").length;
  // Partially allocated (1–99% total load) — has spare capacity but isn't idle; shown on none
  // of the other capacity cards, so surface it directly (bench already means genuinely idle).
  const partiallyAllocated = activeResources.filter((r) => { const l = loadOf(r.id); return l > 0 && l < 100; }).length;

  // Practice composition
  const contractorHeads = activeResources.filter((r) => r.employment_type !== "FTE").length;
  const contractorPct = activeResources.length ? Math.round((contractorHeads / activeResources.length) * 100) : 0;
  const currentAllocs = allAllocations.filter(
    (a) => a.allocation_type !== "Leave" && a.allocation_start_date <= today && a.allocation_end_date >= today,
  );
  // Capacity-weighted by allocation % (not a raw row count) — the real revenue mix.
  let billablePctSum = 0, nonBillablePctSum = 0;
  for (const a of currentAllocs) {
    const pct = a.allocation_pct ?? 0;
    if (a.allocation_type === "Billable") billablePctSum += pct; else nonBillablePctSum += pct;
  }
  const billTotal = billablePctSum + nonBillablePctSum;
  const billablePct = billTotal ? Math.round((billablePctSum / billTotal) * 100) : 0;
  // Billable share split by employment cohort — are contractors kept on revenue work?
  const empOf = new Map(activeResources.map((r) => [r.id, r.employment_type]));
  let fteBill = 0, fteTot = 0, conBill = 0, conTot = 0;
  for (const a of currentAllocs) {
    const pct = a.allocation_pct ?? 0;
    if (empOf.get(a.resource_id) === "FTE") { fteTot += pct; if (a.allocation_type === "Billable") fteBill += pct; }
    else { conTot += pct; if (a.allocation_type === "Billable") conBill += pct; }
  }
  const fteBillShare = fteTot ? Math.round((fteBill / fteTot) * 100) : null;
  const conBillShare = conTot ? Math.round((conBill / conTot) * 100) : null;
  const cohortBillLine = [
    fteBillShare != null ? `FTE ${fteBillShare}%` : null,
    conBillShare != null ? `Contractor ${conBillShare}%` : null,
  ].filter(Boolean).join(" · ");

  // Pending validations: draft projects awaiting the SL Lead's Step-2 verification.
  const pendingDrafts = allProjects.filter((p) => p.status === "Draft");

  const shownSls = SERVICE_LINES.filter(
    (sl) => allResources.some((r) => r.service_line === sl) || allProjects.some((p) => p.service_line === sl),
  );

  const headcountBySl: Record<string, number> = {};
  for (const r of activeResources) headcountBySl[r.service_line] = (headcountBySl[r.service_line] ?? 0) + 1;

  const slData = shownSls.map((sl) => {
    const slRes = activeResources.filter((r) => r.service_line === sl);
    const allocated = slRes.reduce((s, r) => s + Math.min(100, loadOf(r.id)), 0);
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
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
        <KpiCard label="Total Resources" value={loading ? "—" : activeResources.length} icon={Users} to="/resources" />
        <KpiCard label="Active Projects" value={loading ? "—" : activeProjects.length} icon={Briefcase} accent="info" to="/projects" search={{ status: "Active" }} />
        <KpiCard label="Fully Allocated" value={loading ? "—" : fullyAllocated} icon={Activity} accent="success" to="/bench" search={{ band: "fully" }} />
        <KpiCard label="On Bench" value={loading ? "—" : benchCount} icon={Coffee} accent="warning" to="/bench" search={{ band: "zero" }} />
        <KpiCard label="Partially Allocated" value={loading ? "—" : partiallyAllocated} icon={BatteryMedium} accent="info" to="/bench" search={{ band: "partial" }} />
        <KpiCard label="On Leave" value={loading ? "—" : inactiveCount} icon={UserMinus} to="/resources" />
        <KpiCard label="Over-allocated" value={loading ? "—" : overAllocated} icon={AlertTriangle} accent="destructive" to="/bench" search={{ band: "over" }} />
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

      {/* Pending Line Verifications — PM-created drafts awaiting your Step-2 validation */}
      {isLead && pendingDrafts.length > 0 && (
        <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 overflow-hidden">
          <div className="px-5 py-3 border-b border-primary/20 flex items-center gap-2">
            <ClipboardCheck className="size-4 text-primary" />
            <span className="text-sm font-medium">{pendingDrafts.length} draft project{pendingDrafts.length === 1 ? "" : "s"} pending your validation</span>
          </div>
          <div className="divide-y">
            {pendingDrafts.slice(0, 5).map((p: any) => (
              <div key={p.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0 text-sm">
                  <Link to="/projects/$projectId" params={{ projectId: p.id }} className="font-mono text-xs text-primary hover:underline mr-2">{p.project_code}</Link>
                  {p.project_description}
                  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground uppercase tracking-wide">{p.service_line}</span>
                </div>
                <Button size="sm" onClick={() => verify(p)}>Verify <ArrowRight className="size-3.5 ml-1" /></Button>
              </div>
            ))}
          </div>
          {pendingDrafts.length > 5 && (
            <Link to="/projects" className="block px-5 py-2 text-xs text-primary hover:underline border-t border-primary/20">View all {pendingDrafts.length} in Projects →</Link>
          )}
        </div>
      )}

      {/* Upper charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold">Utilisation vs Target</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Blended util % vs the target band</p>
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

        <div className="rounded-xl border bg-card p-5">
          <h2 className="font-display text-base font-semibold">30/60/90-Day Cliff Exposure</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Resources with no follow-on allocation, by urgency band</p>
          <div className="h-64 mt-4">
            {!cliffEdge.isLoading && cliff.length === 0 ? (
              <div className="h-full grid place-items-center text-center">
                <div>
                  <CheckCircle2 className="size-10 mx-auto text-success" />
                  <div className="mt-2 text-sm font-medium">All clear</div>
                  <div className="text-xs text-muted-foreground mt-0.5">No resources roll off without follow-on in the next 90 days.</div>
                </div>
              </div>
            ) : (
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
            )}
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
            <div className="divide-y">
              {gaps.slice(0, 5).map((g) => (
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
              {gaps.length > 5 && (
                <Link to="/cliff-edge" className="block px-5 py-2 text-xs text-primary hover:underline">View all {gaps.length} →</Link>
              )}
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
              {cohortBillLine && <div className="text-xs text-muted-foreground mt-1">{cohortBillLine} billable</div>}
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
