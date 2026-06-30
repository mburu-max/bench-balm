/**
 * Omni HR integration stub.
 *
 * This module is a placeholder for a future live sync described in the
 * RA Standard Requirements document (§8 Technology & Integration Standards).
 * The project description references Omni HR for employee data (resources).
 *
 * To activate:
 * 1. Add VITE_OMNI_HR_API_KEY and VITE_OMNI_HR_BASE_URL to your environment variables.
 * 2. Replace the stub below with real API calls to pull employee records.
 * 3. Map Omni HR employee IDs to resources.omni_id and keep resources.omni_hr_sync_status updated.
 */

export type OmniHrSyncResult =
  | { status: "not_configured"; message: string }
  | { status: "ok"; synced: number }
  | { status: "error"; message: string };

export async function syncOmniHrEmployees(): Promise<OmniHrSyncResult> {
  return {
    status: "not_configured",
    message:
      "Omni HR integration is not configured — no API credentials available. " +
      "This is a placeholder stub. See src/lib/integrations/omni-hr.ts to activate.",
  };
}
