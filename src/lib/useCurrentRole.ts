import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
};

const RANK: Record<string, number> = {
  developer: 1,
  admin: 2,
  governance_lead: 3,
  finance: 4,
  delivery_lead: 5,
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
        };
      }
      const { data: rolesData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", uid);
      const roles = (rolesData ?? []).map((r) => r.role as string);
      const top = roles.sort((a, b) => (RANK[a] ?? 99) - (RANK[b] ?? 99))[0] ?? null;

      const isDeveloper = roles.includes("developer") || roles.includes("admin");
      const isGovernanceLead = isDeveloper || roles.includes("governance_lead");
      // isFinance = read-only visibility only (audit, snapshots, dashboards). Finance has
      // ZERO edit rights per tracker RBAC-03; governance_lead keeps the same visibility.
      const isFinance = isGovernanceLead || roles.includes("finance");
      // SL Lead = Delivery Lead: the two roles are operationally equivalent (tracker Sheet 3).
      const isDl = isDeveloper || roles.includes("delivery_lead") || roles.includes("service_line_lead");
      const isSlLead = isDeveloper || roles.includes("service_line_lead") || roles.includes("delivery_lead");
      const isPm = isDeveloper || roles.includes("project_manager");
      const isResource = roles.includes("resource");
      const hasAnyOtherRole = isDeveloper || isGovernanceLead || isFinance || isDl || isSlLead || isPm;

      let serviceLines: ServiceLine[] = [];
      if (isSlLead && !isDeveloper) {
        const { data: slData } = await supabase
          .from("user_service_lines")
          .select("service_line")
          .eq("user_id", uid);
        serviceLines = (slData ?? []).map((r) => r.service_line as ServiceLine);
      }

      return {
        userId: uid, role: (top as any) ?? null,
        isDeveloper, isGovernanceLead, isFinance,
        isDl, isSlLead, isPm, isResource,
        serviceLines, hasAnyOtherRole,
      };
    },
  });
}
