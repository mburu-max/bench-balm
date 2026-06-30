import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentRole } from "@/lib/useCurrentRole";
import { AllocationTypeBadge, ResourceStatusBadge } from "@/components/StatusBadge";
import { toast } from "sonner";
import { CalendarOff, CalendarCheck } from "lucide-react";

export const Route = (createFileRoute as any)("/_authenticated/my-profile")({
  component: MyProfilePage,
});

function MyProfilePage() {
  const { data: role } = useCurrentRole();
  const qc = useQueryClient();
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveStart, setLeaveStart] = useState(new Date().toISOString().slice(0, 10));
  const [leaveEnd, setLeaveEnd] = useState(new Date().toISOString().slice(0, 10));
  const [leaveReason, setLeaveReason] = useState("");
  const [saving, setSaving] = useState(false);

  const profile = useQuery({
    queryKey: ["my-resource-profile", role?.userId],
    enabled: !!role?.userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("resources")
        .select("*")
        .eq("user_id", role!.userId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const allocations = useQuery({
    queryKey: ["my-allocations", profile.data?.id],
    enabled: !!profile.data?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("allocations")
        .select("*, projects(project_code, project_description)")
        .eq("resource_id", profile.data!.id)
        .order("allocation_start_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const requestLeave = async () => {
    if (!profile.data) return;
    if (leaveEnd < leaveStart) return toast.error("End date before start");
    setSaving(true);
    const { error } = await supabase.rpc("request_leave", {
      _resource_id: profile.data.id,
      _start: leaveStart,
      _end: leaveEnd,
      _reason: leaveReason || undefined,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Leave requested");
    setLeaveOpen(false);
    setLeaveReason("");
    qc.invalidateQueries({ queryKey: ["my-resource-profile"] });
    qc.invalidateQueries({ queryKey: ["my-allocations"] });
  };

  const returnFromLeave = async () => {
    if (!profile.data) return;
    const { error } = await supabase.rpc("return_from_leave", { _resource_id: profile.data.id });
    if (error) return toast.error(error.message);
    toast.success("Marked as returned from leave");
    qc.invalidateQueries({ queryKey: ["my-resource-profile"] });
    qc.invalidateQueries({ queryKey: ["my-allocations"] });
  };

  if (profile.isLoading) {
    return <AppShell title="My Profile"><div className="p-10 text-center text-muted-foreground">Loading…</div></AppShell>;
  }

  if (!profile.data) {
    return (
      <AppShell title="My Profile">
        <div className="rounded-xl border bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Your account hasn't been linked to a resource record yet.
            Please ask a Developer or Governance Lead to link your account via Admin → User Roles.
          </p>
        </div>
      </AppShell>
    );
  }

  const r = profile.data;
  const isOnLeave = r.status === "On_Leave";

  return (
    <AppShell
      title="My Profile"
      actions={
        <div className="flex gap-2">
          {isOnLeave ? (
            <Button variant="outline" size="sm" onClick={returnFromLeave}>
              <CalendarCheck className="size-4 mr-1.5" /> Return from Leave
            </Button>
          ) : (
            <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <CalendarOff className="size-4 mr-1.5" /> Request Leave
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader><DialogTitle>Request Leave</DialogTitle></DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>From</Label>
                      <Input type="date" value={leaveStart} onChange={(e) => setLeaveStart(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>To</Label>
                      <Input type="date" value={leaveEnd} onChange={(e) => setLeaveEnd(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Reason (optional)</Label>
                    <Textarea rows={2} value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setLeaveOpen(false)}>Cancel</Button>
                  <Button onClick={requestLeave} disabled={saving}>{saving ? "Saving…" : "Submit"}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="rounded-xl border bg-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold">{r.full_name}</h2>
            <ResourceStatusBadge status={r.status} />
          </div>
          <div className="text-sm text-muted-foreground space-y-1.5">
            <Row k="Omni ID" v={r.omni_id} />
            <Row k="Role" v={r.position ?? "—"} />
            <Row k="Department" v={r.department ?? "—"} />
            <Row k="Service Line" v={r.service_line} />
            <Row k="Employment" v={r.employment_type} />
            <Row k="Manager" v={r.manager_name ?? "—"} />
            <Row k="Location" v={r.location ?? "—"} />
          </div>
        </div>

        <div className="lg:col-span-2 rounded-xl border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b">
            <h2 className="font-display text-base font-semibold">My Allocations</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{allocations.data?.length ?? 0} rows (read-only)</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/40">
                <tr>
                  <th className="text-left px-5 py-2.5 font-medium">Project</th>
                  <th className="text-left px-3 py-2.5 font-medium">Type</th>
                  <th className="text-left px-3 py-2.5 font-medium">Dates</th>
                  <th className="text-right px-5 py-2.5 font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {(allocations.data ?? []).map((a: any) => (
                  <tr key={a.id} className="border-t">
                    <td className="px-5 py-3">
                      {a.projects ? (
                        <>
                          <span className="font-mono text-xs text-muted-foreground mr-2">{a.projects.project_code}</span>
                          {a.projects.project_description}
                        </>
                      ) : (
                        <span className="text-muted-foreground italic">— Leave —</span>
                      )}
                    </td>
                    <td className="px-3 py-3"><AllocationTypeBadge type={a.allocation_type} /></td>
                    <td className="px-3 py-3 text-xs tabular-nums text-muted-foreground">
                      {a.allocation_start_date} → {a.allocation_end_date}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums font-medium">{a.allocation_pct}%</td>
                  </tr>
                ))}
                {(allocations.data ?? []).length === 0 && !allocations.isLoading && (
                  <tr>
                    <td colSpan={4} className="px-5 py-10 text-center text-muted-foreground">
                      No allocations yet.
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs uppercase tracking-widest text-muted-foreground">{k}</span>
      <span className="font-medium text-foreground">{v}</span>
    </div>
  );
}
