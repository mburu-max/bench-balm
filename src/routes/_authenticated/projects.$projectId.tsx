import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { ProjectStatusBadge, AllocationTypeBadge } from "@/components/StatusBadge";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  component: ProjectDetailPage,
});

function ProjectDetailPage() {
  const { projectId } = Route.useParams() as { projectId: string };
  const today = new Date().toISOString().slice(0, 10);

  const project = useQuery({
    queryKey: ["project-detail", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*, customers(customer_name)")
        .eq("id", projectId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const allocations = useQuery({
    queryKey: ["project-detail-allocations", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("allocations")
        .select("*")
        .eq("project_id", projectId)
        .order("resource_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const p = project.data as any;
  const rows = allocations.data ?? [];
  const current = rows.filter((a: any) => a.allocation_start_date <= today && a.allocation_end_date >= today);

  return (
    <AppShell title={p?.project_code ?? "Project"}>
      <div className="flex items-center gap-3 mb-6">
        <Link to="/projects">
          <Button variant="ghost" size="sm"><ArrowLeft className="size-4 mr-1" /> Projects</Button>
        </Link>
      </div>

      {p && (
        <div className="rounded-xl border bg-card p-5 mb-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-display text-lg font-semibold">{p.project_description}</div>
              <div className="text-sm text-muted-foreground font-mono mt-0.5">{p.project_code}</div>
            </div>
            <ProjectStatusBadge status={p.status} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mt-5 border-t pt-5">
            <Info k="Customer" v={p.customers?.customer_name ?? "—"} />
            <Info k="Service Line" v={p.service_line} />
            <Info k="Dates" v={`${p.start_date} → ${p.end_date}`} />
            <Info k="Delivery Center" v={p.delivery_center ?? "—"} />
          </div>
        </div>
      )}

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b">
          <h2 className="font-display text-base font-semibold">Resources on this project</h2>
          <p className="text-xs text-muted-foreground">{current.length} allocated today · {rows.length} total (incl. past/future)</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/40">
              <tr>
                <th className="text-left px-5 py-2.5 font-medium">Resource</th>
                <th className="text-left px-3 py-2.5 font-medium">Role</th>
                <th className="text-left px-3 py-2.5 font-medium">Type</th>
                <th className="text-left px-3 py-2.5 font-medium">Dates</th>
                <th className="text-right px-5 py-2.5 font-medium">%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a: any) => {
                const isCurrent = a.allocation_start_date <= today && a.allocation_end_date >= today;
                return (
                  <tr key={a.id} className={`border-t ${isCurrent ? "" : "opacity-50"}`}>
                    <td className="px-5 py-3">
                      <div className="font-medium">{a.resource_name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{a.omni_id}</div>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{a.role ?? "—"}</td>
                    <td className="px-3 py-3"><AllocationTypeBadge type={a.allocation_type} /></td>
                    <td className="px-3 py-3 text-xs tabular-nums text-muted-foreground">
                      {a.allocation_start_date} → {a.allocation_end_date}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums font-medium">{a.allocation_pct}%</td>
                  </tr>
                );
              })}
              {rows.length === 0 && !allocations.isLoading && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                    No resources allocated to this project.
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

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{k}</div>
      <div className="font-medium mt-0.5">{v}</div>
    </div>
  );
}
