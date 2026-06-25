import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/constants";

export type CurrentRole = {
  userId: string | null;
  role: AppRole | "admin" | "viewer" | null;
  isDeveloper: boolean;
  isFinance: boolean;
  isDl: boolean;
  isPm: boolean;
};

const RANK: Record<string, number> = {
  developer: 1,
  admin: 2,
  governance_lead: 3,
  finance: 4,
  delivery_lead: 5,
  project_manager: 6,
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
        return { userId: null, role: null, isDeveloper: false, isFinance: false, isDl: false, isPm: false };
      }
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", uid);
      const roles = (data ?? []).map((r) => r.role as string);
      const top = roles.sort((a, b) => (RANK[a] ?? 99) - (RANK[b] ?? 99))[0] ?? null;
      const isDeveloper = roles.includes("developer") || roles.includes("admin");
      const isFinance = isDeveloper || roles.includes("finance") || roles.includes("governance_lead");
      const isDl = isDeveloper || roles.includes("delivery_lead");
      const isPm = isDeveloper || roles.includes("project_manager");
      return { userId: uid, role: (top as any) ?? null, isDeveloper, isFinance, isDl, isPm };
    },
  });
}
