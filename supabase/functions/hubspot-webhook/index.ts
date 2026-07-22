// HubSpot sync edge function — two modes in one endpoint:
//
//   • WEBHOOK  (HubSpot → us): body is an array of events, gated by a shared ?secret=. We re-fetch
//     each object from HubSpot (so a spoofed webhook can't inject data) and upsert it.
//   • BACKFILL (app → us): body is { backfill: true } with a Supabase JWT. We verify the caller is
//     Developer/Governance, then import ALL companies + closed-won deals (for records that already
//     exist — webhooks only fire on future changes).
//
// company.*  -> customer (match by hubspot_company_id, then name, else create; never clobbers).
// deal Closed-Won -> a Draft project (if it has a company + recognised service line) or staging.
//
// Secrets: HUBSPOT_TOKEN, HUBSPOT_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// SUPABASE_ANON_KEY.
// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const HUBSPOT_BASE = "https://api.hubapi.com";
const COMPANY_PROPS = "name,domain,industry,country,city";
const DEAL_PROPS = "dealname,amount,dealstage,pipeline,closedate,hs_is_closed_won,service_line,hubspot_owner_id";
const SERVICE_LINES = ["DLaaS", "CLM", "MS", "CCaaS", "Legacy"];
const resolveServiceLine = (raw: string): string | undefined =>
  SERVICE_LINES.find((s) => s.toLowerCase() === String(raw).trim().toLowerCase());

