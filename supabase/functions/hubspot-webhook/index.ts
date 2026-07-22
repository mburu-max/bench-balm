// HubSpot webhook receiver (public endpoint).
//
// HubSpot POSTs here when a company is created or a deal reaches Closed-Won. The webhook only
// carries an object id — so we RE-FETCH that object from HubSpot with our token before writing
// anything, which means a spoofed webhook can't inject data (worst case: a harmless re-fetch of a
// real record). A shared secret (?secret= or x-webhook-secret) is checked first.
//
// Mapping:
//   company.*  -> upsert a customer (match by hubspot_company_id, then by name, else create)
//   deal.*     -> if Closed-Won, upsert the deal's company as a customer + stage the deal in
//                 hubspot_deal_imports for an SL Lead to promote into a Draft project.
//
// Secrets (set as edge-function env): HUBSPOT_TOKEN, HUBSPOT_WEBHOOK_SECRET,
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const HUBSPOT_BASE = "https://api.hubapi.com";
// Deals carry the service line in a HubSpot deal property named "service_line". Matching is
// case-insensitive (the property is free text) and resolves to one of these canonical values;
// a deal with a recognised value becomes a Draft project, anything else is staged.
const SERVICE_LINES = ["DLaaS", "CLM", "MS", "CCaaS", "Legacy"];
const resolveServiceLine = (raw: string): string | undefined =>
  SERVICE_LINES.find((s) => s.toLowerCase() === raw.trim().toLowerCase());
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

  // 1) Shared-secret gate.
  const expected = Deno.env.get("HUBSPOT_WEBHOOK_SECRET") ?? "";
  const provided = new URL(req.url).searchParams.get("secret") ?? req.headers.get("x-webhook-secret") ?? "";
  if (!expected || provided !== expected) return json({ error: "Forbidden" }, 403);

  const HUBSPOT_TOKEN = Deno.env.get("HUBSPOT_TOKEN");
  if (!HUBSPOT_TOKEN) return json({ error: "HUBSPOT_TOKEN not configured" }, 500);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const hs = async (path: string) => {
    const r = await fetch(`${HUBSPOT_BASE}${path}`, { headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` } });
    if (!r.ok) throw new Error(`HubSpot GET ${path} → ${r.status}: ${await r.text().catch(() => "")}`);
    return r.json();
  };

  // Company -> customer. Match by hubspot id, then by (existing, manually-created) name, else create.
  // On a match we only link the id + fill blank fields — never overwrite what a person entered.
  async function upsertCustomerByCompanyId(companyId: string): Promise<string | null> {
    const company = await hs(
      `/crm/v3/objects/companies/${companyId}?properties=name,domain,industry,country,city`,
    );
    const name = String(company.properties?.name ?? "").trim();
    if (!name) return null;
    const country = company.properties?.country ?? null;
    const industry = company.properties?.industry ?? null;

    const { data: byId } = await admin
      .from("customers").select("id").eq("hubspot_company_id", company.id).maybeSingle();
    if (byId) return byId.id;

    const { data: byNameRows } = await admin
      .from("customers").select("id, region, vertical").ilike("customer_name", name).limit(1);
    const byName = byNameRows?.[0];
    if (byName) {
      await admin.from("customers").update({
        hubspot_company_id: company.id,
        region: byName.region ?? country,
        vertical: byName.vertical ?? industry,
      }).eq("id", byName.id);
      return byName.id;
    }

    const { data: created, error } = await admin.from("customers").insert({
      customer_name: name,
      hubspot_company_id: company.id,
      region: country,
      vertical: industry,
    }).select("id").single();
    if (error) {
      // Lost a race on the unique customer_name — re-match and link.
      const { data: again } = await admin
        .from("customers").select("id").ilike("customer_name", name).limit(1);
      if (again?.[0]) {
        await admin.from("customers").update({ hubspot_company_id: company.id }).eq("id", again[0].id);
        return again[0].id;
      }
      throw error;
    }
    return created.id;
  }

  // Closed-Won deal -> a Draft project directly (if it has a customer + recognised service line);
  // otherwise it's staged for triage. Idempotent; never clobbers a promoted/dismissed staging row.
  async function upsertDealImport(dealId: string) {
    const deal = await hs(
      `/crm/v3/objects/deals/${dealId}?associations=companies&properties=dealname,amount,dealstage,pipeline,closedate,hs_is_closed_won,service_line`,
    );
    if (deal.properties?.hs_is_closed_won !== "true") return { deal: dealId, skipped: "not closed-won" };

    const companyId = deal.associations?.companies?.results?.[0]?.id ?? null;
    const customerId = companyId ? await upsertCustomerByCompanyId(String(companyId)) : null;
    const serviceLine = resolveServiceLine(String(deal.properties?.service_line ?? ""));
    const startDate = deal.properties?.closedate ? String(deal.properties.closedate).slice(0, 10) : null;

    // Complete deal -> Draft project (pre-approved). The SL Lead then assigns a PM to activate it.
    if (customerId && serviceLine) {
      const { data: projectId, error } = await admin.rpc("import_hubspot_deal", {
        p_deal_id: deal.id,
        p_deal_name: deal.properties?.dealname ?? null,
        p_service_line: serviceLine,
        p_customer_id: customerId,
        p_start: startDate,
        p_end: null,
      });
      if (error) throw error;
      return { deal: dealId, project: projectId, service_line: serviceLine, customer: customerId };
    }

    // Fallback: no company or no recognised service line -> staging inbox for triage.
    const row = {
      hubspot_deal_id: deal.id,
      deal_name: deal.properties?.dealname ?? null,
      amount: deal.properties?.amount ? Number(deal.properties.amount) : null,
      close_date: startDate,
      pipeline: deal.properties?.pipeline ?? null,
      hubspot_company_id: companyId,
      customer_id: customerId,
      raw: deal,
    };
    const reason = customerId ? "no recognised service line on deal" : "deal has no associated company";
    const { data: existing } = await admin
      .from("hubspot_deal_imports").select("id, status").eq("hubspot_deal_id", deal.id).maybeSingle();
    if (existing) {
      if (existing.status === "pending") await admin.from("hubspot_deal_imports").update(row).eq("id", existing.id);
      return { deal: dealId, staged: existing.id, status: existing.status, reason };
    }
    const { data: ins, error } = await admin
      .from("hubspot_deal_imports").insert(row).select("id").single();
    if (error) throw error;
    return { deal: dealId, staged: ins.id, status: "pending", reason };
  }

  try {
    const payload = await req.json().catch(() => []);
    const events = Array.isArray(payload) ? payload : [payload];

    // De-dupe object ids within the batch so we fetch/upsert each once.
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
      try {
        const cid = await upsertCustomerByCompanyId(id);
        results.push({ company: id, customer: cid });
      } catch (e) {
        results.push({ company: id, error: String((e as Error)?.message ?? e) });
      }
    }
    for (const id of dealIds) {
      try {
        results.push(await upsertDealImport(id));
      } catch (e) {
        results.push({ deal: id, error: String((e as Error)?.message ?? e) });
      }
    }

    return json({ ok: true, processed: results.length, results });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
