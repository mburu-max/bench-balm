import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { KpiCard } from "@/components/KpiCard";
import { supabase } from "@/integrations/supabase/client";
import { useResources, useAllocations } from "@/lib/queries";
import { computeBench } from "@/lib/bench";
import { horizonStr } from "@/lib/dashboard";
import {
  TrendingUp, AlertTriangle, Coffee, Clock, CheckSquare,
  RefreshCw, BarChart2, Target, CalendarClock, Scale, Network,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/kpis")({
  component: KpisPage,
});

// RAG thresholds from doc table 6.1
function rag(value: number, green: number, amber: number, higherIsBetter = true): "success" | "warning" | "destructive" {
  if (higherIsBetter) {
    if (value >= green) return "success";
    if (value >= amber) return "warning";
    return "destructive";
  } else {
    if (value <= green) return "success";
    if (value <= amber) return "warning";
    return "destructive";
  }
}

function KpisPage() {
  const resources = useResources();
  const allocations = useAllocations();

  const active = (resources.data ?? []).filter((r) => r.status === "Active");
  const bench = computeBench(active, allocations.data ?? []);
  const overAllocatedCount = bench.filter((b) => b.benchPct < 0).length;
  // Bench Rate = unallocated (idle) resources / total (RA §6.1), not merely under 100%.
  const benchCount = bench.filter((b) => b.benchPct === 100).length;
  const billableUtilisation = active.length > 0
    ? Math.round(bench.reduce((s, b) => s + Math.min(100, b.totalPct), 0) / active.length)
    : 0;
  const benchRate = active.length > 0 ? Math.round((benchCount / active.length) * 100) : 0;
  const overAllocRate = active.length > 0 ? Math.round((overAllocatedCount / active.length) * 100) : 0;

  // Contractor / vendor allocations ending soon — margin-exposure early warning.
  const _today = new Date().toISOString().slice(0, 10);
  const in30 = horizonStr(30);
  const in90 = horizonStr(90);
  const externalIds = new Set(active.filter((r) => r.employment_type !== "FTE").map((r) => r.id));
  const externalExpiring = (allocations.data ?? []).filter(
    (a) => externalIds.has(a.resource_id)
      && (a.allocation_type === "Billable" || a.allocation_type === "Non-Billable")
      && a.allocation_end_date >= _today && a.allocation_end_date <= in90,
  );
  const alloc90 = new Set(externalExpiring.map((a) => a.resource_id)).size;
  const alloc30 = new Set(externalExpiring.filter((a) => a.allocation_end_date <= in30).map((a) => a.resource_id)).size;

  // Portfolio utilisation variance — spread between the hottest and coolest service line.
  // Company-wide by nature (needs ≥2 SLs), so a single-SL viewer sees "—".
  const utilBySl: Record<string, { alloc: number; count: number }> = {};
  for (const b of bench) {
    const sl = b.resource.service_line;
    (utilBySl[sl] ??= { alloc: 0, count: 0 });
    utilBySl[sl].alloc += Math.min(100, b.totalPct);
    utilBySl[sl].count += 1;
  }
  const slUtils = Object.entries(utilBySl)
    .filter(([, s]) => s.count > 0)
    .map(([sl, s]) => ({ sl, util: Math.round((s.alloc / (s.count * 100)) * 100) }))
    .sort((a, b) => b.util - a.util);
  const varHi = slUtils[0];
  const varLo = slUtils[slUtils.length - 1];
  const utilVariance = slUtils.length >= 2 ? varHi.util - varLo.util : 0;

  // Avg allocation horizon — mean weeks left on current billable/non-billable allocations.
  const activeIds = new Set(active.map((r) => r.id));
  const currentEngaged = (allocations.data ?? []).filter(
    (a) => activeIds.has(a.resource_id)
      && (a.allocation_type === "Billable" || a.allocation_type === "Non-Billable")
      && a.allocation_start_date <= _today && a.allocation_end_date >= _today,
  );
  const avgHorizonWeeks = currentEngaged.length
    ? Math.round((currentEngaged.reduce((s, a) => s + Math.max(0, (new Date(a.allocation_end_date).getTime() - new Date(_today).getTime()) / 86400000), 0) / currentEngaged.length / 7) * 10) / 10
    : 0;

  // Resources per manager (span of control) — from the manager-of-record on allocations.
  // The app's PM role/accounts aren't populated yet, so this uses the imported manager field.
  const spanByManager: Record<string, Set<string>> = {};
  for (const a of allocations.data ?? []) {
    if (!a.manager || !activeIds.has(a.resource_id)) continue;
    (spanByManager[a.manager] ??= new Set()).add(a.resource_id);
  }
  const managerSpans = Object.entries(spanByManager)
    .map(([manager, set]) => ({ manager, count: set.size }))
    .sort((x, y) => y.count - x.count);
  const managerCount = managerSpans.length;
  const avgPerManager = managerCount
    ? Math.round((managerSpans.reduce((s, m) => s + m.count, 0) / managerCount) * 10) / 10
    : 0;
  const busiestManager = managerSpans[0];
  const maxSpan = busiestManager?.count ?? 0;

  const coverage = useQuery({
    queryKey: ["kpi-coverage"],
    queryFn: async () => {
      const { data } = await supabase.from("v_kpi_project_code_coverage").select("*").single();
      return data?.pct_with_project_code ?? 0;
    },
  });

  const freshness = useQuery({
    queryKey: ["kpi-freshness"],
    queryFn: async () => {
      const { data } = await supabase.from("v_kpi_allocation_freshness").select("*").single();
      return data?.pct_fresh ?? 0;
    },
  });

  const benchDays = useQuery({
    queryKey: ["kpi-bench-days"],
    queryFn: async () => {
      const { data } = await supabase.from("v_kpi_avg_bench_days").select("*").single();
      return data?.avg_bench_days ?? 0;
    },
  });

  const demandLead = useQuery({
    queryKey: ["kpi-demand-lead"],
    queryFn: async () => {
      const { data } = await supabase.from("v_kpi_demand_lead_time").select("*").single();
      return data?.avg_lead_time_days ?? 0;
    },
  });

  const pctCoverage = Math.round(Number(coverage.data ?? 0));
  const pctFresh = Math.round(Number(freshness.data ?? 0));
  const avgBenchDays = Math.round(Number(benchDays.data ?? 0));
  const avgLeadDays = Math.round(Number(demandLead.data ?? 0));

  return (
    <AppShell title="KPI Dashboard">
      <p className="text-sm text-muted-foreground mb-6">
        The 8 core KPIs from RA §6.1 (RAG thresholds applied automatically), plus a set of margin, structural, and management watch metrics.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Billable Utilisation % */}
        <KpiCard
          label="Billable Utilisation"
          value={`${billableUtilisation}%`}
          icon={TrendingUp}
          accent={rag(billableUtilisation, 75, 60)}
          hint="Green ≥75% · Amber 60–74% · Red <60%"
        />

        {/* KPI 2: Bench Rate */}
        <KpiCard
          label="Bench Rate"
          value={`${benchRate}%`}
          icon={Coffee}
          accent={rag(benchRate, 8, 15, false)}
          hint="Green <8% · Amber 8–15% · Red >15%"
        />

        {/* KPI 3: Over-allocation Rate */}
        <KpiCard
          label="Over-allocation Rate"
          value={`${overAllocRate}%`}
          icon={AlertTriangle}
          accent={rag(overAllocRate, 2, 5, false)}
          hint="Green <2% · Amber 2–5% · Red >5%"
        />

        {/* KPI 4: Allocation Data Freshness */}
        <KpiCard
          label="Data Freshness"
          value={freshness.isLoading ? "—" : `${pctFresh}%`}
          icon={RefreshCw}
          accent={rag(pctFresh, 95, 80)}
          hint="% allocations updated in last 14 days · Green >95% · Amber 80–95%"
        />

        {/* KPI 5: Bench Resolution Time (proxy: avg current streak) */}
        <KpiCard
          label="Avg Days on Bench"
          value={benchDays.isLoading ? "—" : `${avgBenchDays}d`}
          icon={Clock}
          accent={rag(avgBenchDays, 10, 20, false)}
          hint="Based on snapshot history · Green <10d · Amber 10–20d"
        />

        {/* KPI 6: Project Code Coverage */}
        <KpiCard
          label="Project Code Coverage"
          value={coverage.isLoading ? "—" : `${pctCoverage}%`}
          icon={CheckSquare}
          accent={rag(pctCoverage, 100, 95)}
          hint="% allocations with a linked project · Green 100% · Amber 95–99%"
        />

        {/* KPI 7: Demand Lead Time */}
        <KpiCard
          label="Demand Lead Time"
          value={demandLead.isLoading ? "—" : `${avgLeadDays}d`}
          icon={BarChart2}
          accent={rag(avgLeadDays, 10, 21, false)}
          hint="Avg days demand raised → fulfilled · Green <10d · Amber 10–21d"
        />

        {/* KPI 8: Forecast Accuracy (shown as placeholder until headcount_forecast rows are populated) */}
        <KpiCard
          label="Forecast Accuracy"
          value="—"
          icon={Target}
          accent="info"
          hint="Populate headcount targets in headcount_forecast table to enable"
        />

        {/* Margin watch (not a §6.1 KPI): external allocations ending soon */}
        <KpiCard
          label="Contractor Allocations"
          value={alloc90}
          icon={CalendarClock}
          accent={alloc30 > 0 ? "warning" : alloc90 > 0 ? "info" : "success"}
          hint={`External Contractor/Vendor · Allocation ≤ 90 Days: ${alloc90} · Allocation ≤ 30 Days: ${alloc30}`}
        />

        {/* Structural watch (not a §6.1 KPI): utilisation spread across service lines */}
        <KpiCard
          label="Utilisation Variance"
          value={slUtils.length < 2 ? "—" : `${utilVariance}pp`}
          icon={Scale}
          accent={utilVariance >= 30 ? "destructive" : utilVariance >= 15 ? "warning" : "info"}
          hint={slUtils.length >= 2 ? `${varHi.sl} ${varHi.util}% ↔ ${varLo.sl} ${varLo.util}%` : "needs ≥2 service lines"}
        />

        {/* Forward watch (not a §6.1 KPI): avg booked runway across current allocations */}
        <KpiCard
          label="Avg Horizon"
          value={currentEngaged.length ? `${avgHorizonWeeks} wk` : "—"}
          icon={CalendarClock}
          accent={currentEngaged.length === 0 ? "info" : avgHorizonWeeks <= 3 ? "destructive" : avgHorizonWeeks <= 6 ? "warning" : "success"}
          hint="Mean weeks left on current allocations"
        />

        {/* Span of control (not a §6.1 KPI): resources per manager-of-record. Colour keys off
            the busiest manager so a healthy average still flags an overloaded one. */}
        <KpiCard
          label="Resources / Manager"
          value={managerCount ? avgPerManager : "—"}
          icon={Network}
          accent={managerCount === 0 ? "info" : maxSpan > 12 ? "destructive" : maxSpan >= 9 ? "warning" : "success"}
          hint={managerCount ? `${managerCount} managers · busiest ${busiestManager.manager} (${maxSpan})` : undefined}
        />
      </div>
    </AppShell>
  );
}
