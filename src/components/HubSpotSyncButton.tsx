import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useCurrentRole } from "@/lib/useCurrentRole";
import { supabase } from "@/integrations/supabase/client";

// Backfill button: invokes the hubspot-webhook edge function in backfill mode (JWT-authenticated).
// Edge functions are the pattern that actually deploys here — TanStack server functions (_serverFn)
// aren't served on the Lovable deploy.
export function HubSpotSyncButton() {
  const role = useCurrentRole();
  const [loading, setLoading] = useState(false);

  const allowed = !!(role.data?.isDeveloper || role.data?.isGovernanceLead);
  if (!allowed) return null;

  const onClick = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("hubspot-webhook", {
        body: { backfill: true },
      });
      if (error || (data as any)?.error) {
        // supabase-js hides the function's JSON body on a non-2xx (FunctionsHttpError) — dig it out.
        let msg = (data as any)?.error ?? error?.message ?? "HubSpot sync failed";
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
      const r = data as {
        projects: number;
        staged: number;
        customersCreated: number;
        customersLinked: number;
      };
      const customers = r.customersCreated + r.customersLinked;
      toast.success(
        `HubSpot synced — ${r.projects} project${r.projects === 1 ? "" : "s"}, ` +
          `${r.staged} staged, ${customers} customer${customers === 1 ? "" : "s"}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "HubSpot sync failed");
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
      title="Sync from HubSpot"
      aria-label="Sync from HubSpot"
    >
      <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
    </Button>
  );
}
