import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Server-only: reads HUBSPOT_TOKEN from process.env inside the handler and calls the
// HubSpot service module. Gated by the caller's role — only Developer or Governance may run.
export const syncHubSpotDealsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: roles, error: rolesErr } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (rolesErr) throw new Error(rolesErr.message);
    const roleSet = new Set((roles ?? []).map((r) => r.role as string));
    const allowed =
      roleSet.has("developer") || roleSet.has("admin") || roleSet.has("governance_lead");
    if (!allowed) {
      throw new Error("Forbidden: Developer or Governance role required");
    }

    const { syncHubSpotDeals } = await import("./hubspot");
    return await syncHubSpotDeals();
  });
