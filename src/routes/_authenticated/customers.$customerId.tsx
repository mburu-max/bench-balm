import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { ProjectStatusBadge, AllocationTypeBadge } from "@/components/StatusBadge";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/customers/$customerId")({
  component: CustomerDetailPage,
});

function CustomerDetailPage() {
  const { customerId } = Route.useParams() as { customerId: string };

  const customer = useQuery({
    queryKey: ["customer-detail", customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("id", customerId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const projects = useQuery({
    queryKey: ["customer-projects", customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("customer_id", customerId)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const allocations = useQuery({
    queryKey: ["customer-allocations", customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("allocations")
        .select("*, projects(project_code)")
        .eq("customer_id", customerId)
        .gte("allocation_end_date", new Date().toISOString().slice(0, 10))
        .lte("allocation_start_date", new Date().toISOString().slice(0, 10))
        .order("resource_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const c = customer.data as any;

  return (
    <AppShell title={c?.customer_name ?? "Customer"}>
      <div className="flex items-center gap-3 mb-6">
        <Link to="/customers">
          <Button variant="ghost" size="sm"><ArrowLeft className="size-4 mr-1" /> Customers</Button>
        </Link>
      </div>

      {c && (
        <div className="rounded-xl border bg-card p-5 mb-6 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <Info k="Region" v={c.region ?? "—"} />
          <Info k="Vertical" v={c.vertical ?? "—"} />
          <Info k="Tier" v={c.account_tier ?? "—"} />
          <Info k="Contract" v={c.contract_type ?? "—"} />
          <Info k="Account Manager" v={c.account_manager ?? "—"} />
          <Info k="Service Lines" v={(c.service_lines ?? []).join(", ") || "—"} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Projects */}
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b">
            <h2 className="font-display text-base font-semibold">Projects</h2>
            <p className="text-xs text-muted-foreground">{projects.data?.length ?? 0} projects</p>
          </div>
          <div className="divide-y">
            {(projects.data ?? []).map((p: any) => (
              <div key={p.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-mono text-xs text-muted-foreground mr-2">{p.project_code}</span>
                  <span className="text-sm">{p.project_description}</span>
                  <div className="text-xs text-muted-foreground mt-0.5">{p.start_date} → {p.end_date}</div>
                </div>
                <ProjectStatusBadge status={p.status} />
              </div>
            ))}
            {(projects.data ?? []).length === 0 && !projects.isLoading && (
              <div className="px-5 py-8 text-center text-sm text-muted-foreground">No projects.</div>
            )}
          </div>
        </div>

        {/* Currently Allocated Resources */}
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b">
            <h2 className="font-display text-base font-semibold">Currently Allocated Resources</h2>
            <p className="text-xs text-muted-foreground">Active allocations as of today</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/40">
                <tr>
                  <th className="text-left px-5 py-2.5 font-medium">Resource</th>
                  <th className="text-left px-3 py-2.5 font-medium">Project</th>
                  <th className="text-left px-3 py-2.5 font-medium">Type</th>
                  <th className="text-right px-5 py-2.5 font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {(allocations.data ?? []).map((a: any) => (
                  <tr key={a.id} className="border-t">
                    <td className="px-5 py-3">
                      <div className="font-medium">{a.resource_name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{a.omni_id}</div>
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
                      {a.projects?.project_code ?? "—"}
                    </td>
                    <td className="px-3 py-3"><AllocationTypeBadge type={a.allocation_type} /></td>
                    <td className="px-5 py-3 text-right tabular-nums font-medium">{a.allocation_pct}%</td>
                  </tr>
                ))}
                {(allocations.data ?? []).length === 0 && !allocations.isLoading && (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                      No active allocations today.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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
