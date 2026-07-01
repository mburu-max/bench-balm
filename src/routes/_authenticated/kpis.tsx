import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { KpiCard } from "@/components/KpiCard";
import { supabase } from "@/integrations/supabase/client";
import { useResources, useAllocations } from "@/lib/queries";
import { computeBench } from "@/lib/bench";
import {
  TrendingUp, AlertTriangle, Coffee, Clock, CheckSquare,
  RefreshCw, BarChart2, Target,
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
  const benchCount = bench.filter((b) => b.benchPct > 0).length;
  const billableUtilisation = active.length > 0
    ? Math.round(bench.reduce((s, b) => s + Math.min(100, b.totalPct), 0) / active.length)
    : 0;
  const benchRate = active.length > 0 ? Math.round((benchCount / active.length) * 100) : 0;
  const overAllocRate = active.length > 0 ? Math.round((overAllocatedCount / active.length) * 100) : 0;

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
        All 8 core KPIs from RA Standard Requirements §6.1 — RAG thresholds applied automatically.
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
      </div>

      <div className="mt-8 rounded-xl border bg-card p-5 text-sm text-muted-foreground">
        <p className="font-medium text-foreground mb-1">Notes</p>
        <ul className="list-disc list-inside space-y-1">
          <li><strong>Avg Days on Bench</strong> and <strong>Forecast Accuracy</strong> improve as daily snapshot history accumulates (pg_cron runs daily at 01:00 UTC).</li>
          <li><strong>Demand Lead Time</strong> requires demand requests to be closed as "Fulfilled" to populate.</li>
          <li><strong>Forecast Accuracy</strong> requires planned headcount rows in the <code>headcount_forecast</code> table — editable by Governance Lead.</li>
        </ul>
      </div>
    </AppShell>
  );
}
