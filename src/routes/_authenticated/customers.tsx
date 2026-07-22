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
import { Plus, Pencil, Trash2, Eye } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useCustomers } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { REGIONS, SERVICE_LINES, VERTICALS, type ServiceLine } from "@/lib/constants";
import { useCurrentRole } from "@/lib/useCurrentRole";
import { usePagination, Pager } from "@/components/Pager";
import { HubSpotSyncButton } from "@/components/HubSpotSyncButton";

export const Route = createFileRoute("/_authenticated/customers")({
  component: CustomersPage,
});


type Form = {
  id?: string;
  customer_name: string;
  service_lines: ServiceLine[];
  region: string;
  vertical: string;
  account_manager: string;
  notes: string;
};

const empty: Form = {
  customer_name: "",
  service_lines: [],
  region: "",
  vertical: "",
  account_manager: "",
  notes: "",
};

function Field({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function CustomersPage() {
  const customers = useCustomers();
  const { data: role } = useCurrentRole();
  const canWrite = !!(role?.isGovernanceLead || role?.isDeveloper);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [viewCustomer, setViewCustomer] = useState<any | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");

  const startNew = () => {
    setForm(empty);
    setOpen(true);
  };
  const startEdit = (c: any) => {
    setForm({
      id: c.id,
      customer_name: c.customer_name,
      service_lines: c.service_lines ?? [],
      region: c.region ?? "",
      vertical: c.vertical ?? "",
      account_manager: c.account_manager ?? "",
      notes: c.notes ?? "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.customer_name.trim()) return toast.error("Customer name required");
    if (form.service_lines.length === 0) return toast.error("Select at least one service line");
    setSaving(true);
    const payload = {
      customer_name: form.customer_name.trim(),
      service_lines: form.service_lines,
      region: form.region || null,
      vertical: form.vertical || null,
      account_manager: form.account_manager || null,
      notes: form.notes || null,
    };
    const { error } = form.id
      ? await supabase.from("customers").update(payload).eq("id", form.id)
      : await supabase.from("customers").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(form.id ? "Customer updated" : "Customer created");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["customers"] });
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this customer?")) return;
    const { error } = await supabase.from("customers").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Customer deleted");
    qc.invalidateQueries({ queryKey: ["customers"] });
  };

  const toggleSL = (sl: ServiceLine) => {
    setForm((f) => ({
      ...f,
      service_lines: f.service_lines.includes(sl)
        ? f.service_lines.filter((x) => x !== sl)
        : [...f.service_lines, sl],
    }));
  };

  const filtered = (customers.data ?? []).filter((c) =>
    c.customer_name.toLowerCase().includes(q.toLowerCase()),
  );
  const pg = usePagination(filtered, 10);

  return (
    <AppShell
      title="Customers"
      actions={
        <div className="flex items-center gap-2">
          <HubSpotSyncButton />
          {canWrite && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={startNew}>
              <Plus className="size-4 mr-1.5" /> New Customer
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{form.id ? "Edit Customer" : "New Customer"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Customer Name</Label>
                <Input
                  value={form.customer_name}
                  onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
                  placeholder="e.g. Axon"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Service Lines</Label>
                <div className="flex flex-wrap gap-2">
                  {SERVICE_LINES.map((sl) => {
                    const active = form.service_lines.includes(sl);
                    return (
                      <button
                        key={sl}
                        type="button"
                        onClick={() => toggleSL(sl)}
                        className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border hover:bg-muted"
                        }`}
                      >
                        {sl}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Region</Label>
                  <Select
                    value={form.region}
                    onValueChange={(v) => setForm({ ...form, region: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {REGIONS.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Vertical</Label>
                  <Select
                    value={form.vertical}
                    onValueChange={(v) => setForm({ ...form, vertical: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      {VERTICALS.map((v) => (
                        <SelectItem key={v} value={v}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Deal Owner</Label>
                <Input
                  value={form.account_manager}
                  onChange={(e) => setForm({ ...form, account_manager: e.target.value })}
                  placeholder="e.g. Evan McElwain"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
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
          )}
        </div>
      }
    >
      <div className="flex items-center gap-3 mb-4">
        <Input
          placeholder="Search customers…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <div className="text-sm text-muted-foreground">{filtered.length} total</div>
      </div>

      <Dialog open={!!viewCustomer} onOpenChange={(o) => { if (!o) setViewCustomer(null); }}>
        <DialogContent className="sm:max-w-lg">
          {viewCustomer && (() => {
            const c = viewCustomer;
            const act = (fn: () => void) => { fn(); setViewCustomer(null); };
            return (
              <>
                <DialogHeader>
                  <DialogTitle>{c.customer_name}</DialogTitle>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 py-1">
                  <div className="col-span-2">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Service Lines</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(c.service_lines ?? []).map((sl: string) => (
                        <span key={sl} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground uppercase tracking-wide">{sl}</span>
                      ))}
                    </div>
                  </div>
                  <Field label="Deal Owner" value={c.account_manager ?? "—"} />
                  <Field label="Region" value={c.region ?? "—"} />
                  <Field label="Vertical" value={c.vertical ?? "—"} />
                  <Field label="HubSpot" value={c.hubspot_sync_status ?? "not_configured"} />
                  {c.notes ? <Field label="Notes" value={c.notes} wide /> : null}
                </div>
                {canWrite && (
                  <DialogFooter className="mt-2 gap-2 sm:justify-start">
                    <Button size="sm" variant="outline" onClick={() => act(() => startEdit(c))}>
                      <Pencil className="size-3.5 mr-1" /> Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => act(() => remove(c.id))}>
                      <Trash2 className="size-4 mr-1 text-destructive" /> Delete
                    </Button>
                  </DialogFooter>
                )}
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/40">
              <tr>
                <th className="text-left px-5 py-2.5 font-medium">Customer</th>
                <th className="text-left px-3 py-2.5 font-medium">Service Lines</th>
                <th className="text-left px-3 py-2.5 font-medium">Deal Owner</th>
                <th className="text-left px-3 py-2.5 font-medium">Region</th>
                <th className="text-left px-3 py-2.5 font-medium">Vertical</th>
                <th className="text-left px-3 py-2.5 font-medium">Sync</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {pg.pageItems.map((c) => (
                <tr key={c.id} className="border-t hover:bg-muted/30">
                  <td className="px-5 py-3 font-medium">
                    <Link to={`/customers/${c.id}` as any} className="hover:underline">{c.customer_name}</Link>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(c.service_lines ?? []).map((sl: string) => (
                        <span key={sl} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground uppercase tracking-wide">
                          {sl}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground text-xs">{(c as any).account_manager ?? "—"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{c.region ?? "—"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{c.vertical ?? "—"}</td>
                  <td className="px-3 py-3">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      HubSpot: {(c as any).hubspot_sync_status ?? "not_configured"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Button size="sm" variant="outline" onClick={() => setViewCustomer(c)}>
                      <Eye className="size-3.5 mr-1" /> View
                    </Button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-muted-foreground">
                    No customers yet. Click <strong>New Customer</strong> to add one.
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
