import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAllocations, useResources } from "@/lib/queries";
import { computeBench, type BenchRow } from "@/lib/bench";
import { SERVICE_LINES } from "@/lib/constants";
import { BenchBandBadge, ResourceStatusBadge } from "@/components/StatusBadge";
import { KpiCard } from "@/components/KpiCard";
import { AlertTriangle, Coffee, Download, PauseCircle, FileSpreadsheet, FileText } from "lucide-react";
import { exportToExcel, exportToPdf } from "@/lib/export";

export const Route = createFileRoute("/_authenticated/bench")({
  component: BenchPage,
});

function BenchPage() {
  const resources = useResources();
  const allocations = useAllocations();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [sl, setSl] = useState("all");
  const [band, setBand] = useState("all");
  const [q, setQ] = useState("");

  const all = resources.data ?? [];
  const active = all.filter((r) => r.status === "Active");
  const bench = useMemo(
    () => computeBench(active, allocations.data ?? [], date),
    [active, allocations.data, date],
  );

  const onLeave = all.filter((r) => r.status === "On_Leave");

  const filtered: BenchRow[] = bench
    .filter((b) => b.benchPct > 0)
    .filter((b) => sl === "all" || b.resource.service_line === sl)
    .filter((b) => {
      if (band === "all") return true;
      if (band === "zero") return b.benchPct === 100;
      if (band === "high") return b.benchPct >= 50 && b.benchPct < 100;
      if (band === "low") return b.benchPct > 0 && b.benchPct < 50;
      if (band === "over") return b.benchPct < 0;
      return true;
    })
    .filter((b) =>
      b.resource.full_name.toLowerCase().includes(q.toLowerCase()) ||
      b.resource.omni_id.toLowerCase().includes(q.toLowerCase()),
    );

  const counts = {
    zero: bench.filter((b) => b.benchPct === 100).length,
    high: bench.filter((b) => b.benchPct >= 50 && b.benchPct < 100).length,
    low: bench.filter((b) => b.benchPct > 0 && b.benchPct < 50).length,
    over: bench.filter((b) => b.benchPct < 0).length,
  };

  const BENCH_HEADERS = ["Omni ID","Name","Role","SL","Manager","Location","Total %","Bench %","Status"];
  const benchRows = () => filtered.map((b) => [
    b.resource.omni_id, b.resource.full_name, b.resource.position ?? "",
    b.resource.service_line, b.resource.manager_name ?? "", b.resource.location ?? "",
    b.totalPct, b.benchPct, b.resource.status,
  ]);

  const exportCsv = () => {
    const rows = benchRows();
    const csv = [BENCH_HEADERS, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bench-report-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportExcel = () => exportToExcel(`bench-report-${date}`, "Bench Report", BENCH_HEADERS, benchRows());
  const exportPdf = () => exportToPdf(`bench-report-${date}`, `Bench Report — ${date}`, BENCH_HEADERS, benchRows());

  return (
    <AppShell
      title="Bench Report"
      actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="size-4 mr-1.5" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel}>
            <FileSpreadsheet className="size-4 mr-1.5" /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={exportPdf}>
            <FileText className="size-4 mr-1.5" /> PDF
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <KpiCard label="Zero allocation" value={counts.zero} icon={Coffee} accent="warning" />
        <KpiCard label="Partial (50-99%)" value={counts.high} icon={Coffee} accent="info" />
        <KpiCard label="Partial (1-49%)" value={counts.low} icon={Coffee} accent="info" />
        <KpiCard label="Over-allocated" value={counts.over} icon={AlertTriangle} accent="destructive" />
        <KpiCard label="On Leave (excluded)" value={onLeave.length} icon={PauseCircle} accent="primary" />
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="space-y-1.5">
          <Label>As of</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Service Line</Label>
          <Select value={sl} onValueChange={setSl}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {SERVICE_LINES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Band</Label>
          <Select value={band} onValueChange={setBand}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All bench</SelectItem>
              <SelectItem value="zero">Zero allocation</SelectItem>
              <SelectItem value="high">Partial 50-99%</SelectItem>
              <SelectItem value="low">Partial 1-49%</SelectItem>
              <SelectItem value="over">Over-allocated</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Input
          placeholder="Search name or Omni ID…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <div className="text-sm text-muted-foreground ml-auto">{filtered.length} on bench</div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/40">
              <tr>
                <th className="text-left px-5 py-2.5 font-medium">SL</th>
                <th className="text-left px-3 py-2.5 font-medium">Resource</th>
                <th className="text-left px-3 py-2.5 font-medium">Role</th>
                <th className="text-left px-3 py-2.5 font-medium">Manager</th>
                <th className="text-left px-3 py-2.5 font-medium">Location</th>
                <th className="text-right px-3 py-2.5 font-medium">Total %</th>
                <th className="text-left px-3 py-2.5 font-medium">Bench Band</th>
                <th className="text-left px-5 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr key={b.resource.id} className="border-t hover:bg-muted/30">
                  <td className="px-5 py-3">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground uppercase tracking-wide">
                      {b.resource.service_line}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-medium">{b.resource.full_name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{b.resource.omni_id}</div>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{b.resource.position ?? "—"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{b.resource.manager_name ?? "—"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{b.resource.location ?? "—"}</td>
                  <td className="px-3 py-3 text-right tabular-nums font-medium">{b.totalPct}%</td>
                  <td className="px-3 py-3"><BenchBandBadge pct={b.benchPct} /></td>
                  <td className="px-5 py-3"><ResourceStatusBadge status={b.resource.status} /></td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">
                    Nobody on bench matching these filters. 🎯
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {onLeave.length > 0 && (
        <div className="mt-8">
          <h3 className="font-display text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-3">
            On Leave (excluded from bench)
          </h3>
          <div className="rounded-xl border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {onLeave.map((r) => (
                  <tr key={r.id} className="border-t first:border-0">
                    <td className="px-5 py-3 font-medium">{r.full_name}</td>
                    <td className="px-3 py-3 text-muted-foreground font-mono text-xs">{r.omni_id}</td>
                    <td className="px-3 py-3 text-muted-foreground">{r.service_line}</td>
                    <td className="px-3 py-3 text-muted-foreground">{r.manager_name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}
