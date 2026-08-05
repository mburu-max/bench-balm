import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KpiCard } from "@/components/KpiCard";
import { DateRangePicker, overlapsRange, type DateRange } from "@/components/DateRangePicker";
import { usePagination, Pager } from "@/components/Pager";
import { useAllocations } from "@/lib/queries";
import { leaveDurationDays, isExtendedLeave } from "@/lib/leave";
import { SERVICE_LINES } from "@/lib/constants";
import { useCurrentRole } from "@/lib/useCurrentRole";
import { inSlScope, scopedServiceLines, usePmScope, inPmResources } from "@/lib/scope";
import { exportToExcel, exportToPdf } from "@/lib/export";
import { CalendarClock, PauseCircle, Coffee, CalendarDays, Download, FileSpreadsheet, FileText } from "lucide-react";

export const Route = createFileRoute("/_authenticated/leave")({
  component: LeaveReportPage,
});

const isoShift = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const todayStr = () => new Date().toISOString().slice(0, 10);
const fmt = (d: string) => new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

type Phase = "current" | "upcoming" | "past";

function LeaveReportPage() {
  const allocations = useAllocations();
  const { data: role } = useCurrentRole();
  const pm = usePmScope();
  // Default window: recent history through the next quarter — covers current + upcoming + just-ended.
  const [range, setRange] = useState<DateRange>(() => ({ from: isoShift(-30), to: isoShift(90) }));
  const [sl, setSl] = useState("all");
  const [kind, setKind] = useState<string>("all"); // all | short | extended | current | upcoming | past
  const [q, setQ] = useState("");
  const toggleKind = (k: string) => setKind((cur) => (cur === k ? "all" : k));

  const td = todayStr();
  const phaseOf = (a: { allocation_start_date: string; allocation_end_date: string }): Phase =>
    a.allocation_start_date > td ? "upcoming" : a.allocation_end_date < td ? "past" : "current";

  // Leave rows the viewer may see, whose dates OVERLAP the selected range.
  const all = (allocations.data ?? [])
    .filter((a) => a.allocation_type === "Leave")
    .filter((a) => inSlScope(role, a.service_line) && inPmResources(pm, a.resource_id))
    .filter((a) => overlapsRange(a.allocation_start_date, a.allocation_end_date, range));

  const filtered = all
    .filter((a) => sl === "all" || a.service_line === sl)
    .filter((a) => {
      if (kind === "all") return true;
      if (kind === "short") return !isExtendedLeave(a);
      if (kind === "extended") return isExtendedLeave(a);
      return phaseOf(a) === kind;
    })
    .filter(
      (a) =>
        (a.resource_name ?? "").toLowerCase().includes(q.toLowerCase()) ||
        (a.omni_id ?? "").toLowerCase().includes(q.toLowerCase()),
    )
    .sort((a, b) => (a.allocation_start_date < b.allocation_start_date ? -1 : 1));
  const pg = usePagination(filtered, 10);

  const counts = {
    current: all.filter((a) => phaseOf(a) === "current").length,
    upcoming: all.filter((a) => phaseOf(a) === "upcoming").length,
    extended: all.filter((a) => isExtendedLeave(a)).length,
    total: all.length,
  };

  const stamp = todayStr();
  const HEADERS = ["Omni ID", "Name", "SL", "Manager", "Start", "End", "Days", "Type", "Phase", "Reason"];
  const rows = () =>
    filtered.map((a) => [
      a.omni_id,
      a.resource_name,
      a.service_line,
      a.manager ?? "",
      a.allocation_start_date,
      a.allocation_end_date,
      leaveDurationDays(a.allocation_start_date, a.allocation_end_date),
      isExtendedLeave(a) ? "Extended" : "Short",
      phaseOf(a),
      a.remarks ?? "",
    ]);
  const exportCsv = () => {
    const csv = [HEADERS, ...rows()]
      .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `leave-report-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const exportExcel = () => exportToExcel(`leave-report-${stamp}`, "Leave Report", HEADERS, rows());
  const exportPdf = () => exportToPdf(`leave-report-${stamp}`, `Leave Report — ${stamp}`, HEADERS, rows());

  const phaseBadge = (p: Phase) => {
    const map: Record<Phase, string> = {
      current: "bg-primary/15 text-primary",
      upcoming: "bg-warning/20 text-warning-foreground",
      past: "bg-muted text-muted-foreground",
    };
    return <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide ${map[p]}`}>{p}</span>;
  };

  return (
    <AppShell
      title="Leave Report"
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
        Every leave that overlaps the selected date range — currently out, upcoming, and recently
        returned. <span className="font-medium text-warning-foreground">Extended</span> = more than 5 days.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Currently on Leave" value={counts.current} icon={PauseCircle} accent="primary" onClick={() => toggleKind("current")} active={kind === "current"} />
        <KpiCard label="Upcoming" value={counts.upcoming} icon={CalendarClock} accent="warning" onClick={() => toggleKind("upcoming")} active={kind === "upcoming"} />
        <KpiCard label="Extended (>5d)" value={counts.extended} icon={Coffee} accent="info" onClick={() => toggleKind("extended")} active={kind === "extended"} />
        <KpiCard label="Total in range" value={counts.total} icon={CalendarDays} />
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <DateRangePicker value={range} onChange={setRange} />
        <div className="space-y-1.5">
          <Label className="text-xs">Service Line</Label>
          <Select value={sl} onValueChange={setSl}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {scopedServiceLines(role, SERVICE_LINES).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Type</Label>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="current">Currently out</SelectItem>
              <SelectItem value="upcoming">Upcoming</SelectItem>
              <SelectItem value="past">Recently ended</SelectItem>
              <SelectItem value="short">Short (≤5d)</SelectItem>
              <SelectItem value="extended">Extended (&gt;5d)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Input placeholder="Search name or Omni ID…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <div className="text-sm text-muted-foreground ml-auto">{filtered.length} leave records</div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/40">
              <tr>
                <th className="text-left px-5 py-2.5 font-medium">Resource</th>
                <th className="text-left px-3 py-2.5 font-medium">SL</th>
                <th className="text-left px-3 py-2.5 font-medium">Manager</th>
                <th className="text-left px-3 py-2.5 font-medium">Dates</th>
                <th className="text-right px-3 py-2.5 font-medium">Days</th>
                <th className="text-left px-3 py-2.5 font-medium">Phase</th>
                <th className="text-left px-5 py-2.5 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {pg.pageItems.map((a) => {
                const days = leaveDurationDays(a.allocation_start_date, a.allocation_end_date);
                const ext = isExtendedLeave(a);
                return (
                  <tr key={a.id} className="border-t hover:bg-muted/30">
                    <td className="px-5 py-3">
                      <div className="font-medium">{a.resource_name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{a.omni_id}</div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground uppercase tracking-wide">
                        {a.service_line}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{a.manager ?? "—"}</td>
                    <td className="px-3 py-3 text-muted-foreground whitespace-nowrap">
                      {fmt(a.allocation_start_date)} – {fmt(a.allocation_end_date)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
                      {days}d
                      {ext && (
                        <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-warning/20 text-warning-foreground font-medium uppercase tracking-wide">
                          Ext
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">{phaseBadge(phaseOf(a))}</td>
                    <td className="px-5 py-3 text-muted-foreground max-w-xs truncate">{a.remarks ?? "—"}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && !allocations.isLoading && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-muted-foreground">
                    No leave in this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager {...pg} />
      </div>
    </AppShell>
  );
}
