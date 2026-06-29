import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentRole } from "@/lib/useCurrentRole";
import { SERVICE_LINES } from "@/lib/constants";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/demand")({
  component: DemandPage,
});

const PRIORITIES = ["Low", "Medium", "High", "Critical"] as const;
const STATUSES = ["Open", "In_Progress", "Fulfilled", "Cancelled"] as const;

type Form = {
  id?: string;
  service_line: string;
  role: string;
  headcount: number;
  allocation_pct: number;
  required_from: string;
  required_to: string;
  priority: string;
  status: string;
  notes: string;
  project_id: string | null;
};

const empty: Form = {
  service_line: "DLaaS", role: "", headcount: 1, allocation_pct: 100,
  required_from: new Date().toISOString().slice(0, 10),
  required_to: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  priority: "Medium", status: "Open", notes: "", project_id: null,
};

function DemandPage() {
  const { data: role } = useCurrentRole();
  const qc = useQueryClient();
  const canWrite = !!(role?.isDl || role?.isFinance || role?.isDeveloper || role?.isPm);
  const canManage = !!(role?.isDl || role?.isFinance || role?.isDeveloper);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(empty);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("Open");

  const demand = useQuery({
    queryKey: ["demand-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("demand_requests")
        .select("*, projects(project_code, project_description)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = async () => {
    if (!form.role.trim()) return toast.error("Role required");
    if (form.required_to < form.required_from) return toast.error("End date before start date");
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const payload: any = {
      service_line: form.service_line, role: form.role.trim(),
      headcount: form.headcount, allocation_pct: form.allocation_pct,
      required_from: form.required_from, required_to: form.required_to,
      priority: form.priority, status: form.status, notes: form.notes || null,
      project_id: form.project_id,
    };
    let error;
    if (form.id) {
      ({ error } = await supabase.from("demand_requests").update(payload).eq("id", form.id));
    } else {
      ({ error } = await supabase.from("demand_requests").insert({ ...payload, created_by: u.user?.id }));
    }
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(form.id ? "Demand updated" : "Demand logged");
    setOpen(false);
    setForm(empty);
    qc.invalidateQueries({ queryKey: ["demand-requests"] });
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this demand request?")) return;
    const { error } = await supabase.from("demand_requests").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["demand-requests"] });
  };

  const setStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("demand_requests").update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["demand-requests"] });
  };

  const filtered = (demand.data ?? []).filter((d) => statusFilter === "all" || d.status === statusFilter);
  const priorityClass = (p: string) =>
    p === "Critical" ? "bg-destructive/20 text-destructive" :
    p === "High"     ? "bg-warning/30 text-warning-foreground" :
    p === "Medium"   ? "bg-secondary text-secondary-foreground" :
                       "bg-muted text-muted-foreground";

  return (
    <AppShell
      title="Demand & Capacity Risk"
      actions={
        canWrite ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => { setForm(empty); setOpen(true); }}>
                <Plus className="size-4 mr-1.5" /> Log demand
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-xl">
              <DialogHeader><DialogTitle>{form.id ? "Edit demand" : "Log resource demand"}</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-2">
                <div className="space-y-1.5">
                  <Label>Service Line</Label>
                  <Select value={form.service_line} onValueChange={(v) => setForm({ ...form, service_line: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{SERVICE_LINES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Role / Designation *</Label>
                  <Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="e.g. Senior Engineer" />
                </div>
                <div className="space-y-1.5">
                  <Label>Headcount</Label>
                  <Input type="number" min={1} value={form.headcount} onChange={(e) => setForm({ ...form, headcount: +e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Allocation %</Label>
                  <Input type="number" min={1} max={100} value={form.allocation_pct} onChange={(e) => setForm({ ...form, allocation_pct: +e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Required from</Label>
                  <Input type="date" value={form.required_from} onChange={(e) => setForm({ ...form, required_from: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Required to</Label>
                  <Input type="date" value={form.required_to} onChange={(e) => setForm({ ...form, required_to: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Priority</Label>
                  <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Notes</Label>
                  <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null
      }
    >
      <div className="flex items-center gap-3 mb-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="text-sm text-muted-foreground">{filtered.length} requests</div>
      </div>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/40">
              <tr>
                <th className="text-left px-5 py-2.5 font-medium">SL</th>
                <th className="text-left px-3 py-2.5 font-medium">Role</th>
                <th className="text-right px-3 py-2.5 font-medium">HC</th>
                <th className="text-right px-3 py-2.5 font-medium">%</th>
                <th className="text-left px-3 py-2.5 font-medium">Window</th>
                <th className="text-left px-3 py-2.5 font-medium">Priority</th>
                <th className="text-left px-3 py-2.5 font-medium">Status</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d: any) => (
                <tr key={d.id} className="border-t hover:bg-muted/30">
                  <td className="px-5 py-3 text-xs uppercase tracking-wide">{d.service_line}</td>
                  <td className="px-3 py-3">{d.role}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{d.headcount}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{d.allocation_pct}%</td>
                  <td className="px-3 py-3 text-xs text-muted-foreground tabular-nums">{d.required_from} → {d.required_to}</td>
                  <td className="px-3 py-3">
                    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${priorityClass(d.priority)}`}>{d.priority}</span>
                  </td>
                  <td className="px-3 py-3">
                    {canManage ? (
                      <Select value={d.status} onValueChange={(v) => setStatus(d.id, v)}>
                        <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}</SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs">{d.status.replace("_", " ")}</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {(canManage || d.created_by === role?.userId) && (
                      <Button variant="ghost" size="icon" onClick={() => remove(d.id)}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">No demand requests.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
