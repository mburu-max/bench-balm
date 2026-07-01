import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ROLE_LABEL, SERVICE_LINES } from "@/lib/constants";
import { useCurrentRole } from "@/lib/useCurrentRole";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin/users")({
  component: AdminUsersPage,
});

const ASSIGNABLE_ROLES = [
  "developer",
  "governance_lead",
  "finance",
  "delivery_lead",
  "service_line_lead",
  "project_manager",
  "resource",
] as const;

function AdminUsersPage() {
  const role = useCurrentRole();
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    if (role.isSuccess && !role.data?.isDeveloper) {
      toast.error("Access denied — Developer role required");
      navigate({ to: "/" });
    }
  }, [role.isSuccess, role.data?.isDeveloper, navigate]);

  const users = useQuery({
    queryKey: ["admin-users"],
    enabled: !!role.data?.isDeveloper,
    queryFn: async () => {
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .order("email");
      if (error) throw error;
      const { data: rolesData, error: rErr } = await supabase.from("user_roles").select("user_id, role");
      if (rErr) throw rErr;
      const { data: slData } = await supabase.from("user_service_lines").select("user_id, service_line");
      const roleMap = new Map<string, string[]>();
      for (const r of rolesData ?? []) {
        const arr = roleMap.get(r.user_id) ?? [];
        arr.push(r.role as string);
        roleMap.set(r.user_id, arr);
      }
      const slMap = new Map<string, string[]>();
      for (const s of slData ?? []) {
        const arr = slMap.get(s.user_id) ?? [];
        arr.push(s.service_line as string);
        slMap.set(s.user_id, arr);
      }
      return (profiles ?? []).map((p) => ({ ...p, roles: roleMap.get(p.id) ?? [], serviceLines: slMap.get(p.id) ?? [] }));
    },
  });

  const setRole = async (userId: string, newRole: string) => {
    const { error: delErr } = await supabase.from("user_roles").delete().eq("user_id", userId);
    if (delErr) return toast.error(delErr.message);
    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: newRole as any });
    if (error) return toast.error(error.message);
    // SL membership only applies to the SL-scoped roles; clear it otherwise.
    if (newRole !== "service_line_lead" && newRole !== "delivery_lead") {
      await supabase.from("user_service_lines").delete().eq("user_id", userId);
    }
    toast.success("Role updated");
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  };

  const toggleSlOwnership = async (userId: string, sl: string, owned: boolean) => {
    if (owned) {
      await supabase.from("user_service_lines").insert({ user_id: userId, service_line: sl as any });
    } else {
      await supabase.from("user_service_lines").delete().eq("user_id", userId).eq("service_line", sl as any);
    }
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  };

  if (!role.data?.isDeveloper) {
    return (
      <AppShell title="User Roles">
        <div className="rounded-xl border bg-card p-10 text-center">
          <ShieldAlert className="size-10 mx-auto text-destructive" />
          <h2 className="font-display text-lg font-semibold mt-3">Access denied</h2>
          <p className="text-sm text-muted-foreground mt-1">Developer role required.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="User Roles">
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b">
          <h2 className="font-display text-base font-semibold">All users</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Assign exactly one effective role per user. Backend enforces all access via RLS.
            SL Leads / Delivery Leads see only the service line(s) toggled below; PMs see only
            projects they own; Resources see only themselves.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted-foreground bg-muted/40">
              <tr>
                <th className="text-left px-5 py-2.5 font-medium">Name</th>
                <th className="text-left px-3 py-2.5 font-medium">Email</th>
                <th className="text-left px-3 py-2.5 font-medium">Current</th>
                <th className="text-left px-5 py-2.5 font-medium">Change role</th>
              </tr>
            </thead>
            <tbody>
              {(users.data ?? []).map((u: any) => {
                const primary = u.roles[0] ?? "resource";
                const showSlToggle = primary === "service_line_lead" || primary === "delivery_lead";
                return (
                  <tr key={u.id} className="border-t">
                    <td className="px-5 py-3 font-medium">{u.full_name ?? "—"}</td>
                    <td className="px-3 py-3 text-muted-foreground">{u.email}</td>
                    <td className="px-3 py-3">
                      <span className="inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide bg-primary/10 text-primary border-primary/20">
                        {ROLE_LABEL[primary] ?? primary}
                      </span>
                    </td>
                    <td className="px-5 py-3 space-y-2">
                      <Select value={primary} onValueChange={(v) => setRole(u.id, v)}>
                        <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ASSIGNABLE_ROLES.map((r) => (
                            <SelectItem key={r} value={r}>{ROLE_LABEL[r] ?? r}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {showSlToggle && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {SERVICE_LINES.map((sl) => {
                            const owned = (u.serviceLines ?? []).includes(sl);
                            return (
                              <button
                                key={sl}
                                type="button"
                                onClick={() => toggleSlOwnership(u.id, sl, !owned)}
                                className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${owned ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}
                              >
                                {sl}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {users.isLoading && (
                <tr><td colSpan={4} className="px-5 py-10 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {users.data && users.data.length === 0 && (
                <tr><td colSpan={4} className="px-5 py-10 text-center text-muted-foreground">No users</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
