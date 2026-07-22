// HubSpot backfill (SERVER-SIDE ONLY). Pulls ALL companies + ALL closed-won deals and upserts them
// with the service role (bypasses RLS) — the same match/upsert logic as the webhook, for records
// that already exist (webhooks only fire on future changes). Loaded via dynamic import inside a
// server handler, so it never reaches the client bundle.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchAllCompanies, fetchClosedWonDeals, fetchCompany, type HubSpotCompany } from "./hubspot";

// Cast away the generated Database types — hubspot_company_id, the hubspot_deal_imports table and
// the import_hubspot_deal() RPC were added after types.ts was generated.
const db: any = supabaseAdmin;

const SERVICE_LINES = ["DLaaS", "CLM", "MS", "CCaaS", "Legacy"];
const resolveServiceLine = (raw: string): string | undefined =>
  SERVICE_LINES.find((s) => s.toLowerCase() === raw.trim().toLowerCase());

// Match a HubSpot company to a customer (by id, then name), linking + filling blanks, else create.
async function upsertCustomer(company: HubSpotCompany): Promise<{ id: string | null; created: boolean }> {
  const name = String(company.properties?.name ?? "").trim();
  if (!name) return { id: null, created: false };
  const country = company.properties?.country ?? null;
  const industry = company.properties?.industry ?? null;

  const { data: byId } = await db.from("customers").select("id").eq("hubspot_company_id", company.id).maybeSingle();
  if (byId) return { id: byId.id, created: false };

  const { data: byNameRows } = await db.from("customers").select("id, region, vertical").ilike("customer_name", name).limit(1);
  const byName = byNameRows?.[0];
  if (byName) {
    await db.from("customers").update({
      hubspot_company_id: company.id,
      region: byName.region ?? country,
      vertical: byName.vertical ?? industry,
    }).eq("id", byName.id);
    return { id: byName.id, created: false };
  }

  const { data: created, error } = await db.from("customers")
    .insert({ customer_name: name, hubspot_company_id: company.id, region: country, vertical: industry })
    .select("id").single();
  if (error) {
    const { data: again } = await db.from("customers").select("id").ilike("customer_name", name).limit(1);
    if (again?.[0]) {
      await db.from("customers").update({ hubspot_company_id: company.id }).eq("id", again[0].id);
      return { id: again[0].id, created: false };
    }
    throw error;
  }
  return { id: created.id, created: true };
}

export type BackfillResult = {
  companies: number;
  customersCreated: number;
  customersLinked: number;
  deals: number;
  projects: number;
  staged: number;
};

export async function backfillHubSpot(): Promise<BackfillResult> {
  const res: BackfillResult = { companies: 0, customersCreated: 0, customersLinked: 0, deals: 0, projects: 0, staged: 0 };

  // 1) Every company -> a customer.
  const companies = await fetchAllCompanies();
  res.companies = companies.length;
  const customerByCompany = new Map<string, string>();
  for (const c of companies) {
    const { id, created } = await upsertCustomer(c);
    if (id) {
      customerByCompany.set(c.id, id);
      if (created) res.customersCreated++;
      else res.customersLinked++;
    }
  }

  // 2) Every closed-won deal -> a Draft project (with a service line) or the staging inbox.
  const deals = await fetchClosedWonDeals();
  res.deals = deals.length;
  for (const { deal, companyIds } of deals) {
    const companyId = companyIds[0] ?? null;
    let customerId = companyId ? customerByCompany.get(companyId) ?? null : null;
    if (companyId && !customerId) {
      const up = await upsertCustomer(await fetchCompany(companyId));
      customerId = up.id;
      if (up.id) customerByCompany.set(companyId, up.id);
    }
    const sl = resolveServiceLine(String(deal.properties?.service_line ?? ""));
    const start = deal.properties?.closedate ? String(deal.properties.closedate).slice(0, 10) : null;

    if (customerId && sl) {
      const { error } = await db.rpc("import_hubspot_deal", {
        p_deal_id: deal.id,
        p_deal_name: deal.properties?.dealname ?? null,
        p_service_line: sl,
        p_customer_id: customerId,
        p_start: start,
        p_end: null,
      });
      if (error) throw error;
      res.projects++;
    } else {
      const row = {
        hubspot_deal_id: deal.id,
        deal_name: deal.properties?.dealname ?? null,
        amount: deal.properties?.amount ? Number(deal.properties.amount) : null,
        close_date: start,
        pipeline: deal.properties?.pipeline ?? null,
        hubspot_company_id: companyId,
        customer_id: customerId,
        raw: deal,
      };
      const { data: existing } = await db.from("hubspot_deal_imports").select("id, status").eq("hubspot_deal_id", deal.id).maybeSingle();
      if (existing) {
        if (existing.status === "pending") await db.from("hubspot_deal_imports").update(row).eq("id", existing.id);
      } else {
        await db.from("hubspot_deal_imports").insert(row);
      }
      res.staged++;
    }
  }

  return res;
}
