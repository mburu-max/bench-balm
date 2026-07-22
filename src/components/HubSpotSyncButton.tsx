import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useCurrentRole } from "@/lib/useCurrentRole";
import { backfillHubSpotFn } from "@/lib/integrations/hubspot.functions";

export function HubSpotSyncButton() {
  const role = useCurrentRole();
  const sync = useServerFn(backfillHubSpotFn);
  const [loading, setLoading] = useState(false);

  const allowed = !!(role.data?.isDeveloper || role.data?.isGovernanceLead);
  if (!allowed) return null;

  const onClick = async () => {
    setLoading(true);
    try {
      const r = await sync();
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
