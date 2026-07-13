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
import { Combobox, type ComboOption } from "@/components/Combobox";
import { useAllocationReport } from "@/lib/queries";
import { SERVICE_LINES, ALLOCATION_TYPE_LABEL, type AllocationType } from "@/lib/constants";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { exportToExcel, exportToPdf } from "@/lib/export";

export const Route = createFileRoute("/_authenticated/allocation-report")({
  component: AllocationReportPage,
});

// An allocation counts on a given date if that date falls inside its window (open-ended if a
// bound is missing).
function overlaps(start: string, end: string, date: string): boolean {
  return (!start || start <= date) && (!end || end >= date);
}

type Row = {
  id: string;
  serviceLine: string;
  name: string;
  omniId: string;
  customer: string;
  projectCode: string;
  pct: number;
  type: string;
  start: string;
  end: string;
  hubspot: string;
};

function AllocationReportPage() {
  const report = useAllocationReport();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [sl, setSl] = useState("all");
  const [customer, setCustomer] = useState("all");
  const [project, setProject] = useState("all");
  const [q, setQ] = useState("");

  // Flatten to project allocations only — drop leave and any orphan rows without a project.
  const base: Row[] = useMemo(
    () =>
      (report.data ?? [])
        .filter((a) => a.projects && a.allocation_type !== "Leave")
        .map((a) => ({
          id: a.id,
          serviceLine: a.projects?.service_line ?? "—",
          name: a.resources?.full_name ?? "—",
          omniId: a.resources?.omni_id ?? a.omni_id ?? "",
          customer: a.customers?.customer_name ?? "—",
          projectCode: a.projects?.project_code ?? "—",
          pct: a.allocation_pct ?? 0,
          type:
            ALLOCATION_TYPE_LABEL[a.allocation_type as AllocationType] ??
            a.allocation_type ??
            "—",
          start: a.allocation_start_date ?? "",
          end: a.allocation_end_date ?? "",
          hubspot: a.projects?.hubspot_deal_id ?? "",
        })),
    [report.data],
  );

  const customerOptions: ComboOption[] = useMemo(() => {
    const set = Array.from(new Set(base.map((r) => r.customer))).sort();
    return [{ value: "all", label: "All customers" }, ...set.map((c) => ({ value: c, label: c }))];
  }, [base]);

  // Project options follow the selected customer — pick a customer, only its projects show.
  const projectOptions: ComboOption[] = useMemo(() => {
    const rows = customer === "all" ? base : base.filter((r) => r.customer === customer);
    const set = Array.from(new Set(rows.map((r) => r.projectCode))).sort();
    return [{ value: "all", label: "All projects" }, ...set.map((c) => ({ value: c, label: c }))];
  }, [base, customer]);

  const filtered = useMemo(
    () =>
      base
        .filter((r) => overlaps(r.start, r.end, date))
        .filter((r) => sl === "all" || r.serviceLine === sl)
        .filter((r) => customer === "all" || r.customer === customer)
        .filter((r) => project === "all" || r.projectCode === project)
        .filter((r) => {
          const t = q.trim().toLowerCase();
          if (!t) return true;
          return (
            r.name.toLowerCase().includes(t) ||
            r.omniId.toLowerCase().includes(t) ||
            r.projectCode.toLowerCase().includes(t) ||
            r.customer.toLowerCase().includes(t)
          );
        }),
    [base, date, sl, customer, project, q],
  );

  const HEADERS = [
    "Service Line",
    "Omni ID",
    "Resource",
    "Customer",
    "Project Code",
    "Allocation %",
    "Type",
    "Start",
    "End",
    "HubSpot ID",
  ];
  const exportRows = () =>
    filtered.map((r) => [
      r.serviceLine,
      r.omniId,
      r.name,
      r.customer,
      r.projectCode,
      r.pct,
      r.type,
      r.start,
      r.end,
      r.hubspot,
    ]);

  const exportCsv = () => {
    const csv = [HEADERS, ...exportRows()]
      .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `allocation-report-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const exportExcel = () =>
    exportToExcel(`allocation-report-${date}`, "Allocation Report", HEADERS, exportRows());
  const exportPdf = () =>
    exportToPdf(`allocation-report-${date}`, `Allocation Report — ${date}`, HEADERS, exportRows());

  return (
    <AppShell
      title="Allocation Report"
      actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="size-4 mr-1.5" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={filtered.length === 0}>
            <FileSpreadsheet className="size-4 mr-1.5" /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={exportPdf} disabled={filtered.length === 0}>
            <FileText className="size-4 mr-1.5" /> PDF
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="space-y-1.5">
          <Label>As of</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto" />
        </div>
        <div className="space-y-1.5">
          <Label>Service Line</Label>
          <Select value={sl} onValueChange={setSl}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All service lines</SelectItem>
              {SERVICE_LINES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="block">Customer</Label>
          <Combobox
            value={customer}
            onChange={(v) => { setCustomer(v); setProject("all"); }}
            options={customerOptions}
            className="w-56"
            placeholder="All customers"
            searchPlaceholder="Search customer…"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="block">Project</Label>
          <Combobox
            value={project}
            onChange={setProject}
            options={projectOptions}
            className="w-48"
            placeholder="All projects"
            searchPlaceholder="Search project code…"
          />
        </div>
        <Input
          placeholder="Search name, Omni ID, code…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <div className="text-sm text-muted-foreground ml-auto">
          {filtered.length} allocation{filtered.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/40">
              <tr>
                <th className="text-left px-5 py-2.5 font-medium">SL</th>
                <th className="text-left px-3 py-2.5 font-medium">Resource</th>
                <th className="text-left px-3 py-2.5 font-medium">Customer</th>
                <th className="text-left px-3 py-2.5 font-medium">Project Code</th>
                <th className="text-right px-3 py-2.5 font-medium whitespace-nowrap">Allocation %</th>
                <th className="text-left px-3 py-2.5 font-medium">Type</th>
                <th className="text-left px-3 py-2.5 font-medium whitespace-nowrap">Window</th>
                <th className="text-left px-5 py-2.5 font-medium">HubSpot ID</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="px-5 py-3">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground uppercase tracking-wide">
                      {r.serviceLine}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{r.omniId}</div>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{r.customer}</td>
                  <td className="px-3 py-3 font-mono text-xs">{r.projectCode}</td>
                  <td className="px-3 py-3 text-right tabular-nums font-medium">{r.pct}%</td>
                  <td className="px-3 py-3 text-muted-foreground">{r.type}</td>
                  <td className="px-3 py-3 text-muted-foreground whitespace-nowrap text-xs">
                    {r.start || "—"} → {r.end || "—"}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{r.hubspot || "—"}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">
                    {report.isLoading ? "Loading…" : "No allocations match these filters."}
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
