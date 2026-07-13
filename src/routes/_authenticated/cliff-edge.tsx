import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KpiCard } from "@/components/KpiCard";
import { supabase } from "@/integrations/supabase/client";
import { SERVICE_LINES } from "@/lib/constants";
import { useCurrentRole } from "@/lib/useCurrentRole";
import { inSlScope, scopedServiceLines, usePmScope, inPmResources } from "@/lib/scope";
import { AlertOctagon, AlertTriangle, Clock3, Download, FileSpreadsheet, FileText } from "lucide-react";
import { exportToExcel, exportToPdf } from "@/lib/export";

export const Route = createFileRoute("/_authenticated/cliff-edge")({
  component: CliffEdgePage,
});

function bandLabel(band: number) {
  if (band === 0) return "Already on bench";
  return `≤${band} days`;
}

function bandColor(band: number) {
  if (band === 0 || band === 30) return "text-destructive font-medium";
  if (band === 60) return "text-warning-foreground font-medium";
  return "text-muted-foreground";
}

function CliffEdgePage() {
  const { data: role } = useCurrentRole();
  const pm = usePmScope();
  const [sl, setSl] = useState("all");
  const [band, setBand] = useState("all");
  const [q, setQ] = useState("");
  // Clicking a KPI card filters the table to that cliff band (toggles off if already active).
  const toggleBand = (b: string) => setBand((cur: string) => (cur === b ? "all" : b));

  const cliff = useQuery({
    queryKey: ["cliff-edge"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_cliff_edge").select("*");
      if (error) throw error;
      return data ?? [];
    },
  });

  const all = (cliff.data ?? []).filter(
    (r) => inSlScope(role, r.service_line) && inPmResources(pm, r.resource_id),
  );
  const filtered = all
    .filter((r) => sl === "all" || r.service_line === sl)
    .filter((r) => band === "all" || String(r.cliff_band) === band)
    .filter((r) =>
      (r.full_name ?? "").toLowerCase().includes(q.toLowerCase()) ||
      (r.omni_id ?? "").toLowerCase().includes(q.toLowerCase()),
    );

  const counts = {
    now: all.filter((r) => r.cliff_band === 0).length,
    d30: all.filter((r) => r.cliff_band === 30).length,
    d60: all.filter((r) => r.cliff_band === 60).length,
    d90: all.filter((r) => r.cliff_band === 90).length,
  };

  const stamp = new Date().toISOString().slice(0, 10);
  const CLIFF_HEADERS = ["Omni ID","Name","SL","Role","Manager","Ending Project","Customer","Last Covered Date","Days Until Cliff"];
  const cliffRows = () => filtered.map((r) => [
    r.omni_id, r.full_name, r.service_line, r.position ?? "", r.manager_name ?? "",
    r.ending_project_code ?? "", r.ending_customer_name ?? "", r.last_covered_date, r.days_until_cliff,
  ]);

  const exportCsv = () => {
    const csv = [CLIFF_HEADERS, ...cliffRows()].map((row) => row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cliff-edge-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const exportExcel = () => exportToExcel(`cliff-edge-${stamp}`, "Cliff Edge", CLIFF_HEADERS, cliffRows());
  const exportPdf = () => exportToPdf(`cliff-edge-${stamp}`, `Cliff Edge — ${stamp}`, CLIFF_HEADERS, cliffRows());

  return (
    <AppShell
      title="Cliff Edge"
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
      <p className="text-sm text-muted-foreground mb-6">
        Active resources whose last billable/non-billable allocation ends soon with no follow-on lined up.
        See bench risk before it happens, not after.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Already on Bench" value={counts.now} icon={AlertOctagon} accent="destructive" onClick={() => toggleBand("0")} active={band === "0"} />
        <KpiCard label="Within 30 days" value={counts.d30} icon={AlertTriangle} accent="destructive" onClick={() => toggleBand("30")} active={band === "30"} />
        <KpiCard label="Within 60 days" value={counts.d60} icon={Clock3} accent="warning" onClick={() => toggleBand("60")} active={band === "60"} />
        <KpiCard label="Within 90 days" value={counts.d90} icon={Clock3} accent="info" onClick={() => toggleBand("90")} active={band === "90"} />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Input
          placeholder="Search name or Omni ID…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <Select value={sl} onValueChange={setSl}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All service lines</SelectItem>
            {scopedServiceLines(role, SERVICE_LINES).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={band} onValueChange={setBand}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All bands</SelectItem>
            <SelectItem value="0">Already on bench</SelectItem>
            <SelectItem value="30">Within 30 days</SelectItem>
            <SelectItem value="60">Within 60 days</SelectItem>
            <SelectItem value="90">Within 90 days</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-sm text-muted-foreground ml-auto">{filtered.length} at risk</div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/40">
              <tr>
                <th className="text-left px-5 py-2.5 font-medium">Resource</th>
                <th className="text-left px-3 py-2.5 font-medium">SL</th>
                <th className="text-left px-3 py-2.5 font-medium">Role</th>
                <th className="text-left px-3 py-2.5 font-medium">Manager</th>
                <th className="text-left px-3 py-2.5 font-medium">Ending Project</th>
                <th className="text-left px-3 py-2.5 font-medium">Customer</th>
                <th className="text-left px-3 py-2.5 font-medium">Last Covered</th>
                <th className="text-right px-5 py-2.5 font-medium">Days Left</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.resource_id} className="border-t hover:bg-muted/30">
                  <td className="px-5 py-3">
                    <div className="font-medium">{r.full_name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{r.omni_id}</div>
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground uppercase tracking-wide">
                      {r.service_line}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{r.position ?? "—"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{r.manager_name ?? "—"}</td>
                  <td className="px-3 py-3 font-mono text-xs text-muted-foreground">{r.ending_project_code ?? "—"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{r.ending_customer_name ?? "—"}</td>
                  <td className="px-3 py-3 text-xs tabular-nums text-muted-foreground">{r.last_covered_date}</td>
                  <td className={`px-5 py-3 text-right tabular-nums ${bandColor(r.cliff_band ?? 90)}`}>
                    {(r.days_until_cliff ?? 0) <= 0 ? "Now" : `${r.days_until_cliff}d`}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && !cliff.isLoading && (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">
                    No cliff-edge risk in the next 90 days. 🎯
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
