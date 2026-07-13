import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentRole } from "@/lib/useCurrentRole";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePagination, Pager } from "@/components/Pager";

export const Route = createFileRoute("/_authenticated/audit")({
  component: AuditPage,
});

function AuditPage() {
  const { data: role } = useCurrentRole();
  const allowed = !!(role?.isFinance || role?.isDeveloper);
  const [table, setTable] = useState<string>("all");
  const [q, setQ] = useState("");

  const audit = useQuery({
    queryKey: ["audit-log", table],
    enabled: allowed,
    queryFn: async () => {
      let qy = supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(500);
      if (table !== "all") qy = qy.eq("table_name", table);
      const { data, error } = await qy;
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = (audit.data ?? []).filter((r) =>
    !q ||
    r.action?.toLowerCase().includes(q.toLowerCase()) ||
    r.table_name?.toLowerCase().includes(q.toLowerCase()) ||
    r.row_id?.toLowerCase().includes(q.toLowerCase()),
  );
  const pg = usePagination(filtered, 10);

  if (role && !allowed) {
    return (
      <AppShell title="Audit Trail">
        <div className="rounded-xl border bg-card p-10 text-center text-muted-foreground">
          Access denied. Audit trail is restricted to Finance / Governance and Developers.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Audit Trail">
      <div className="flex items-center gap-3 mb-4">
        <Select value={table} onValueChange={setTable}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tables</SelectItem>
            <SelectItem value="projects">Projects</SelectItem>
            <SelectItem value="allocations">Allocations</SelectItem>
          </SelectContent>
        </Select>
        <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <div className="text-sm text-muted-foreground">{filtered.length} entries</div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/40">
              <tr>
                <th className="text-left px-5 py-2.5 font-medium">When</th>
                <th className="text-left px-3 py-2.5 font-medium">Table</th>
                <th className="text-left px-3 py-2.5 font-medium">Action</th>
                <th className="text-left px-3 py-2.5 font-medium">Row ID</th>
                <th className="text-left px-3 py-2.5 font-medium">Actor</th>
                <th className="text-left px-5 py-2.5 font-medium">Changes</th>
              </tr>
            </thead>
            <tbody>
              {pg.pageItems.map((r) => {
                const diff: string[] = [];
                if (r.action === "UPDATE" && r.old_data && r.new_data) {
                  const o = r.old_data as Record<string, unknown>;
                  const n = r.new_data as Record<string, unknown>;
                  for (const k of Object.keys(n)) {
                    if (JSON.stringify(o[k]) !== JSON.stringify(n[k])) {
                      diff.push(`${k}: ${JSON.stringify(o[k])} → ${JSON.stringify(n[k])}`);
                    }
                  }
                }
                return (
                  <tr key={r.id} className="border-t hover:bg-muted/30 align-top">
                    <td className="px-5 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-3 text-xs font-mono">{r.table_name}</td>
                    <td className="px-3 py-3">
                      <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                        r.action === "INSERT" ? "bg-success/20 text-success" :
                        r.action === "DELETE" ? "bg-destructive/20 text-destructive" :
                        "bg-secondary text-secondary-foreground"
                      }`}>{r.action}</span>
                    </td>
                    <td className="px-3 py-3 text-[11px] font-mono text-muted-foreground">{r.row_id?.slice(0, 8)}</td>
                    <td className="px-3 py-3 text-[11px] font-mono text-muted-foreground">{r.actor?.slice(0, 8) ?? "system"}</td>
                    <td className="px-5 py-3 text-xs max-w-md">
                      {r.action === "UPDATE"
                        ? <div className="space-y-0.5">{diff.slice(0, 5).map((d, i) => <div key={i} className="truncate">{d}</div>)}{diff.length > 5 && <div className="text-muted-foreground">+{diff.length - 5} more</div>}</div>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && !audit.isLoading && (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">No audit entries yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager {...pg} />
      </div>
    </AppShell>
  );
}
