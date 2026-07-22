import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useCurrentRole } from "@/lib/useCurrentRole";
import { syncHubSpotDealsFn } from "@/lib/integrations/hubspot.functions";

export function HubSpotSyncButton() {
  const role = useCurrentRole();
  const sync = useServerFn(syncHubSpotDealsFn);
  const [loading, setLoading] = useState(false);

  const allowed = !!(role.data?.isDeveloper || role.data?.isGovernanceLead);
  if (!allowed) return null;

  const onClick = async () => {
    setLoading(true);
    try {
      const res = await sync();
      if (res.status === "ok") {
        toast.success(`HubSpot sync: ${res.deals} deal(s), ${res.companies} company(ies)`);
      } else if (res.status === "not_configured") {
        toast.error(res.message);
      } else {
        toast.error(res.message);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "HubSpot sync failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={loading}>
      <RefreshCw className={`size-4 mr-2 ${loading ? "animate-spin" : ""}`} />
      {loading ? "Syncing…" : "Sync HubSpot"}
    </Button>
  );
}
