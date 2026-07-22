/**
 * HubSpot API service module — SERVER-SIDE ONLY.
 *
 * Reads the Private App token from process.env.HUBSPOT_TOKEN (a server-only secret). Do NOT use a
 * VITE_-prefixed variable — that ships the token to the browser — and never import this file from
 * client components: process.env.HUBSPOT_TOKEN is undefined in the browser and HubSpot blocks CORS.
 * Call these functions from a TanStack Start server function / route or a Supabase edge function.
 *
 * Maps into the app: a HubSpot deal → projects.hubspot_deal_id, a HubSpot company → a customer.
 */

const HUBSPOT_BASE_URL = "https://api.hubapi.com";

function getToken(): string | null {
  return process.env.HUBSPOT_TOKEN ?? null;
}

export function isHubSpotConfigured(): boolean {
  return !!getToken();
}

async function hubspotFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  if (!token) {
    throw new Error("HUBSPOT_TOKEN is not set — add it as a server-only env var (no VITE_ prefix).");
  }
  const res = await fetch(`${HUBSPOT_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `HubSpot ${init?.method ?? "GET"} ${path} → ${res.status} ${res.statusText}${body ? `: ${body}` : ""}`,
    );
  }
  return (await res.json()) as T;
}

// ---- Types (only the fields we use) ----------------------------------------------------------
export type HubSpotDeal = {
  id: string;
  properties: Record<string, string | null>;
  associations?: {
    companies?: { results: { id: string; type: string }[] };
  };
};

export type HubSpotCompany = {
  id: string;
  properties: Record<string, string | null>;
};

type HubSpotListResponse<T> = {
  results: T[];
  paging?: { next?: { after: string; link?: string } };
};

const DEAL_PROPERTIES = ["dealname", "amount", "dealstage", "pipeline", "closedate", "hs_is_closed_won", "service_line"];
const COMPANY_PROPERTIES = ["name", "domain", "industry", "country", "city", "numberofemployees"];

/**
 * Fetch every closed-won deal, each with its associated company id(s).
 *
 * Uses the list endpoint with associations (per the integration plan):
 *   GET /crm/v3/objects/deals?associations=companies&properties=...&limit=100
 * pages through all results, and keeps only deals HubSpot flags as won
 * (properties.hs_is_closed_won === "true") — pipeline-agnostic, unlike matching a specific
 * dealstage id, which differs per pipeline.
 */
export async function fetchClosedWonDeals(): Promise<Array<{ deal: HubSpotDeal; companyIds: string[] }>> {
  const out: Array<{ deal: HubSpotDeal; companyIds: string[] }> = [];
  const params = new URLSearchParams({
    limit: "100",
    associations: "companies",
    properties: DEAL_PROPERTIES.join(","),
  });
  let after: string | undefined;
  do {
    if (after) params.set("after", after);
    const page = await hubspotFetch<HubSpotListResponse<HubSpotDeal>>(
      `/crm/v3/objects/deals?${params.toString()}`,
    );
    for (const deal of page.results) {
      if (deal.properties?.hs_is_closed_won !== "true") continue;
      const companyIds = deal.associations?.companies?.results.map((r) => r.id) ?? [];
      out.push({ deal, companyIds });
    }
    after = page.paging?.next?.after;
  } while (after);
  return out;
}

/** Fetch a single company's detail record by id. */
export async function fetchCompany(companyId: string): Promise<HubSpotCompany> {
  const params = new URLSearchParams({ properties: COMPANY_PROPERTIES.join(",") });
  return hubspotFetch<HubSpotCompany>(`/crm/v3/objects/companies/${companyId}?${params.toString()}`);
}

/** Fetch ALL companies (paged) — used by the backfill to seed the Customer Master. */
export async function fetchAllCompanies(): Promise<HubSpotCompany[]> {
  const out: HubSpotCompany[] = [];
  const params = new URLSearchParams({ limit: "100", properties: COMPANY_PROPERTIES.join(",") });
  let after: string | undefined;
  do {
    if (after) params.set("after", after);
    const page = await hubspotFetch<HubSpotListResponse<HubSpotCompany>>(
      `/crm/v3/objects/companies?${params.toString()}`,
    );
    out.push(...page.results);
    after = page.paging?.next?.after;
  } while (after);
  return out;
}

/**
 * Convenience: closed-won deals joined to their (de-duplicated) company records — the shape the
 * downstream mapping step (deal → project, company → customer) will consume.
 */
export async function fetchClosedWonDealsWithCompanies(): Promise<
  Array<{ deal: HubSpotDeal; companies: HubSpotCompany[] }>
> {
  const deals = await fetchClosedWonDeals();
  const uniqueIds = [...new Set(deals.flatMap((d) => d.companyIds))];
  const companies = new Map<string, HubSpotCompany>();
  // Each unique company fetched once (sandbox volumes are small; the batch-read endpoint is a
  // later optimisation if needed).
  await Promise.all(
    uniqueIds.map(async (id) => {
      companies.set(id, await fetchCompany(id));
    }),
  );
  return deals.map(({ deal, companyIds }) => ({
    deal,
    companies: companyIds
      .map((id) => companies.get(id))
      .filter((c): c is HubSpotCompany => !!c),
  }));
}

// ---- Higher-level entry (kept from the stub; now backed by the live API) ---------------------
export type HubSpotSyncResult =
  | { status: "not_configured"; message: string }
  | { status: "ok"; deals: number; companies: number }
  | { status: "error"; message: string };

/**
 * Pulls closed-won deals + their companies from HubSpot and returns counts. Persisting/mapping the
 * results into projects & customers is the next step in the plan.
 */
export async function syncHubSpotDeals(): Promise<HubSpotSyncResult> {
  if (!isHubSpotConfigured()) {
    return {
      status: "not_configured",
      message: "HUBSPOT_TOKEN is not set — add it as a server-only env var to enable the sync.",
    };
  }
  try {
    const joined = await fetchClosedWonDealsWithCompanies();
    const companyIds = new Set(joined.flatMap((j) => j.companies.map((c) => c.id)));
    return { status: "ok", deals: joined.length, companies: companyIds.size };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
