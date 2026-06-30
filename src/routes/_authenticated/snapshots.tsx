import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentRole } from "@/lib/useCurrentRole";
import { useState } from "react";
import { toast } from "sonner";
import { Camera, Download, FileSpreadsheet, FileText } from "lucide-react";
import { exportToExcel, exportToPdf } from "@/lib/export";

export const Route = createFileRoute("/_authenticated/snapshots")({
  component: SnapshotsPage,
});

function toCSV(rows: any[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

function SnapshotsPage() {
  const { data: role } = useCurrentRole();
  const qc = useQueryClient();
  const canTake = !!(role?.isFinance || role?.isDeveloper);
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const dates = useQuery({
    queryKey: ["snapshot-dates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("allocation_snapshots")
        .select("snapshot_date")
        .order("snapshot_date", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const uniq = Array.from(new Set((data ?? []).map((d) => d.snapshot_date)));
      return uniq;
    },
  });

  const rows = useQuery({
    queryKey: ["snapshot-rows", date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("allocation_snapshots")
        .select("*")
        .eq("snapshot_date", date)
        .order("service_line")
        .order("resource_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const takeSnapshot = async () => {
    const { data, error } = await supabase.rpc("take_allocation_snapshot", { _d: date });
    if (error) return toast.error(error.message);
    toast.success(`Snapshot saved: ${data} allocations on ${date}`);
    qc.invalidateQueries({ queryKey: ["snapshot-dates"] });
    qc.invalidateQueries({ queryKey: ["snapshot-rows"] });
  };

  const SNAP_HEADERS = ["resource_name","omni_id","role","service_line","project_code","customer_name","allocation_type","allocation_pct","allocation_start_date","allocation_end_date","manager"];

  const snapRows = () => (rows.data ?? []).map((r) =>
    SNAP_HEADERS.map((h) => (r as any)[h] ?? "")
  );

  const download = () => {
    const csv = toCSV(rows.data ?? []);
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `allocation-snapshot-${date}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const downloadExcel = () => exportToExcel(`allocation-snapshot-${date}`, `Snapshot ${date}`, SNAP_HEADERS, snapRows());
  const downloadPdf = () => exportToPdf(`allocation-snapshot-${date}`, `Allocation Snapshot — ${date}`, SNAP_HEADERS, snapRows());

  return (
    <AppShell
      title="Allocation Snapshots"
      actions={
        <div className="flex items-center gap-2">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
          {canTake && (
            <Button onClick={takeSnapshot}><Camera className="size-4 mr-1.5" /> Take snapshot</Button>
          )}
          <Button variant="outline" size="sm" onClick={download} disabled={!rows.data?.length}>
            <Download className="size-4 mr-1.5" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={downloadExcel} disabled={!rows.data?.length}>
            <FileSpreadsheet className="size-4 mr-1.5" /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={downloadPdf} disabled={!rows.data?.length}>
            <FileText className="size-4 mr-1.5" /> PDF
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border bg-card p-4">
          <h3 className="text-sm font-semibold mb-3">Archive</h3>
          <div className="space-y-1 max-h-[500px] overflow-y-auto">
            {(dates.data ?? []).map((d) => (
              <button
                key={d}
                onClick={() => setDate(d)}
                className={`block w-full text-left px-3 py-1.5 rounded text-sm tabular-nums ${
                  d === date ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                }`}
              >
                {d}
              </button>
            ))}
            {!dates.data?.length && (
              <p className="text-xs text-muted-foreground">
                No snapshots yet. {canTake && "Click \"Take snapshot\" to archive today's allocations."}
              </p>
            )}
          </div>
        </div>

        <div className="lg:col-span-3 rounded-xl border bg-card overflow-hidden">
          <div className="p-4 border-b">
            <h3 className="text-sm font-semibold">Snapshot for {date}</h3>
            <p className="text-xs text-muted-foreground">{rows.data?.length ?? 0} allocations active that day</p>
          </div>
          <div className="overflow-x-auto max-h-[600px]">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/40 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Resource</th>
                  <th className="text-left px-3 py-2.5 font-medium">Omni</th>
                  <th className="text-left px-3 py-2.5 font-medium">Role</th>
                  <th className="text-left px-3 py-2.5 font-medium">SL</th>
                  <th className="text-left px-3 py-2.5 font-medium">Project</th>
                  <th className="text-left px-3 py-2.5 font-medium">Customer</th>
                  <th className="text-left px-3 py-2.5 font-medium">Type</th>
                  <th className="text-right px-4 py-2.5 font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {(rows.data ?? []).map((r) => (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-2">{r.resource_name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.omni_id}</td>
                    <td className="px-3 py-2 text-xs">{r.role}</td>
                    <td className="px-3 py-2 text-xs">{r.service_line}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.project_code ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{r.customer_name ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{r.allocation_type}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.allocation_pct}%</td>
                  </tr>
                ))}
                {!rows.data?.length && (
                  <tr><td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">No data for this date.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
