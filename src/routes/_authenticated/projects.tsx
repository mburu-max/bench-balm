import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Pencil, Trash2, ArrowRight, CheckCircle2, XCircle } from "lucide-react";
import { useCustomers, useProjects } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { SERVICE_LINES, type ServiceLine, type ProjectStatus } from "@/lib/constants";
import { ProjectStatusBadge } from "@/components/StatusBadge";

export const Route = createFileRoute("/_authenticated/projects")({
  component: ProjectsPage,
});

type Form = {
  id?: string;
  project_code: string;
  hubspot_deal_id: string;
  project_description: string;
  customer_id: string;
  service_line: ServiceLine | "";
  delivery_center: string;
  start_date: string;
  end_date: string;
  contract_signed: boolean;
};

const empty: Form = {
  project_code: "",
  hubspot_deal_id: "",
  project_description: "",
  customer_id: "",
  service_line: "",
  delivery_center: "",
  start_date: "",
  end_date: "",
  contract_signed: false,
};

function ProjectsPage() {
  const projects = useProjects();
  const customers = useCustomers();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(empty);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const startNew = () => {
    setForm(empty);
    setOpen(true);
  };
  const startEdit = (p: any) => {
    setForm({
      id: p.id,
      project_code: p.project_code,
      hubspot_deal_id: p.hubspot_deal_id ?? "",
      project_description: p.project_description,
      customer_id: p.customer_id,
      service_line: p.service_line,
      delivery_center: p.delivery_center ?? "",
      start_date: p.start_date,
      end_date: p.end_date,
      contract_signed: p.contract_signed,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.project_code.trim()) return toast.error("Project code required");
    if (!form.customer_id) return toast.error("Customer required");
    if (!form.service_line) return toast.error("Service line required");
    if (!form.start_date || !form.end_date) return toast.error("Start and end dates required");
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const payload = {
      project_code: form.project_code.trim().toUpperCase(),
      hubspot_deal_id: form.hubspot_deal_id || null,
      project_description: form.project_description,
      customer_id: form.customer_id,
      service_line: form.service_line as ServiceLine,
      delivery_center: form.delivery_center || null,
      start_date: form.start_date,
      end_date: form.end_date,
      contract_signed: form.contract_signed,
      project_manager_id: userData.user?.id ?? null,
    };
    const { error } = form.id
      ? await supabase.from("projects").update(payload).eq("id", form.id)
      : await supabase.from("projects").insert({ ...payload, status: "Draft" as ProjectStatus });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(form.id ? "Project updated" : "Project created — submit for approval next");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  const updateStatus = async (id: string, status: ProjectStatus) => {
    const { error } = await supabase.from("projects").update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(`Status → ${status.replace("_", " ")}`);
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this project? Allocations will be removed.")) return;
    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Project deleted");
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  const filtered = (projects.data ?? []).filter((p) => {
    const matchesQ =
      p.project_code.toLowerCase().includes(q.toLowerCase()) ||
      p.project_description.toLowerCase().includes(q.toLowerCase());
    const matchesStatus = statusFilter === "all" || p.status === statusFilter;
    return matchesQ && matchesStatus;
  });

  // Workflow: which action to suggest next per row
  const nextAction = (p: any) => {
    switch (p.status) {
      case "Draft":
        return { label: "Submit to Delivery Lead", to: "Pending_Delivery_Lead" as ProjectStatus };
      case "Pending_Delivery_Lead":
        return { label: "Approve → Finance", to: "Pending_Finance" as ProjectStatus };
      case "Pending_Finance":
        return p.contract_signed
          ? { label: "Final Approve · Activate", to: "Active" as ProjectStatus }
          : null;
      default:
        return null;
    }
  };

  return (
    <AppShell
      title="Projects"
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={startNew}>
              <Plus className="size-4 mr-1.5" /> New Project
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{form.id ? "Edit Project" : "New Project"}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-2">
              <div className="space-y-1.5">
                <Label>Project Code *</Label>
                <Input
                  value={form.project_code}
                  onChange={(e) => setForm({ ...form, project_code: e.target.value })}
                  placeholder="DLS-AXN-001"
                  className="font-mono uppercase"
                />
              </div>
              <div className="space-y-1.5">
                <Label>HubSpot Deal ID</Label>
                <Input
                  value={form.hubspot_deal_id}
                  onChange={(e) => setForm({ ...form, hubspot_deal_id: e.target.value })}
                  placeholder="Manual entry"
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
                <Select
                  value={form.customer_id}
                  onValueChange={(v) => setForm({ ...form, customer_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {(customers.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.customer_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Service Line *</Label>
                <Select
                  value={form.service_line}
                  onValueChange={(v) => setForm({ ...form, service_line: v as ServiceLine })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICE_LINES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Delivery Center</Label>
                <Input
                  value={form.delivery_center}
                  onChange={(e) => setForm({ ...form, delivery_center: e.target.value })}
                  placeholder="e.g. Nairobi"
                />
              </div>
              <div className="space-y-1.5 flex items-end">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={form.contract_signed}
                    onCheckedChange={(v) => setForm({ ...form, contract_signed: !!v })}
                  />
                  Contract signed (required for Finance approval)
                </label>
              </div>
              <div className="space-y-1.5">
                <Label>Start Date *</Label>
                <Input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>End Date *</Label>
                <Input
                  type="date"
                  value={form.end_date}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      <div className="flex items-center gap-3 mb-4">
        <Input
          placeholder="Search code or description…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="Draft">Draft</SelectItem>
            <SelectItem value="Pending_Delivery_Lead">Pending Delivery Lead</SelectItem>
            <SelectItem value="Pending_Finance">Pending Finance</SelectItem>
            <SelectItem value="Active">Active</SelectItem>
            <SelectItem value="On_Hold">On Hold</SelectItem>
            <SelectItem value="Closed">Closed</SelectItem>
            <SelectItem value="Rejected">Rejected</SelectItem>
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
                <th className="text-left px-3 py-2.5 font-medium">Dates</th>
                <th className="text-left px-3 py-2.5 font-medium">Status</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p: any) => {
                const next = nextAction(p);
                return (
                  <tr key={p.id} className="border-t hover:bg-muted/30">
                    <td className="px-5 py-3 font-mono text-xs">{p.project_code}</td>
                    <td className="px-3 py-3">{p.project_description}</td>
                    <td className="px-3 py-3">{p.customers?.customer_name ?? "—"}</td>
                    <td className="px-3 py-3">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground uppercase tracking-wide">
                        {p.service_line}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground tabular-nums">
                      {p.start_date} → {p.end_date}
                    </td>
                    <td className="px-3 py-3">
                      <ProjectStatusBadge status={p.status} />
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      {next && (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="mr-1"
                          onClick={() => updateStatus(p.id, next.to)}
                        >
                          {next.label} <ArrowRight className="size-3.5 ml-1" />
                        </Button>
                      )}
                      {p.status === "Active" && (
                        <Button size="sm" variant="outline" className="mr-1" onClick={() => updateStatus(p.id, "On_Hold")}>
                          Hold
                        </Button>
                      )}
                      {(p.status === "Pending_Delivery_Lead" || p.status === "Pending_Finance") && (
                        <Button size="sm" variant="ghost" className="mr-1" onClick={() => updateStatus(p.id, "Rejected")}>
                          <XCircle className="size-4 mr-1 text-destructive" /> Reject
                        </Button>
                      )}
                      {p.status === "Pending_Finance" && !p.contract_signed && (
                        <span className="text-xs text-warning-foreground bg-warning/30 px-2 py-1 rounded mr-2">
                          Awaiting signed contract
                        </span>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => startEdit(p)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => remove(p.id)}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-muted-foreground">
                    No projects match. Create one with <strong>New Project</strong>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-3 text-sm">
        <div className="rounded-lg border bg-card p-4">
          <div className="font-medium flex items-center gap-2">
            <span className="size-2 rounded-full bg-muted-foreground" /> 1. Project Manager
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Creates the project as Draft and submits to the Delivery Lead.
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="font-medium flex items-center gap-2">
            <span className="size-2 rounded-full bg-warning" /> 2. Delivery Lead
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Reviews the project and forwards to Finance for final approval.
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="font-medium flex items-center gap-2">
            <CheckCircle2 className="size-3.5 text-success" /> 3. Governance / Finance
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Confirms signed contract, activates the project — only then it appears in allocation dropdowns.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
