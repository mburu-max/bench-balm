import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Save, Trash2 } from "lucide-react";
import {
  useAllocations,
  useCustomers,
  useProjects,
  type ResourceRow,
} from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ALLOCATION_TYPES,
  ALLOCATION_TYPE_LABEL,
  type AllocationType,
  ALLOCATION_MODELS,
  ALLOCATION_MODEL_LABEL,
  type AllocationModel,
} from "@/lib/constants";
import { AllocationTypeBadge } from "@/components/StatusBadge";

export const Route = createFileRoute("/_authenticated/project-allocations")({
  component: ProjectAllocationsPage,
});

type Row = {
  key: string;
  resource_id: string;
  allocation_type: AllocationType;
  allocation_model: AllocationModel | "";
  start: string;
  end: string;
  pct: number;
  remarks: string;
};

const blankRow = (): Row => ({
  key: crypto.randomUUID(),
  resource_id: "",
  allocation_type: "Billable",
  allocation_model: "",
  start: "",
  end: "",
  pct: 100,
  remarks: "",
});

function ProjectAllocationsPage() {
  const customers = useCustomers();
  const projects = useProjects();
  // Allocatable pool (lets a PM staff from the bench in their projects' service lines).
  const resources = useQuery({
    queryKey: ["allocatable-resources"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("allocatable_resources");
      if (error) throw error;
      return (data ?? []) as ResourceRow[];
    },
  });
  const allocations = useAllocations();
  const qc = useQueryClient();

  const [customerId, setCustomerId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [saving, setSaving] = useState<string | null>(null);

  const project = useMemo(
    () => (projects.data ?? []).find((p) => p.id === projectId),
    [projects.data, projectId],
  );
  const filteredProjects = useMemo(
    () => (projects.data ?? []).filter((p) => p.status === "Active" && (!customerId || p.customer_id === customerId)),
    [projects.data, customerId],
  );

  const teamAllocations = useMemo(
    () => (allocations.data ?? []).filter((a) => a.project_id === projectId),
    [allocations.data, projectId],
  );

  const setRow = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const addRow = () => setRows((rs) => [...rs, blankRow()]);
  const removeRow = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key));

  const saveRow = async (row: Row) => {
    if (!project) return toast.error("Pick a project first");
    if (!row.resource_id) return toast.error("Pick a resource");
    if (!row.allocation_model) return toast.error("Pick an allocation model");
    if (!row.start || !row.end) return toast.error("Dates required");
    const resource = (resources.data ?? []).find((r) => r.id === row.resource_id);
    if (!resource) return;
    setSaving(row.key);
    const { data: userData } = await supabase.auth.getUser();
    const payload = {
      resource_id: resource.id,
      project_id: project.id,
      customer_id: project.customer_id,
      service_line: project.service_line as any,
      omni_id: resource.omni_id,
      resource_name: resource.full_name,
      role: resource.position,
      manager: resource.manager_name,
      location: resource.location,
      employment_type: resource.employment_type,
      resource_status: resource.status,
      allocation_type: row.allocation_type,
      allocation_model: row.allocation_model || null,
      allocation_start_date: row.start,
      allocation_end_date: row.end,
      allocation_pct: row.pct,
      remarks: row.remarks || null,
      created_by: userData.user?.id ?? null,
    };
    const { error } = await supabase.from("allocations").insert(payload);
    setSaving(null);
    if (error) return toast.error(error.message);
    toast.success(`Saved ${resource.full_name}`);
    setRows((rs) => rs.map((r) => (r.key === row.key ? blankRow() : r)));
    qc.invalidateQueries({ queryKey: ["allocations"] });
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this allocation?")) return;
    const { error } = await supabase.from("allocations").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Allocation deleted");
    qc.invalidateQueries({ queryKey: ["allocations"] });
  };

  return (
    <AppShell title="Project Allocation">
      <div className="rounded-xl border bg-card p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Customer</Label>
            <Select value={customerId} onValueChange={(v) => { setCustomerId(v); setProjectId(""); }}>
              <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
              <SelectContent>
                {(customers.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.customer_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Project</Label>
            <Select value={projectId} onValueChange={setProjectId} disabled={!customerId}>
              <SelectTrigger>
                <SelectValue placeholder={customerId ? "Select project" : "Pick customer first"} />
              </SelectTrigger>
              <SelectContent>
                {filteredProjects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="font-mono text-xs mr-2">{p.project_code}</span>
                    {p.project_description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {project && (
          <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm border-t pt-5">
            <Info k="Service Line" v={project.service_line} />
            <Info k="Project Dates" v={`${project.start_date} → ${project.end_date}`} />
            <Info k="Delivery Center" v={project.delivery_center ?? "—"} />
            <Info k="Status" v={project.status.replace("_", " ")} />
          </div>
        )}
      </div>

      {project && (
        <>
          <div className="mt-6 rounded-xl border bg-card overflow-hidden">
            <div className="p-5 border-b flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-semibold">Add resources to this project</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Each row saves independently. Dates must fall inside project window.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={addRow}>
                <Plus className="size-4 mr-1.5" /> Add row
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/40">
                  <tr>
                    <th className="text-left px-3 py-2.5 font-medium min-w-[200px]">Resource</th>
                    <th className="text-left px-3 py-2.5 font-medium">Cost / Opex</th>
                    <th className="text-left px-3 py-2.5 font-medium min-w-[150px]">Model</th>
                    <th className="text-left px-3 py-2.5 font-medium">Start</th>
                    <th className="text-left px-3 py-2.5 font-medium">End</th>
                    <th className="text-left px-3 py-2.5 font-medium w-20">%</th>
                    <th className="text-left px-3 py-2.5 font-medium">Remarks</th>
                    <th className="px-3 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key} className="border-t">
                      <td className="px-3 py-2">
                        <Select value={row.resource_id} onValueChange={(v) => setRow(row.key, { resource_id: v })}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="Pick…" /></SelectTrigger>
                          <SelectContent>
                            {(resources.data ?? []).filter((r) => r.status === "Active").map((r) => (
                              <SelectItem key={r.id} value={r.id}>
                                <span className="font-mono text-xs mr-2">{r.omni_id}</span>{r.full_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2">
                        <Select value={row.allocation_type} onValueChange={(v) => setRow(row.key, { allocation_type: v as AllocationType })}>
                          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ALLOCATION_TYPES.filter((t) => t !== "Leave").map((t) => (
                              <SelectItem key={t} value={t}>{ALLOCATION_TYPE_LABEL[t]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2">
                        <Select value={row.allocation_model} onValueChange={(v) => setRow(row.key, { allocation_model: v as AllocationModel })}>
                          <SelectTrigger className="h-9"><SelectValue placeholder="Model" /></SelectTrigger>
                          <SelectContent>
                            {ALLOCATION_MODELS.map((m) => (
                              <SelectItem key={m} value={m}>{ALLOCATION_MODEL_LABEL[m]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2">
                        <Input type="date" className="h-9" value={row.start} onChange={(e) => setRow(row.key, { start: e.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <Input type="date" className="h-9" value={row.end} onChange={(e) => setRow(row.key, { end: e.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <Input type="number" min={1} max={100} className="h-9" value={row.pct} onChange={(e) => setRow(row.key, { pct: parseInt(e.target.value || "0") })} />
                      </td>
                      <td className="px-3 py-2">
                        <Input className="h-9" value={row.remarks} onChange={(e) => setRow(row.key, { remarks: e.target.value })} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right">
                        <Button size="sm" onClick={() => saveRow(row)} disabled={saving === row.key}>
                          <Save className="size-3.5 mr-1" /> Save
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => removeRow(row.key)}>
                          <Trash2 className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-6 rounded-xl border bg-card overflow-hidden">
            <div className="p-5 border-b">
              <h2 className="font-display text-base font-semibold">Team on this project</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{teamAllocations.length} allocation rows</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/40">
                  <tr>
                    <th className="text-left px-5 py-2.5 font-medium">Resource</th>
                    <th className="text-left px-3 py-2.5 font-medium">Role</th>
                    <th className="text-left px-3 py-2.5 font-medium">Cost / Opex</th>
                    <th className="text-left px-3 py-2.5 font-medium">Model</th>
                    <th className="text-left px-3 py-2.5 font-medium">Dates</th>
                    <th className="text-right px-3 py-2.5 font-medium">%</th>
                    <th className="px-5 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {teamAllocations.map((a: any) => (
                    <tr key={a.id} className="border-t">
                      <td className="px-5 py-3">
                        <div className="font-medium">{a.resource_name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{a.omni_id}</div>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{a.role ?? "—"}</td>
                      <td className="px-3 py-3"><AllocationTypeBadge type={a.allocation_type} /></td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        {a.allocation_model ? ALLOCATION_MODEL_LABEL[a.allocation_model as AllocationModel] : "—"}
                      </td>
                      <td className="px-3 py-3 text-xs tabular-nums text-muted-foreground">
                        {a.allocation_start_date} → {a.allocation_end_date}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums font-medium">{a.allocation_pct}%</td>
                      <td className="px-5 py-3 text-right">
                        <Button variant="ghost" size="icon" onClick={() => remove(a.id)}>
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {teamAllocations.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-5 py-10 text-center text-muted-foreground">
                        No team members allocated yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
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
