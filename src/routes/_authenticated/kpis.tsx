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
  RefreshCw, BarChart2, Target, CalendarClock,
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

  // Contractor / vendor allocations rolling off soon — margin-exposure early warning.
  const _today = new Date().toISOString().slice(0, 10);
  const in30 = horizonStr(30);
  const in60 = horizonStr(60);
  const externalIds = new Set(active.filter((r) => r.employment_type !== "FTE").map((r) => r.id));
  const externalExpiring = (allocations.data ?? []).filter(
    (a) => externalIds.has(a.resource_id)
      && (a.allocation_type === "Billable" || a.allocation_type === "Non-Billable")
      && a.allocation_end_date >= _today && a.allocation_end_date <= in60,
  );
  const rollOff60 = new Set(externalExpiring.map((a) => a.resource_id)).size;
  const rollOff30 = new Set(externalExpiring.filter((a) => a.allocation_end_date <= in30).map((a) => a.resource_id)).size;

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
        The 8 core KPIs from RA §6.1 (RAG thresholds applied automatically), plus a contractor roll-off watch for margin planning.
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

        {/* Margin watch (not a §6.1 KPI): external allocations rolling off soon */}
        <KpiCard
          label="Contractor Roll-offs"
          value={rollOff60}
          icon={CalendarClock}
          accent={rollOff30 > 0 ? "warning" : rollOff60 > 0 ? "info" : "success"}
          hint={`External (Contractor/Vendor) rolling off ≤60d · ${rollOff30} within 30d`}
        />
      </div>
    </AppShell>
  );
}
