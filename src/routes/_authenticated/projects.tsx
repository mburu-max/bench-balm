import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2, ArrowRight, XCircle, Lock, ClipboardCheck } from "lucide-react";
import { useCustomers, useProjects, useAllocations } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { SERVICE_LINES, type ServiceLine, type ProjectStatus, PROJECT_STATUSES } from "@/lib/constants";
import { ProjectStatusBadge } from "@/components/StatusBadge";
import { useCurrentRole } from "@/lib/useCurrentRole";

export const Route = createFileRoute("/_authenticated/projects")({
  component: ProjectsPage,
  validateSearch: (search: Record<string, unknown>): { status?: string } => ({
    status: typeof search.status === "string" ? search.status : undefined,
  }),
});

type Form = {
  id?: string;
  project_code: string;
  hubspot_deal_id: string;
  project_description: string;
  customer_id: string;
  service_line: ServiceLine | "";
  project_manager_user_id: string;
  start_date: string;
  end_date: string;
};

const empty: Form = {
  project_code: "",
  hubspot_deal_id: "",
  project_description: "",
  customer_id: "",
  service_line: "",
  project_manager_user_id: "",
  start_date: "",
  end_date: "",
};

const todayStr = () => new Date().toISOString().slice(0, 10);

function ProjectsPage() {
  const projects = useProjects();
  const customers = useCustomers();
  const allocations = useAllocations();
  const qc = useQueryClient();
  const { data: role } = useCurrentRole();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(empty);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const { status: statusParam } = Route.useSearch();
  const [statusFilter, setStatusFilter] = useState<string>(statusParam ?? "all");

  // PMs available to assign on creation. Uses a SECURITY DEFINER RPC so an SL Lead can
  // read the PM roster without broad access to profiles/user_roles. Empty until PMs exist.
  const pms = useQuery({
    queryKey: ["project-managers"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("list_project_managers");
      if (error) return [] as { user_id: string; full_name: string | null; email: string }[];
      return (data ?? []) as { user_id: string; full_name: string | null; email: string }[];
    },
  });
  const pmLabel = (id: string | null | undefined) => {
    const pm = (pms.data ?? []).find((p) => p.user_id === id);
    return pm ? pm.full_name ?? pm.email : "—";
  };

  // Top-down workflow: SL Leads initiate projects and assign the PM (Step 1); the project
  // cascades to that PM's dashboard. The Governance Lead then VERIFIES a Draft straight to
  // Active (single approval gate) — that flip surfaces the "assign resources" flag for the PM.
  // Delete and On-Hold are Governance-only. Edit = Governance + SL Lead (not PM).
  const canCreate = !!(role?.isGovernanceLead || role?.isSlLead || role?.isDeveloper);
  // Verify = the Governance approval that activates a Draft (Developer implied).
  const canVerify = !!(role?.isGovernanceLead || role?.isDeveloper);
  const canActivate = canVerify;
  // Reject/withdraw a Draft: Governance or the SL Lead who owns the service line.
  const canReject = !!(role?.isGovernanceLead || role?.isDl || role?.isDeveloper);
  const canDelete = !!(role?.isGovernanceLead || role?.isDeveloper);
  const canEditProject = (p: any) =>
    !!(role?.isDeveloper || role?.isGovernanceLead || role?.isDl);

  // Current resource count per project (distinct, in-effect, non-Leave).
  const resCountByProject = useMemo(() => {
    const today = todayStr();
    const m: Record<string, Set<string>> = {};
    for (const a of allocations.data ?? []) {
      if (a.project_id && a.allocation_type !== "Leave" && a.allocation_start_date <= today && a.allocation_end_date >= today) {
        (m[a.project_id] ??= new Set()).add(a.resource_id);
      }
    }
    return m;
  }, [allocations.data]);

  const startNew = () => {
    if (!canCreate) return toast.error("You don't have permission to create projects");
    setForm(empty);
    setOpen(true);
  };
  const startEdit = (p: any) => {
    if (!canEditProject(p)) return toast.error("You can't edit this project");
    setForm({
      id: p.id,
      project_code: p.project_code,
      hubspot_deal_id: p.hubspot_deal_id ?? "",
      project_description: p.project_description,
      customer_id: p.customer_id,
      service_line: p.service_line,
      project_manager_user_id: p.project_manager_user_id ?? "",
      start_date: p.start_date,
      end_date: p.end_date,
    });
    setOpen(true);
  };

  // On new projects the code is [SL]-[CUST]-NNN, so it needs both the service line and the
  // customer. Regenerate server-side once both are set (and re-run if either changes).
  const regenerateCode = async (sl: ServiceLine | "", customerId: string) => {
    if (!sl || !customerId) {
      setForm((f) => ({ ...f, project_code: "" }));
      return;
    }
    const { data } = await (supabase.rpc as any)("next_project_code", {
      _sl: sl,
      _customer_id: customerId,
    });
    // Guard against a stale response overwriting a newer selection.
    setForm((f) =>
      f.service_line === sl && f.customer_id === customerId
        ? { ...f, project_code: (data as string) ?? "" }
        : f
    );
  };

  const onServiceLineChange = (v: string) => {
    const sl = v as ServiceLine;
    if (form.id) {
      setForm((f) => ({ ...f, service_line: sl }));
      return;
    }
    setForm((f) => ({ ...f, service_line: sl, project_code: "" }));
    regenerateCode(sl, form.customer_id);
  };

  const onCustomerChange = (v: string) => {
    if (form.id) {
      setForm((f) => ({ ...f, customer_id: v }));
      return;
    }
    setForm((f) => ({ ...f, customer_id: v, project_code: "" }));
    regenerateCode(form.service_line, v);
  };

  const save = async () => {
    if (!form.customer_id) return toast.error("Customer required");
    if (!form.service_line) return toast.error("Service line required");
    if (!form.start_date || !form.end_date) return toast.error("Start and end dates required");
    if (!form.id && !form.project_code) return toast.error("Pick a service line to generate the project code");
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id ?? null;
    const base = {
      hubspot_deal_id: form.hubspot_deal_id || null,
      project_description: form.project_description,
      customer_id: form.customer_id,
      service_line: form.service_line as ServiceLine,
      project_manager_user_id: form.project_manager_user_id || null,
      start_date: form.start_date,
      end_date: form.end_date,
    };
    let error;
    if (form.id) {
      ({ error } = await supabase.from("projects").update(base).eq("id", form.id));
    } else {
      ({ error } = await supabase
        .from("projects")
        .insert({ ...base, project_code: form.project_code, status: "Draft" as ProjectStatus, created_by: uid } as any));
    }
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(form.id ? "Project updated" : "Draft created — assigned to the PM's dashboard");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  const updateStatus = async (p: any, status: ProjectStatus) => {
    if (status === "Active" && !canVerify) return toast.error("Only the Governance Lead can verify & activate a project");
    if (status === "On_Hold" && !canActivate) return toast.error("Only the Governance Lead can put a project on hold");
    if (status === "Rejected" && !canReject) return toast.error("You can't reject this project");
    const { error } = await supabase.from("projects").update({ status }).eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success(status === "Active" ? "Verified → Active" : `Status → ${status.replace("_", " ")}`);
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  const remove = async (p: any) => {
    if (!canDelete) return toast.error("Only Governance Lead can delete projects");
    if ((allocations.data ?? []).some((a) => a.project_id === p.id)) {
      return toast.error("This project has allocations. Remove all allocations before deleting it.");
    }
    if (!confirm(`Delete project ${p.project_code}?`)) return;
    const { error } = await supabase.from("projects").delete().eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("Project deleted");
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  const filtered = (projects.data ?? []).filter((p) => {
    const matchesQ =
      p.project_code.toLowerCase().includes(q.toLowerCase()) ||
      p.project_description.toLowerCase().includes(q.toLowerCase());
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "pending"
        ? p.status === "Draft" || p.status === "Verified"
        : p.status === statusFilter);
    return matchesQ && matchesStatus;
  });

  const draftsPending = (projects.data ?? []).filter((p) => p.status === "Draft");

  return (
    <AppShell
      title="Project Registry"
      actions={
        canCreate ? (
          <Button onClick={startNew}>
            <Plus className="size-4 mr-1.5" /> New Project
          </Button>
        ) : undefined
      }
    >
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>{form.id ? "Edit Project" : "New Draft Project"}</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-2">
                <div className="space-y-1.5">
                  <Label>Project Code</Label>
                  <div className="h-9 flex items-center rounded-md border bg-muted/40 px-3 font-mono text-sm">
                    {form.project_code || <span className="text-muted-foreground font-sans text-xs">Auto-generated from service line + customer</span>}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {form.id ? "Locked — the code is the primary key and can't change." : "Generated as [SL]-[CUST]-NNN once you pick a service line and customer."}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>HubSpot Deal ID</Label>
                  <Input
                    value={form.hubspot_deal_id}
                    onChange={(e) => setForm({ ...form, hubspot_deal_id: e.target.value })}
                    placeholder="Optional reference"
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Project Description</Label>
                  <Textarea
                    value={form.project_description}
                    onChange={(e) => setForm({ ...form, project_description: e.target.value })}
                    rows={2}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Customer *</Label>
                  <Select value={form.customer_id} onValueChange={onCustomerChange}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {(customers.data ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.customer_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Service Line *</Label>
                  <Select value={form.service_line} onValueChange={onServiceLineChange}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {SERVICE_LINES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Project Manager</Label>
                  <Select value={form.project_manager_user_id} onValueChange={(v) => setForm({ ...form, project_manager_user_id: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder={(pms.data?.length ?? 0) === 0 ? "No project managers available yet" : "Assign a PM"} />
                    </SelectTrigger>
                    <SelectContent>
                      {(pms.data ?? []).map((pm) => (
                        <SelectItem key={pm.user_id} value={pm.user_id}>{pm.full_name ?? pm.email}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    The assigned PM sees this project on their dashboard. Create PMs in Admin → Users.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Start Date *</Label>
                  <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>End Date *</Label>
                  <Input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
              </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Governance verification queue — Draft → Active (single approval gate) */}
      {canVerify && draftsPending.length > 0 && (
        <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ClipboardCheck className="size-4 text-primary" />
            {draftsPending.length} draft project{draftsPending.length === 1 ? "" : "s"} pending your verification
          </div>
          <div className="mt-3 space-y-1.5">
            {draftsPending.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <span className="font-mono text-xs text-muted-foreground mr-2">{p.project_code}</span>
                  {p.project_description}
                  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground uppercase tracking-wide">{p.service_line}</span>
                </div>
                <Button size="sm" onClick={() => updateStatus(p, "Active")}>
                  Verify &amp; Activate <ArrowRight className="size-3.5 ml-1" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 mb-4">
        <Input placeholder="Search code or description…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending (Draft / Verified)</SelectItem>
            {PROJECT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="text-sm text-muted-foreground">{filtered.length} total</div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/40">
              <tr>
                <th className="text-left px-5 py-2.5 font-medium">Code</th>
                <th className="text-left px-3 py-2.5 font-medium">Description</th>
                <th className="text-left px-3 py-2.5 font-medium">Customer</th>
                <th className="text-left px-3 py-2.5 font-medium">SL</th>
                <th className="text-left px-3 py-2.5 font-medium">PM</th>
                <th className="text-left px-3 py-2.5 font-medium">Dates</th>
                <th className="text-right px-3 py-2.5 font-medium">Resources</th>
                <th className="text-left px-3 py-2.5 font-medium">Status</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p: any) => {
                const canEdit = canEditProject(p);
                const resCount = resCountByProject[p.id]?.size ?? 0;
                return (
                  <tr key={p.id} className="border-t hover:bg-muted/30">
                    <td className="px-5 py-3 font-mono text-xs">
                      <Link to="/projects/$projectId" params={{ projectId: p.id }} className="text-primary hover:underline">{p.project_code}</Link>
                    </td>
                    <td className="px-3 py-3">{p.project_description}</td>
                    <td className="px-3 py-3">{p.customers?.customer_name ?? "—"}</td>
                    <td className="px-3 py-3">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground uppercase tracking-wide">{p.service_line}</span>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{pmLabel(p.project_manager_user_id)}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground tabular-nums">{p.start_date} → {p.end_date}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <Link to="/projects/$projectId" params={{ projectId: p.id }} className="text-primary hover:underline">{resCount}</Link>
                    </td>
                    <td className="px-3 py-3"><ProjectStatusBadge status={p.status} /></td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      {p.status === "Draft" && canVerify && (
                        <Button size="sm" variant="secondary" className="mr-1" title="Verify & activate" onClick={() => updateStatus(p, "Active")}>
                          Verify <ArrowRight className="size-3.5 ml-1" />
                        </Button>
                      )}
                      {p.status === "Verified" && canActivate && (
                        <Button size="sm" variant="secondary" className="mr-1" title="Lock & activate" onClick={() => updateStatus(p, "Active")}>
                          <Lock className="size-3.5 mr-1" /> Lock to Active
                        </Button>
                      )}
                      {(p.status === "Draft" || p.status === "Verified") && canReject && (
                        <Button size="sm" variant="ghost" className="mr-1" onClick={() => updateStatus(p, "Rejected")}>
                          <XCircle className="size-4 mr-1 text-destructive" /> Reject
                        </Button>
                      )}
                      {p.status === "Active" && canActivate && (
                        <Button size="sm" variant="outline" className="mr-1" onClick={() => updateStatus(p, "On_Hold")}>
                          Hold
                        </Button>
                      )}
                      {canEdit && (
                        <Button variant="ghost" size="icon" onClick={() => startEdit(p)}>
                          <Pencil className="size-4" />
                        </Button>
                      )}
                      {canDelete && p.status !== "Closed" && (
                        <Button variant="ghost" size="icon" onClick={() => remove(p)}>
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-10 text-center text-muted-foreground">No projects match.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
