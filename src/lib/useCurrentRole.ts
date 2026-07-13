import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getViewAs, getViewAsAccount } from "@/lib/impersonation";
import type { AppRole, ServiceLine } from "@/lib/constants";

export type CurrentRole = {
  userId: string | null;
  role: AppRole | "admin" | "viewer" | null;
  isDeveloper: boolean;
  isGovernanceLead: boolean;
  isFinance: boolean;
  isDl: boolean;
  isSlLead: boolean;
  isPm: boolean;
  isResource: boolean;
  serviceLines: ServiceLine[];
  hasAnyOtherRole: boolean;
  // Developer "view as" preview state (see lib/impersonation.ts).
  realIsDeveloper: boolean;
  impersonating: AppRole | null;
  // When previewing a specific account (from Admin → User Roles), the person's display name.
  impersonatingLabel: string | null;
};

const RANK: Record<string, number> = {
  developer: 1,
  admin: 2,
  governance_lead: 3,
  finance: 4,
  service_line_lead: 6,
  project_manager: 7,
  resource: 8,
  viewer: 9,
};

export function useCurrentRole() {
  return useQuery<CurrentRole>({
    queryKey: ["current-role"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id ?? null;
      if (!uid) {
        return {
          userId: null, role: null,
          isDeveloper: false, isGovernanceLead: false, isFinance: false,
          isDl: false, isSlLead: false, isPm: false, isResource: false,
          serviceLines: [], hasAnyOtherRole: false,
          realIsDeveloper: false, impersonating: null, impersonatingLabel: null,
        };
      }
      const { data: rolesData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", uid);
      const roles = (rolesData ?? []).map((r) => r.role as string);

      // Developer "view as" preview: only a real developer may impersonate, and it only
      // rewrites the UI-gating booleans below — the DB still enforces the real account.
      const realIsDeveloper = roles.includes("developer") || roles.includes("admin");
      const impersonating = realIsDeveloper ? getViewAs() : null;
      // Account-scoped preview (Admin → User Roles): also mirrors that account's service lines.
      const viewAsAccount = realIsDeveloper ? getViewAsAccount() : null;
      const src = impersonating ? [impersonating] : roles;
      const top = impersonating ?? (src.sort((a, b) => (RANK[a] ?? 99) - (RANK[b] ?? 99))[0] ?? null);

      const isDeveloper = src.includes("developer") || src.includes("admin");
      const isGovernanceLead = isDeveloper || src.includes("governance_lead");
      // isFinance = read-only visibility only (audit, snapshots, dashboards). Finance has
      // ZERO edit rights per tracker RBAC-03; governance_lead keeps the same visibility.
      const isFinance = isGovernanceLead || src.includes("finance");
      // Delivery Lead role cut (July sync) — validation sits entirely with the Service Line Lead.
      // isDl is kept as an alias of the SL-Lead validator capability so existing gates still read.
      const isDl = isDeveloper || src.includes("service_line_lead");
      const isSlLead = isDeveloper || src.includes("service_line_lead");
      const isPm = isDeveloper || src.includes("project_manager");
      const isResource = src.includes("resource");
      const hasAnyOtherRole = isDeveloper || isGovernanceLead || isFinance || isDl || isSlLead || isPm;

      let serviceLines: ServiceLine[] = [];
      if (viewAsAccount) {
        // Previewing a specific account — scope the UI to that account's service line(s).
        serviceLines = viewAsAccount.serviceLines as ServiceLine[];
      } else if (isSlLead && !isDeveloper) {
        const { data: slData } = await supabase
          .from("user_service_lines")
          .select("service_line")
          .eq("user_id", uid);
        serviceLines = (slData ?? []).map((r) => r.service_line as ServiceLine);
      }

      return {
        // Previewing an account adopts its user id so ownership checks (a PM's own projects, a
        // Resource's own profile) resolve to that person — not the real developer.
        userId: viewAsAccount?.userId || uid, role: (top as any) ?? null,
        isDeveloper, isGovernanceLead, isFinance,
        isDl, isSlLead, isPm, isResource,
        serviceLines, hasAnyOtherRole,
        realIsDeveloper, impersonating: impersonating ?? null,
        impersonatingLabel: viewAsAccount?.label ?? null,
      };
    },
  });
}
