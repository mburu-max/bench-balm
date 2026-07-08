import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Trash2 } from "lucide-react";
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
import { useCurrentRole } from "@/lib/useCurrentRole";
import { isExtendedLeave } from "@/lib/leave";

export const Route = createFileRoute("/_authenticated/allocations")({
  component: AllocationsPage,
});

function AllocationsPage() {
  // The allocation picker draws from the "allocatable pool" (a PM can staff from the bench
  // in their projects' service lines) rather than the strict, dashboard-scoped resource read.
  const resources = useQuery({
    queryKey: ["allocatable-resources"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("allocatable_resources");
      if (error) throw error;
      return (data ?? []) as ResourceRow[];
    },
  });
  const customers = useCustomers();
  const projects = useProjects();
  const allocations = useAllocations();
  const qc = useQueryClient();
  const { data: role } = useCurrentRole();
  // Editors: developer, governance lead, PM (own projects), SL/Delivery lead. Finance is read-only.
  const canEdit = !!(role?.isDeveloper || role?.isGovernanceLead || role?.isPm || role?.isSlLead);
  const isReadOnly = !canEdit;
  const canEditProject = (p: any) =>
    !!(role?.isDeveloper || role?.isGovernanceLead || role?.isSlLead || (role?.isPm && p?.project_manager_user_id === role.userId));

  const [resourceId, setResourceId] = useState<string>("");
  const [customerId, setCustomerId] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [allocationType, setAllocationType] = useState<AllocationType>("Billable");
  const [allocationModel, setAllocationModel] = useState<AllocationModel | "">("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [pct, setPct] = useState<number>(100);
  const [remarks, setRemarks] = useState("");
  const [capOverride, setCapOverride] = useState(false);
  const [capOverrideReason, setCapOverrideReason] = useState("");
  const [dateOverrideReason, setDateOverrideReason] = useState("");
  const [saving, setSaving] = useState(false);

  const resource = useMemo(
    () => (resources.data ?? []).find((r) => r.id === resourceId),
    [resources.data, resourceId],
  );

  const filteredProjects = useMemo(() => {
    return (projects.data ?? []).filter(
      (p) =>
        p.status === "Active" &&
        (!customerId || p.customer_id === customerId) &&
        // PMs can only allocate to their own projects; governance/SL-lead/dev see all active
        (role?.isDeveloper || role?.isGovernanceLead || role?.isSlLead || (role?.isPm && (p as any).project_manager_user_id === role.userId)),
    );
  }, [projects.data, customerId, role]);

  const myAllocations = useMemo(
    () => (allocations.data ?? []).filter((a) => a.resource_id === resourceId),
    [allocations.data, resourceId],
  );

  // running total across new dates (peak day)
  const peakTotal = useMemo(() => {
    if (!start || !end || !resourceId) return 0;
    const days: Record<string, number> = {};
    const s = new Date(start);
    const e = new Date(end);
    if (e < s) return 0;
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      const k = d.toISOString().slice(0, 10);
      days[k] = 0;
    }
    for (const a of myAllocations) {
      if (a.allocation_type === "Leave") continue;
      for (const k of Object.keys(days)) {
        if (a.allocation_start_date <= k && a.allocation_end_date >= k) {
          days[k] += a.allocation_pct;
        }
      }
    }
    return Math.max(0, ...Object.values(days));
  }, [start, end, myAllocations, resourceId]);

  const projectionAfter = peakTotal + (pct || 0);
  const over = projectionAfter > 100;

  const reset = () => {
    setCustomerId("");
    setProjectId("");
    setAllocationType("Billable");
    setAllocationModel("");
    setStart("");
    setEnd("");
    setPct(100);
    setRemarks("");
    setCapOverride(false);
    setCapOverrideReason("");
    setDateOverrideReason("");
  };

  const save = async () => {
    if (!resource) return toast.error("Pick a resource");
    if (allocationType !== "Leave" && !projectId) return toast.error("Pick a project");
    if (allocationType !== "Leave" && !allocationModel) return toast.error("Pick an allocation model");
    if (!start || !end) return toast.error("Dates required");
    if (pct < 1 || pct > 100) return toast.error("Percentage must be 1-100");
    setSaving(true);
    const proj = filteredProjects.find((p) => p.id === projectId);
    const { data: userData } = await supabase.auth.getUser();
    const payload = {
      resource_id: resource.id,
      project_id: allocationType === "Leave" ? null : projectId,
      customer_id: allocationType === "Leave" ? null : customerId || proj?.customer_id || null,
      service_line: (proj?.service_line ?? resource.service_line) as any,
      omni_id: resource.omni_id,
      resource_name: resource.full_name,
      role: resource.position,
      manager: resource.manager_name,
      location: resource.location,
      employment_type: resource.employment_type,
      resource_status: resource.status,
      allocation_type: allocationType,
      allocation_model: allocationType === "Leave" ? null : (allocationModel || null),
      allocation_start_date: start,
      allocation_end_date: end,
      allocation_pct: pct,
      remarks: remarks || null,
      created_by: userData.user?.id ?? null,
      cap_override: capOverride || false,
      cap_override_reason: capOverride ? capOverrideReason || null : null,
      date_override_reason: dateOverrideReason || null,
    } as any;
    const { error } = await supabase.from("allocations").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Allocation saved");
    reset();
    qc.invalidateQueries({ queryKey: ["allocations"] });
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this allocation?")) return;
    const { error } = await supabase.from("allocations").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Allocation deleted");
    qc.invalidateQueries({ queryKey: ["allocations"] });
  };

  const isLeave = allocationType === "Leave";

  return (
    <AppShell title="Resource Allocation">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT — pick resource + show profile */}
        <div className="space-y-4">
          <div className="rounded-xl border bg-card p-5">
            <Label>Resource</Label>
            <Select value={resourceId} onValueChange={setResourceId}>
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder="Search and select a resource" />
              </SelectTrigger>
              <SelectContent>
                {(resources.data ?? [])
                  .filter((r) => r.status === "Active")
                  .map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      <span className="font-mono text-xs mr-2">{r.omni_id}</span>
                      {r.full_name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>

            {resource && (
              <div className="mt-5 space-y-2.5 text-sm">
                <Row k="Role" v={resource.position ?? "—"} />
                <Row k="Manager" v={resource.manager_name ?? "—"} />
                <Row k="Location" v={resource.location ?? "—"} />
                <Row k="Employment" v={resource.employment_type} />
                <Row k="Service Line" v={resource.service_line} />
                <Row k="Status" v={resource.status.replace("_", " ")} />
              </div>
            )}
          </div>

          {resource && (
            <div className="rounded-xl border bg-card p-5">
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-xs uppercase tracking-widest text-muted-foreground font-medium">
                  Peak utilization over new range
                </div>
                <div className="tabular-nums font-display font-semibold text-lg">
                  {projectionAfter}<span className="text-muted-foreground text-sm">/100%</span>
                </div>
              </div>
              <Progress value={Math.min(100, projectionAfter)} className={over ? "[&>div]:bg-destructive" : ""} />
              <div className="text-xs text-muted-foreground mt-2">
                Existing: {peakTotal}% · Adding: {pct}%
                {over && <span className="text-destructive font-medium ml-2">Over-allocated — save will be blocked</span>}
              </div>
            </div>
          )}
        </div>

        {/* MIDDLE — new allocation form */}
        <div className="lg:col-span-2 rounded-xl border bg-card p-5">
          <h2 className="font-display text-base font-semibold mb-4">New Allocation</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Allocation Type</Label>
              <Select
                value={allocationType}
                onValueChange={(v) => setAllocationType(v as AllocationType)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ALLOCATION_TYPES.map((a) => <SelectItem key={a} value={a}>{ALLOCATION_TYPE_LABEL[a]}</SelectItem>)}
                </SelectContent>
              </Select>
              {allocationType === "Billable" && resource?.employment_type === "Contractor" && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                  R-07: Contractor billing — ensure correct employment type is set; cost treatment differs from FTE (downstream finance impact).
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>% Allocation</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={pct}
                onChange={(e) => setPct(parseInt(e.target.value || "0"))}
              />
            </div>
            {!isLeave && (
              <div className="space-y-1.5">
                <Label>Allocation Model</Label>
                <Select value={allocationModel} onValueChange={(v) => setAllocationModel(v as AllocationModel)}>
                  <SelectTrigger><SelectValue placeholder="Select model" /></SelectTrigger>
                  <SelectContent>
                    {ALLOCATION_MODELS.map((m) => (
                      <SelectItem key={m} value={m}>{ALLOCATION_MODEL_LABEL[m]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {!isLeave && (
              <>
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
                      {filteredProjects.length === 0 && (
                        <div className="px-2 py-2 text-xs text-muted-foreground">
                          No active projects for this customer
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label>Start Date</Label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>End Date</Label>
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Remarks</Label>
              <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
            {role?.isGovernanceLead && over && (
              <div className="col-span-2 rounded-lg border border-warning bg-warning/10 p-3 space-y-2">
                <p className="text-xs font-medium text-warning-foreground">Over-allocation detected — Governance Lead override (R-01)</p>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={capOverride} onChange={(e) => setCapOverride(e.target.checked)} />
                  Override 100% cap
                </label>
                {capOverride && (
                  <Input placeholder="Reason required *" value={capOverrideReason} onChange={(e) => setCapOverrideReason(e.target.value)} />
                )}
              </div>
            )}
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs text-muted-foreground">Date override reason (optional — allows dates outside project window per R-02)</Label>
              <Input placeholder="Leave blank to enforce project date bounds" value={dateOverrideReason} onChange={(e) => setDateOverrideReason(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            {isReadOnly && (
              <span className="text-xs text-muted-foreground self-center mr-2">
                Read-only role — allocations cannot be edited
              </span>
            )}
            <Button variant="ghost" onClick={reset}>Reset</Button>
            <Button onClick={save} disabled={saving || !resource || (over && !(capOverride && capOverrideReason.trim())) || isReadOnly}>
              {saving ? "Saving…" : "Save Allocation"}
            </Button>
          </div>
        </div>
      </div>

      {/* Existing allocations for this resource */}
      {resource && (
        <div className="mt-6 rounded-xl border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b">
            <h2 className="font-display text-base font-semibold">
              Existing allocations for {resource.full_name}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">{myAllocations.length} rows</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/40">
                <tr>
                  <th className="text-left px-5 py-2.5 font-medium">Project</th>
                  <th className="text-left px-3 py-2.5 font-medium">Cost / Opex</th>
                  <th className="text-left px-3 py-2.5 font-medium">Model</th>
                  <th className="text-left px-3 py-2.5 font-medium">Dates</th>
                  <th className="text-right px-3 py-2.5 font-medium">%</th>
                  <th className="text-left px-3 py-2.5 font-medium">Remarks</th>
                  <th className="px-5 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {myAllocations.map((a: any) => (
                  <tr key={a.id} className="border-t">
                    <td className="px-5 py-3">
                      {a.projects ? (
                        <>
                          <span className="font-mono text-xs text-muted-foreground mr-2">
                            {a.projects.project_code}
                          </span>
                          {a.projects.project_description}
                        </>
                      ) : (
                        <span className="text-muted-foreground italic">— Leave —</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <AllocationTypeBadge type={a.allocation_type} />
                      {isExtendedLeave(a) && (
                        <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-warning/20 text-warning-foreground font-medium uppercase tracking-wide">
                          Extended &gt;5d
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {a.allocation_model ? ALLOCATION_MODEL_LABEL[a.allocation_model as AllocationModel] : "—"}
                    </td>
                    <td className="px-3 py-3 text-xs tabular-nums text-muted-foreground">
                      {a.allocation_start_date} → {a.allocation_end_date}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium">{a.allocation_pct}%</td>
                    <td className="px-3 py-3 text-muted-foreground">{a.remarks ?? "—"}</td>
                    <td className="px-5 py-3 text-right">
                      {canEditProject(a.projects) && (
                        <Button variant="ghost" size="icon" onClick={() => remove(a.id)}>
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {myAllocations.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-muted-foreground">
                      No allocations yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs uppercase tracking-widest text-muted-foreground">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}
