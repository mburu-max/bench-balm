import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useResources } from "@/lib/queries";
import { useCurrentRole } from "@/lib/useCurrentRole";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ALLOCATION_TYPES,
  EMPLOYMENT_TYPES,
  RESOURCE_STATUSES,
  SERVICE_LINES,
  type AllocationType,
  type EmploymentType,
  type ResourceStatus,
  type ServiceLine,
} from "@/lib/constants";
import { ResourceStatusBadge } from "@/components/StatusBadge";
import { KpiCard } from "@/components/KpiCard";
import { Users, UserCheck, UserMinus, UserX } from "lucide-react";

export const Route = createFileRoute("/_authenticated/resources")({
  component: ResourcesPage,
});

type Form = {
  id?: string;
  omni_id: string;
  full_name: string;
  position: string;
  department: string;
  location: string;
  manager_name: string;
  employment_type: EmploymentType;
  default_allocation_type: AllocationType;
  status: ResourceStatus;
  service_line: ServiceLine | "";
  email: string;
};

const empty: Form = {
  omni_id: "",
  full_name: "",
  position: "",
  department: "",
  location: "KE",
  manager_name: "",
  employment_type: "FTE",
  default_allocation_type: "Bench",
  status: "Active",
  service_line: "",
  email: "",
};

function ResourcesPage() {
  const resources = useResources();
  const { data: role } = useCurrentRole();
  const canWrite = !!(role?.isFinance || role?.isDeveloper);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(empty);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [slFilter, setSlFilter] = useState<string>("all");

  const startNew = () => {
    setForm(empty);
    setOpen(true);
  };
  const startEdit = (r: any) => {
    setForm({
      id: r.id,
      omni_id: r.omni_id,
      full_name: r.full_name,
      position: r.position ?? "",
      department: r.department ?? "",
      location: r.location ?? "",
      manager_name: r.manager_name ?? "",
      employment_type: r.employment_type,
      default_allocation_type: r.default_allocation_type,
      status: r.status,
      service_line: r.service_line,
      email: r.email ?? "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.omni_id.trim() || !form.full_name.trim()) return toast.error("Omni ID and name required");
    if (!form.service_line) return toast.error("Service line required");
    setSaving(true);
    const payload = {
      omni_id: form.omni_id.trim(),
      full_name: form.full_name.trim(),
      position: form.position || null,
      department: form.department || null,
      location: form.location || null,
      manager_name: form.manager_name || null,
      employment_type: form.employment_type,
      default_allocation_type: form.default_allocation_type,
      status: form.status,
      service_line: form.service_line as ServiceLine,
      email: form.email || null,
    };
    const { error } = form.id
      ? await supabase.from("resources").update(payload).eq("id", form.id)
      : await supabase.from("resources").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(form.id ? "Resource updated" : "Resource created");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["resources"] });
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this resource? All allocations will be removed.")) return;
    const { error } = await supabase.from("resources").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Resource deleted");
    qc.invalidateQueries({ queryKey: ["resources"] });
  };

  const all = resources.data ?? [];
  const filtered = all.filter(
    (r) =>
      (r.full_name.toLowerCase().includes(q.toLowerCase()) ||
        r.omni_id.toLowerCase().includes(q.toLowerCase())) &&
      (slFilter === "all" || r.service_line === slFilter),
  );

  const counts = {
    total: all.length,
    active: all.filter((r) => r.status === "Active").length,
    onLeave: all.filter((r) => r.status === "On_Leave").length,
    exited: all.filter((r) => r.status === "Exited").length,
  };

  return (
    <AppShell
      title="Resources"
      actions={
        canWrite ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={startNew}>
              <Plus className="size-4 mr-1.5" /> New Resource
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{form.id ? "Edit Resource" : "New Resource"}</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-2">
              <div className="space-y-1.5">
                <Label>Omni ID *</Label>
                <Input
                  value={form.omni_id}
                  onChange={(e) => setForm({ ...form, omni_id: e.target.value })}
                  className="font-mono"
                  placeholder="From profile URL"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Full Name *</Label>
                <Input
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Position</Label>
                <Input
                  value={form.position}
                  onChange={(e) => setForm({ ...form, position: e.target.value })}
                  placeholder="PSO - 3"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Department</Label>
                <Input
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Manager</Label>
                <Input
                  value={form.manager_name}
                  onChange={(e) => setForm({ ...form, manager_name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Location</Label>
                <Input
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
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
                <Label>Employment Type</Label>
                <Select
                  value={form.employment_type}
                  onValueChange={(v) => setForm({ ...form, employment_type: v as EmploymentType })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EMPLOYMENT_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Default Allocation Type</Label>
                <Select
                  value={form.default_allocation_type}
                  onValueChange={(v) => setForm({ ...form, default_allocation_type: v as AllocationType })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALLOCATION_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm({ ...form, status: v as ResourceStatus })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RESOURCE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Total" value={counts.total} icon={Users} />
        <KpiCard label="Active" value={counts.active} icon={UserCheck} accent="success" />
        <KpiCard label="On Leave" value={counts.onLeave} icon={UserMinus} accent="info" />
        <KpiCard label="Exited" value={counts.exited} icon={UserX} accent="destructive" />
      </div>

      <div className="flex items-center gap-3 mb-4">
        <Input
          placeholder="Search by name or Omni ID…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <Select value={slFilter} onValueChange={setSlFilter}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All service lines</SelectItem>
            {SERVICE_LINES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="text-sm text-muted-foreground">{filtered.length} resources</div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/40">
              <tr>
                <th className="text-left px-5 py-2.5 font-medium">Omni ID</th>
                <th className="text-left px-3 py-2.5 font-medium">Name</th>
                <th className="text-left px-3 py-2.5 font-medium">Role</th>
                <th className="text-left px-3 py-2.5 font-medium">Manager</th>
                <th className="text-left px-3 py-2.5 font-medium">SL</th>
                <th className="text-left px-3 py-2.5 font-medium">Type</th>
                <th className="text-left px-3 py-2.5 font-medium">Status</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="px-5 py-3 font-mono text-xs">{r.omni_id}</td>
                  <td className="px-3 py-3 font-medium">{r.full_name}</td>
                  <td className="px-3 py-3 text-muted-foreground">{r.position ?? "—"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{r.manager_name ?? "—"}</td>
                  <td className="px-3 py-3">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground uppercase tracking-wide">{r.service_line}</span>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{r.employment_type}</td>
                  <td className="px-3 py-3"><ResourceStatusBadge status={r.status} /></td>
                  <td className="px-5 py-3 text-right">
                    <Button variant="ghost" size="icon" onClick={() => startEdit(r)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(r.id)}>
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">
                    No resources yet. Add your first resource to start allocating.
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
