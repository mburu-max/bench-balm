import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useCurrentRole } from "@/lib/useCurrentRole";
import { supabase } from "@/integrations/supabase/client";

// Backfill button for Resource Master: invokes the omni-webhook edge function in backfill mode
// (JWT-authenticated). Resources sync from Omni HR; projects/customers sync from HubSpot.
export function OmniSyncButton() {
  const role = useCurrentRole();
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);

  const allowed = !!(role.data?.isDeveloper || role.data?.isGovernanceLead);
  if (!allowed) return null;

  const onClick = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("omni-webhook", {
        body: { backfill: true },
      });
      if (error || (data as any)?.error) {
        let msg = (data as any)?.error ?? error?.message ?? "Omni HR sync failed";
        const ctx = (error as any)?.context;
        if (ctx && typeof ctx.json === "function") {
          try {
            const b = await ctx.json();
            if (b?.error) msg = b.error;
          } catch {
            /* body wasn't JSON */
          }
        }
        return toast.error(msg);
      }
      const r = data as { employees: number; synced: number; source?: string; managers?: number };
      qc.invalidateQueries({ queryKey: ["resources"] });
      // `source`/`managers` only exist on the new (CSV-report) build — so their presence, and the
      // manager count, tells you at a glance whether the report path actually ran.
      const via = r.source ? ` · via ${r.source}${r.managers != null ? `, ${r.managers} with manager` : ""}` : "";
      toast.success(`Omni HR synced — ${r.synced} of ${r.employees} employee${r.employees === 1 ? "" : "s"}${via}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Omni HR sync failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={onClick}
      disabled={loading}
      title="Sync from Omni HR"
      aria-label="Sync from Omni HR"
    >
      <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
    </Button>
  );
}
