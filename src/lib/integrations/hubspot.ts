/**
 * HubSpot integration stub.
 *
 * This module is a placeholder for a future live sync described in the
 * RA Standard Requirements document (§8 Technology & Integration Standards).
 * The project description references HubSpot for project codes and deal tracking.
 *
 * To activate:
 * 1. Add VITE_HUBSPOT_API_KEY to your environment variables.
 * 2. Replace the stub below with real API calls to HubSpot's Deals/Engagements API.
 * 3. Map hubspot_deal_id (already a column on public.projects) to the live deal record.
 */

export type HubSpotSyncResult =
  | { status: "not_configured"; message: string }
  | { status: "ok"; synced: number }
  | { status: "error"; message: string };

export async function syncHubSpotDeals(): Promise<HubSpotSyncResult> {
  return {
    status: "not_configured",
    message:
      "HubSpot integration is not configured — no API credentials available. " +
      "This is a placeholder stub. See src/lib/integrations/hubspot.ts to activate.",
  };
}