// Map a HubSpot company Country to the app's Region group. Unknown countries fall back to the raw
// value so at least something shows; a company with no country stays blank.
const REGION_BY_COUNTRY: Record<string, string> = {
  "united states": "North America", "united states of america": "North America", usa: "North America",
  us: "North America", canada: "North America", mexico: "North America",
  "united kingdom": "EMEA", uk: "EMEA", england: "EMEA", ireland: "EMEA", germany: "EMEA", france: "EMEA",
  spain: "EMEA", italy: "EMEA", netherlands: "EMEA", belgium: "EMEA", sweden: "EMEA", norway: "EMEA",
  denmark: "EMEA", finland: "EMEA", poland: "EMEA", switzerland: "EMEA", austria: "EMEA", portugal: "EMEA",
  kenya: "EMEA", "south africa": "EMEA", nigeria: "EMEA", egypt: "EMEA", ghana: "EMEA", morocco: "EMEA",
  india: "APAC", china: "APAC", japan: "APAC", singapore: "APAC", philippines: "APAC", australia: "APAC",
  "new zealand": "APAC", indonesia: "APAC", malaysia: "APAC", thailand: "APAC", vietnam: "APAC",
  "south korea": "APAC", "hong kong": "APAC", taiwan: "APAC",
  brazil: "Latin America", argentina: "Latin America", chile: "Latin America", colombia: "Latin America",
  peru: "Latin America",
  "united arab emirates": "Middle East", uae: "Middle East", "saudi arabia": "Middle East",
  qatar: "Middle East", kuwait: "Middle East", israel: "Middle East", turkey: "Middle East",
  bahrain: "Middle East", oman: "Middle East",
};
const regionForCountry = (country: any): string | null => {
  if (!country) return null;
  const c = String(country).trim();
  return REGION_BY_COUNTRY[c.toLowerCase()] ?? c;
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const HUBSPOT_TOKEN = Deno.env.get("HUBSPOT_TOKEN");
  if (!HUBSPOT_TOKEN) return json({ error: "HUBSPOT_TOKEN is not set as an edge-function secret." }, 500);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const hs = async (path: string) => {
    const r = await fetch(`${HUBSPOT_BASE}${path}`, { headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` } });
    if (!r.ok) throw new Error(`HubSpot GET ${path} → ${r.status}: ${await r.text().catch(() => "")}`);
    return r.json();
  };

  // ---- upsert helpers (operate on already-fetched HubSpot objects) --------------------------
  async function upsertCustomerFromCompany(company: any): Promise<{ id: string | null; created: boolean }> {
    const name = String(company.properties?.name ?? "").trim();
    if (!name) return { id: null, created: false };
    const region = regionForCountry(company.properties?.country);
    const industry = company.properties?.industry ?? null;

    const { data: byId } = await admin.from("customers").select("id").eq("hubspot_company_id", company.id).maybeSingle();
    if (byId) return { id: byId.id, created: false };

    const { data: byNameRows } = await admin.from("customers").select("id, region, vertical").ilike("customer_name", name).limit(1);
    const byName = byNameRows?.[0];
    if (byName) {
      await admin.from("customers").update({
        hubspot_company_id: company.id,
        hubspot_sync_status: "synced",
        region: byName.region ?? region,
        vertical: byName.vertical ?? industry,
      }).eq("id", byName.id);
      return { id: byName.id, created: false };
    }

    const { data: created, error } = await admin.from("customers").insert({
      customer_name: name, hubspot_company_id: company.id, hubspot_sync_status: "synced",
      region, vertical: industry,
    }).select("id").single();
    if (error) {
      const { data: again } = await admin.from("customers").select("id").ilike("customer_name", name).limit(1);
      if (again?.[0]) {
        await admin.from("customers").update({ hubspot_company_id: company.id, hubspot_sync_status: "synced" }).eq("id", again[0].id);
        return { id: again[0].id, created: false };
      }
      throw error;
    }
    return { id: created.id, created: true };
  }

  const upsertCustomerByCompanyId = async (companyId: string) =>
    upsertCustomerFromCompany(await hs(`/crm/v3/objects/companies/${companyId}?properties=${COMPANY_PROPS}`));

  // Resolve a HubSpot owner id to a display name (for the Sales POC).
  async function ownerNameFor(ownerId: any): Promise<string | null> {
    if (!ownerId) return null;
    try {
      const o = await hs(`/crm/v3/owners/${ownerId}`);
      const name = [o.firstName, o.lastName].filter(Boolean).join(" ").trim();
      return name || o.email || null;
    } catch {
      return null;
    }
  }

  async function processDeal(deal: any) {
    if (deal.properties?.hs_is_closed_won !== "true") return { deal: deal.id, skipped: "not closed-won" };
    const companyId = deal.associations?.companies?.results?.[0]?.id ?? null;
    const customerId = companyId ? (await upsertCustomerByCompanyId(String(companyId))).id : null;
    const sl = resolveServiceLine(deal.properties?.service_line ?? "");
    const start = deal.properties?.closedate ? String(deal.properties.closedate).slice(0, 10) : null;

    // Enrich the linked customer from the deal: add its service line, and set the Sales POC to the
    // deal owner (only if not already set — never clobber a human-entered value).
    if (customerId) {
      const { data: cust } = await admin.from("customers").select("service_lines, account_manager").eq("id", customerId).single();
      const patch: any = {};
      const current: string[] = cust?.service_lines ?? [];
      if (sl && !current.includes(sl)) patch.service_lines = [...current, sl];
      if (!cust?.account_manager) {
        const owner = await ownerNameFor(deal.properties?.hubspot_owner_id);
        if (owner) patch.account_manager = owner;
      }
      if (Object.keys(patch).length) await admin.from("customers").update(patch).eq("id", customerId);
    }

    if (customerId && sl) {
      const { data: projectId, error } = await admin.rpc("import_hubspot_deal", {
        p_deal_id: deal.id, p_deal_name: deal.properties?.dealname ?? null,
        p_service_line: sl, p_customer_id: customerId, p_start: start, p_end: null,
      });
      if (error) throw error;
      return { deal: deal.id, project: projectId };
    }

    const row = {
      hubspot_deal_id: deal.id, deal_name: deal.properties?.dealname ?? null,
      amount: deal.properties?.amount ? Number(deal.properties.amount) : null,
      close_date: start, pipeline: deal.properties?.pipeline ?? null,
      hubspot_company_id: companyId, customer_id: customerId, raw: deal,
    };
    const { data: existing } = await admin.from("hubspot_deal_imports").select("id, status").eq("hubspot_deal_id", deal.id).maybeSingle();
    if (existing) { if (existing.status === "pending") await admin.from("hubspot_deal_imports").update(row).eq("id", existing.id); }
    else await admin.from("hubspot_deal_imports").insert(row);
    return { deal: deal.id, staged: true };
  }

  const upsertDealById = async (dealId: string) =>
    processDeal(await hs(`/crm/v3/objects/deals/${dealId}?associations=companies&properties=${DEAL_PROPS}`));

  // Full backfill: page through ALL companies + closed-won deals.
  async function runBackfill() {
    const res = { companies: 0, customersCreated: 0, customersLinked: 0, deals: 0, projects: 0, staged: 0 };
    let after: string | undefined;
    do {
      const q = new URLSearchParams({ limit: "100", properties: COMPANY_PROPS });
      if (after) q.set("after", after);
      const page = await hs(`/crm/v3/objects/companies?${q}`);
      for (const c of page.results ?? []) {
        res.companies++;
        const { id, created } = await upsertCustomerFromCompany(c);
        if (id) created ? res.customersCreated++ : res.customersLinked++;
      }
      after = page.paging?.next?.after;
    } while (after);

    after = undefined;
    do {
      const q = new URLSearchParams({ limit: "100", associations: "companies", properties: DEAL_PROPS });
      if (after) q.set("after", after);
      const page = await hs(`/crm/v3/objects/deals?${q}`);
      for (const d of page.results ?? []) {
        if (d.properties?.hs_is_closed_won !== "true") continue;
        res.deals++;
        const r = await processDeal(d);
        if ((r as any).project) res.projects++;
        else if ((r as any).staged) res.staged++;
      }
      after = page.paging?.next?.after;
    } while (after);
    return res;
  }

  const body = await req.json().catch(() => null);

  // ---- BACKFILL mode (authenticated app call) -----------------------------------------------
  if (body && body.backfill === true) {
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? serviceKey;
    const asCaller = createClient(url, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await asCaller.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
    const roleSet = new Set((roles ?? []).map((r: any) => r.role));
    if (!(roleSet.has("developer") || roleSet.has("admin") || roleSet.has("governance_lead"))) {
      return json({ error: "Forbidden: Developer or Governance role required" }, 403);
    }
    try {
      return json({ ok: true, ...(await runBackfill()) });
    } catch (e) {
      return json({ error: String((e as Error)?.message ?? e) }, 500);
    }
  }

  // ---- WEBHOOK mode (HubSpot events, shared-secret gated) ------------------------------------
  const expected = Deno.env.get("HUBSPOT_WEBHOOK_SECRET") ?? "";
  const provided = new URL(req.url).searchParams.get("secret") ?? req.headers.get("x-webhook-secret") ?? "";
  if (!expected || provided !== expected) return json({ error: "Forbidden" }, 403);

  try {
    const events = Array.isArray(body) ? body : body ? [body] : [];
    const companyIds = new Set<string>();
    const dealIds = new Set<string>();
    for (const ev of events) {
      const type = String(ev?.subscriptionType ?? "");
      const objectId = ev?.objectId ?? ev?.hs_object_id;
      if (objectId == null) continue;
      if (type.startsWith("company.")) companyIds.add(String(objectId));
      else if (type.startsWith("deal.")) dealIds.add(String(objectId));
    }
    const results: unknown[] = [];
    for (const id of companyIds) {
      try { const c = await upsertCustomerByCompanyId(id); results.push({ company: id, customer: c.id }); }
      catch (e) { results.push({ company: id, error: String((e as Error)?.message ?? e) }); }
    }
    for (const id of dealIds) {
      try { results.push(await upsertDealById(id)); }
      catch (e) { results.push({ deal: id, error: String((e as Error)?.message ?? e) }); }
    }
    return json({ ok: true, processed: results.length, results });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
  } catch (outer) {
    // Catch-all so any failure returns a readable message instead of dropping the connection.
    return json({ error: String((outer as Error)?.message ?? outer) }, 500);
  }
});
