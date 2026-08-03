// Omni HR sync — edge function with two modes:
//   BACKFILL: body { backfill: true }, JWT-authenticated (Dev/Gov). Lists all Omni employees and
//             upserts them into `resources`.
//   WEBHOOK : Omni posts an event envelope { event, event_id, data }. Verified with the org signing
//             secret via HMAC-SHA256 over "{timestamp}.{rawBody}" (X-Omni-Webhook-* headers).
// Employee lifecycle only (created / terminated / job-change / manager-change). Time-off -> Leave is
// handled separately. Must be public (verify_jwt = false) so Omni can reach it; we verify the HMAC.
// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const OMNI_BASE = (Deno.env.get("OMNI_BASE_URL") ?? "https://api.omnihr.co/api/v1").replace(/\/$/, "");
const SERVICE_LINES = ["DLaaS", "CLM", "MS", "CCaaS", "Legacy"];
const DEFAULT_SERVICE_LINE = "Legacy";

// Omni org tree: Service Line (TOP level) -> Department (2nd level) -> employee. The service line is
// the department's PARENT, not the department name itself. It can arrive two ways:
//   (a) Omni includes the parent/top-level unit in the payload -> we read it directly (mapEmployee).
//   (b) Omni only sends the leaf department -> we map that department UP to its parent line here.
// Fill DEPARTMENT_TO_SERVICE_LINE with each department (lowercase) -> one of SERVICE_LINES.
const DEPARTMENT_TO_SERVICE_LINE: Record<string, string> = {
  // "contract management": "CLM",
  // "managed services desk": "MS",
  // "<department name lowercase>": "<DLaaS|CLM|MS|CCaaS|Legacy>",
};
const SL_ALIASES: Record<string, string> = {
  dlaas: "DLaaS", "digital ledger": "DLaaS", "data & ledger": "DLaaS",
  clm: "CLM", "contract lifecycle": "CLM", "contract management": "CLM", "contract mgmt": "CLM",
  ms: "MS", "managed services": "MS", "managed service": "MS",
  ccaas: "CCaaS", "contact center": "CCaaS", "contact centre": "CCaaS",
  legacy: "Legacy",
};
// Resolve a value to a service line: it may already BE a service line (top-level unit / alias), or a
// 2nd-level department that maps up to one. Unmatched -> default line for an SL Lead to correct.
function resolveServiceLine(value: any): string {
  if (!value) return DEFAULT_SERVICE_LINE;
  const key = String(value).trim().toLowerCase();
  const direct = SERVICE_LINES.find((s) => s.toLowerCase() === key);
  if (direct) return direct;                                  // already a service line
  if (SL_ALIASES[key]) return SL_ALIASES[key];                // alias of a service line
  if (DEPARTMENT_TO_SERVICE_LINE[key]) return DEPARTMENT_TO_SERVICE_LINE[key]; // department -> parent line
  return DEFAULT_SERVICE_LINE;
}

const EMPLOYMENT_TYPES = ["FTE", "Contractor", "Vendor"];
function resolveEmploymentType(emp: any): string {
  const raw = String(emp?.employment_type ?? emp?.type ?? "").trim().toLowerCase();
  if (!raw) return "FTE";
  if (raw.includes("contract") || raw.includes("freelanc") || raw.includes("consultant")) return "Contractor";
  if (raw.includes("vendor")) return "Vendor";
  if (raw.includes("full") || raw.includes("permanent") || raw === "fte" || raw.includes("part")) return "FTE";
  const direct = EMPLOYMENT_TYPES.find((t) => t.toLowerCase() === raw);
  return direct ?? "FTE";
}

// Map an Omni employment status (e.g. "Active", "Terminated") to a resource_status.
function resolveStatus(raw: any): string {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s.includes("terminat") || s.includes("exit") || s.includes("resign")) return "Exited";
  if (s.includes("leave")) return "On_Leave";
  return "Active";
}

// Map an Omni Classification (COS/OPEX) to a default_allocation_type. Null if not present/unknown
// (the generic sandbox has no Classification field — this only fires in the real Execo tenant).
function resolveClassification(raw: any): string | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s.includes("cos") || s.includes("cost of sale") || s.includes("billable")) return "COS";
  if (s.includes("opex") || s.includes("operating") || s.includes("overhead") || s.includes("non-billable") || s.includes("non billable")) return "OPEX";
  return null;
}

// Omni's leave/calendar endpoints return dates as DD/MM/YYYY; our allocations use ISO (YYYY-MM-DD).
function ddmmyyyyToIso(s: any): string | null {
  const m = String(s ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Build a resources row from an Omni employee object. Field names verified against the live
// /employee/list/ response (flat department, primary_email.value, employee_type,
// employment_status_display, location_name); webhook `data` (nested job/employment) is handled as a
// fallback so both the backfill and the webhook path work.
function mapEmployee(d: any) {
  const job = d.job ?? {};
  const emp = d.employment ?? {};
  const fullName =
    (d.preferred_name && String(d.preferred_name).trim()) ||
    (d.full_name && String(d.full_name).trim()) ||
    [d.first_name, d.last_name].filter(Boolean).join(" ").trim() ||
    (d.full_legal_name && String(d.full_legal_name).trim()) ||
    (d.employee_id ? `Employee ${d.employee_id}` : "Unknown");
  const department = d.department ?? job.department ?? null;
  // Service line is an Execo custom field ("Service Line") — the generic sandbox has none, so it
  // falls back to mapping the department. Reads the custom field / a parent field if present.
  const serviceLineRaw =
    d.service_line ?? d["Service Line"] ?? job.service_line ?? job.business_unit ?? job.division ?? null;
  const mgrRaw = d.manager_name ?? d.manager ?? job.manager ?? null;
  const managerName = typeof mgrRaw === "string"
    ? mgrRaw
    : (mgrRaw ? [mgrRaw.first_name ?? mgrRaw.preferred_name, mgrRaw.last_name].filter(Boolean).join(" ").trim() : null);
  return {
    omni_id: String(d.employee_id ?? d.id),
    full_name: fullName,
    email: d.primary_email?.value ?? d.email ?? d.work_email ?? null,
    position: d.position ?? job.position ?? job.title ?? null,
    department,
    location: d.location_name ?? d.location ?? job.location ?? d.country ?? null,
    manager_name: managerName || null,
    service_line: resolveServiceLine(serviceLineRaw ?? department),
    employment_type: resolveEmploymentType({ employment_type: d.employee_type ?? emp.employment_type ?? emp.type }),
    status: resolveStatus(d.employment_status_display ?? d.status),
    omni_hr_sync_status: "synced",
  };
}

// ---- CSV report parsing ----
// The report endpoint (/employee/report/employees/) returns text/csv — the only source that carries
// Manager Name and the org's custom fields (Service Line / Classification in the real Execo tenant).
// RFC-4180-ish parser: handles quoted fields, embedded commas/newlines, and "" escapes.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r") { /* ignore, handled by \n */ }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}
function csvToObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => { const o: Record<string, string> = {}; header.forEach((h, i) => (o[h] = r[i] ?? "")); return o; });
}
// Find a report value by fuzzy header match (case-insensitive substring) — custom fields arrive as
// "Group | Field" columns, so the exact header is unknown (e.g. "Delivery | Service Line").
function reportField(row: Record<string, string>, needle: string): string | null {
  for (const key of Object.keys(row)) {
    if (key.toLowerCase().includes(needle)) {
      const v = row[key];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
  }
  return null;
}
// Build a resources row from one CSV report record (standard columns by exact name; Service Line /
// Classification by fuzzy match since they're custom fields).
function mapReportRow(row: Record<string, string>) {
  const get = (k: string) => { const v = row[k]; return v != null && String(v).trim() !== "" ? String(v).trim() : null; };
  const empId = get("Employee ID") ?? get("System ID");
  const fullName =
    get("Preferred Name") ||
    [get("First Name"), get("Last Name")].filter(Boolean).join(" ").trim() ||
    get("Full Legal Name") ||
    (empId ? `Employee ${empId}` : "Unknown");
  const department = get("Department");
  const serviceLineRaw = reportField(row, "service line");   // custom field — real tenant only
  const classification = reportField(row, "classification"); // COS/OPEX — real tenant only
  const out: Record<string, any> = {
    omni_id: String(empId ?? ""),
    full_name: fullName,
    email: get("Work Email") ?? get("Personal Email"),
    position: get("Position"),
    department,
    location: get("Location") ?? get("Location Country") ?? get("Country"),
    manager_name: get("Manager Name"),
    service_line: resolveServiceLine(serviceLineRaw ?? department),
    employment_type: resolveEmploymentType({ employment_type: get("Employment Type") }),
    status: resolveStatus(get("Employment Status")),
    omni_hr_sync_status: "synced",
  };
  const alloc = resolveClassification(classification);
  if (alloc) out.default_allocation_type = alloc; // only when Classification is present (real tenant)
  return out;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function verifySignature(secret: string, timestamp: string, rawBody: string, signature: string) {
  if (!secret || !timestamp || !signature) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${rawBody}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const expected = `sha256=${hex}`;
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const OMNI_TOKEN = Deno.env.get("OMNI_TOKEN");
    // Omni scopes the API to a tenant via an X-Subdomain header (e.g. "integrationtest"). REQUIRED —
    // without it the API returns "invalid email or password" / 404s, as it can't resolve the tenant.
    const OMNI_SUBDOMAIN = Deno.env.get("OMNI_SUBDOMAIN");
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const omniHeaders = (auth: string): Record<string, string> => {
      const h: Record<string, string> = { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" };
      if (OMNI_SUBDOMAIN) h["X-Subdomain"] = OMNI_SUBDOMAIN;
      return h;
    };
    // A PAT (omni_pat_...) is NOT accepted directly on data endpoints — it must be exchanged for a
    // short-lived JWT via /auth/token/pat/. Exchange once per invocation and reuse. (A non-PAT value
    // is assumed to already be a JWT.)
    let omniJwt: string | null = null;
    const getOmniJwt = async (): Promise<string> => {
      if (omniJwt) return omniJwt;
      if (OMNI_TOKEN && OMNI_TOKEN.startsWith("omni_pat_")) {
        const res = await fetch(`${OMNI_BASE}/auth/token/pat/`, { method: "POST", headers: omniHeaders(OMNI_TOKEN) });
        if (!res.ok) throw new Error(`Omni PAT exchange -> ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
        omniJwt = (await res.json()).access;
      } else {
        omniJwt = OMNI_TOKEN ?? "";
      }
      return omniJwt!;
    };
    // Fetch with a hard timeout so a slow/hung Omni fails cleanly (caught -> 500) instead of leaving the
    // whole invocation hanging until the platform kills it — which surfaces to the browser as
    // ERR_CONNECTION_CLOSED (no HTTP response at all).
    const omniFetch = async (path: string): Promise<Response> => {
      const jwt = await getOmniJwt();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      try {
        const res = await fetch(`${OMNI_BASE}${path}`, { headers: omniHeaders(jwt), signal: ctrl.signal });
        if (!res.ok) throw new Error(`Omni ${path} -> ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
        return res;
      } finally {
        clearTimeout(timer);
      }
    };
    const omni = async (path: string) => (await omniFetch(path)).json();
    // Same auth, but returns the raw body (the report endpoint serves text/csv, not JSON).
    const omniText = async (path: string): Promise<string> => (await omniFetch(path)).text();

    const upsertEmployee = async (d: any) => {
      const row = mapEmployee(d);
      const { error } = await admin
        .from("resources")
        .upsert(row, { onConflict: "omni_id", ignoreDuplicates: false });
      if (error) throw error;
      return row.omni_id;
    };

    const setStatusByOmniId = async (omniId: string, status: string) => {
      const { error } = await admin
        .from("resources")
        .update({ status, omni_hr_sync_status: "synced" })
        .eq("omni_id", String(omniId));
      if (error) throw error;
    };

    // Apply a job/manager change to an existing resource (only the fields we track).
    const applyChange = async (omniId: string, patch: Record<string, any>) => {
      const clean: Record<string, any> = { omni_hr_sync_status: "synced" };
      for (const [k, v] of Object.entries(patch)) if (v !== undefined && v !== null) clean[k] = v;
      const { error } = await admin.from("resources").update(clean).eq("omni_id", String(omniId));
      if (error) throw error;
    };

    // Core: upsert a Leave allocation for a resource, deduped by the Omni time-off request id.
    // Shared by the webhook (approved event) and the backfill (who-is-out sweep).
    const upsertLeaveCore = async (omniId: string, timeOffId: string, startDate: string, endDate: string, remarks: string) => {
      if (!omniId || !timeOffId || !startDate || !endDate) return { skipped: "missing omniId/timeOffId/dates" };
      const { data: res } = await admin
        .from("resources")
        .select("id, full_name, omni_id, service_line")
        .eq("omni_id", String(omniId))
        .maybeSingle();
      if (!res) return { skipped: `no resource for ${omniId}` };
      const row = {
        resource_id: res.id,
        omni_id: res.omni_id,
        resource_name: res.full_name,
        service_line: res.service_line,
        allocation_type: "Leave",
        allocation_start_date: startDate,
        allocation_end_date: endDate,
        allocation_pct: 100,
        remarks: remarks || "Omni time-off",
        omni_time_off_id: String(timeOffId),
      };
      const { data: existing } = await admin
        .from("allocations")
        .select("id")
        .eq("omni_time_off_id", String(timeOffId))
        .maybeSingle();
      if (existing) {
        const { error } = await admin.from("allocations").update(row).eq("id", existing.id);
        if (error) throw error;
        return { leave: "updated", omni_time_off_id: String(timeOffId) };
      }
      const { error } = await admin.from("allocations").insert(row);
      if (error) throw error;
      return { leave: "created", omni_time_off_id: String(timeOffId) };
    };
    // Webhook shape (time_off.request_approved): dates are already ISO; user carries employee_id.
    const upsertLeave = async (d: any) =>
      upsertLeaveCore(
        String(d.user?.employee_id ?? d.user?.id ?? ""),
        String(d.id ?? ""),
        d.start_date,
        d.end_date,
        `Omni time-off${d.time_off_type ? ` (${d.time_off_type})` : ""}${d.reason ? ` — ${d.reason}` : ""}`,
      );

    // Cancelled / rejected time-off -> remove the Leave allocation it created (if any).
    const removeLeave = async (d: any) => {
      const timeOffId = String(d.id ?? "");
      if (!timeOffId) return { skipped: "missing request id" };
      const { error } = await admin.from("allocations").delete().eq("omni_time_off_id", timeOffId);
      if (error) throw error;
      return { leave: "removed", omni_time_off_id: timeOffId };
    };

    // ---- List employees ----
    // /employee/list/ returns clean paginated JSON ({count,next,results:[...]}) with the core fields
    // (verified live in the integrationtest sandbox): employee_id, full_name/preferred_name,
    // primary_email.value, position, department, location_name, employee_type, employment_status_display.
    // It has NO manager/service-line/classification — those are custom fields that come from the CSV
    // report endpoint (/employee/report/employees/) in the real Execo tenant. Override via OMNI_LIST_PATH.
    const listEmployees = async (): Promise<any[]> => {
      const out: any[] = [];
      let path: string | null = Deno.env.get("OMNI_LIST_PATH") ?? "/employee/list/";
      let guard = 0;
      while (path && guard++ < 50) {
        const page: any = await omni(path);
        const rows = Array.isArray(page) ? page : (page.results ?? page.data ?? page.employees ?? []);
        out.push(...rows);
        const next = page && !Array.isArray(page) ? page.next : null;
        path = next ? String(next).replace(OMNI_BASE, "") : null;
      }
      return out;
    };

    // Report-based roster: the CSV report is the only source with Manager Name + custom fields
    // (Service Line / Classification). Returns already-mapped resources rows, deduped by Employee ID
    // (the report can repeat a person across records — prefer their Active row).
    // Deduped raw report rows (keyed by Employee ID, or System ID when blank — prefers the Active row).
    const fetchReportObjects = async (): Promise<Record<string, string>[]> => {
      const path = Deno.env.get("OMNI_REPORT_PATH") ?? "/employee/report/employees/";
      const objs = csvToObjects(await omniText(path));
      const byId = new Map<string, Record<string, string>>();
      for (const o of objs) {
        // Employee ID can be blank (e.g. a just-created hire) — the CSV gives "" not null, so `??`
        // won't fall through. Use `||` so an empty Employee ID falls back to the always-present System ID.
        const id = String(o["Employee ID"] ?? "").trim() || String(o["System ID"] ?? "").trim();
        if (!id) continue;
        const existing = byId.get(id);
        if (!existing) { byId.set(id, o); continue; }
        const isActive = String(o["Employment Status"] ?? "").toLowerCase().includes("active");
        const existingActive = String(existing["Employment Status"] ?? "").toLowerCase().includes("active");
        if (isActive && !existingActive) byId.set(id, o);
      }
      return [...byId.values()];
    };
    const listFromReport = async (): Promise<any[]> => (await fetchReportObjects()).map(mapReportRow);

    // Approved leave, org-wide, from who-is-out — returns its `employee` array (approved absences only,
    // verified: only status-3 requests appear). Each has user.system_id, effective_date/end_date
    // (DD/MM/YYYY), payload (days), remark, and id (the time-off request id, for dedup).
    const listApprovedLeave = async (fromDDMM: string, toDDMM: string): Promise<any[]> => {
      const res: any = await omni(`/employee/who-is-out/?start_date=${fromDDMM}&end_date=${toDDMM}`);
      return Array.isArray(res?.employee) ? res.employee : [];
    };

    // Upsert an already-mapped resources row (backfill path — rows come pre-mapped).
    const upsertRow = async (row: any) => {
      const { error } = await admin.from("resources").upsert(row, { onConflict: "omni_id", ignoreDuplicates: false });
      if (error) throw error;
      return row.omni_id;
    };

    const body = await req.text();

    // ---------- BACKFILL MODE ----------
    let parsed: any = null;
    try { parsed = JSON.parse(body); } catch { /* not JSON */ }

    if (parsed && parsed.backfill === true) {
      if (!OMNI_TOKEN) return json({ error: "OMNI_TOKEN is not set as an edge-function secret" }, 500);
      // Gate: only a Developer or Governance Lead may run a backfill.
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? serviceKey;
      const asCaller = createClient(url, anonKey, {
        global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
        auth: { persistSession: false },
      });
      const { data: { user } } = await asCaller.auth.getUser();
      if (!user) return json({ error: "Not authenticated" }, 401);
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
      const allowed = (roles ?? []).some((r: any) => ["developer", "admin", "governance_lead"].includes(r.role));
      if (!allowed) return json({ error: "Forbidden — Developer or Governance Lead only" }, 403);

      // Default to the CSV report (has Manager Name + Service Line/Classification); fall back to the
      // clean JSON list endpoint if the report is unavailable/empty. Force with OMNI_BACKFILL_SOURCE.
      const source = (Deno.env.get("OMNI_BACKFILL_SOURCE") ?? "report").toLowerCase();
      const errors: string[] = [];
      let rows: any[] = [];
      let reportObjs: Record<string, string>[] = [];
      let used = "report";
      if (source !== "list") {
        try { reportObjs = await fetchReportObjects(); rows = reportObjs.map(mapReportRow); }
        catch (err) { errors.push(`report source failed: ${String((err as Error)?.message ?? err).slice(0, 120)}`); }
      }
      if (rows.length === 0) { rows = (await listEmployees()).map(mapEmployee); used = "list"; }

      // Bulk-upsert in ONE round-trip. Per-row was one request each — tolerable for 36, but 451 real
      // Execo employees would blow the invocation's time budget and surface as ERR_CONNECTION_CLOSED.
      // Fall back to per-row only if the batch fails, to isolate the offending record.
      let synced = 0;
      if (rows.length) {
        const { error } = await admin.from("resources").upsert(rows, { onConflict: "omni_id", ignoreDuplicates: false });
        if (error) {
          for (const row of rows) {
            try { await upsertRow(row); synced++; }
            catch (err) { errors.push(String((err as Error)?.message ?? err).slice(0, 150)); }
          }
        } else {
          synced = rows.length;
        }
      }
      const managers = rows.filter((r) => r.manager_name).length;

      // ---- Leave backfill (report mode) ----
      // Pull approved time-off from who-is-out and upsert Leave allocations. Bridge who-is-out's
      // user.system_id -> our omni_id via the report's System ID column. Window: ~1 month back
      // (catch in-effect leave) to 1 year ahead (upcoming). Dedup + webhooks share omni_time_off_id.
      let leave = 0;
      if (reportObjs.length) {
        try {
          const sysToOmni = new Map<string, string>();
          for (const o of reportObjs) {
            const sysId = String(o["System ID"] ?? "").trim();
            const omniId = String(o["Employee ID"] ?? "").trim() || sysId;
            if (sysId) sysToOmni.set(sysId, omniId);
          }
          const pad = (n: number) => String(n).padStart(2, "0");
          const ddmm = (dt: Date) => `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()}`;
          const now = new Date();
          const from = new Date(now); from.setDate(from.getDate() - 31);
          const to = new Date(now); to.setFullYear(to.getFullYear() + 1);
          for (const a of await listApprovedLeave(ddmm(from), ddmm(to))) {
            const omniId = sysToOmni.get(String(a.user?.system_id ?? "").trim());
            const startISO = ddmmyyyyToIso(a.effective_date);
            const endISO = ddmmyyyyToIso(a.end_date);
            if (!omniId || !startISO || !endISO) continue;
            try {
              const r = await upsertLeaveCore(omniId, String(a.id), startISO, endISO, a.remark ?? "Omni time-off");
              if ((r as any).leave) leave++;
            } catch (err) { errors.push(`leave ${a.id}: ${String((err as Error)?.message ?? err).slice(0, 100)}`); }
          }
        } catch (err) { errors.push(`leave backfill: ${String((err as Error)?.message ?? err).slice(0, 120)}`); }
      }

      return json({ ok: true, source: used, employees: rows.length, synced, managers, leave, errors: errors.slice(0, 5) });
    }

    // ---------- WEBHOOK MODE ----------
    const secret = Deno.env.get("OMNI_WEBHOOK_SECRET") ?? "";
    const ts = req.headers.get("X-Omni-Webhook-Timestamp") ?? "";
    const sig = req.headers.get("X-Omni-Webhook-Signature") ?? "";
    const valid = await verifySignature(secret, ts, body, sig);
    if (!valid) return json({ error: "Invalid signature" }, 400);

    const event = parsed?.event as string | undefined;
    const d = parsed?.data ?? {};
    if (!event) return json({ error: "Missing event" }, 400);
    const omniId = String(d.employee_id ?? d.id ?? "");

    let result: any = { event, handled: true };
    switch (event) {
      case "employee.created":
        result.omni_id = await upsertEmployee(d);
        break;
      case "employee.terminated":
        await setStatusByOmniId(omniId, "Exited");
        result.omni_id = omniId;
        break;
      case "employee.scheduled_job_change": {
        const nj = d.job_change?.new_job ?? {};
        const njSl = nj.service_line ?? nj.business_unit ?? nj.division ?? nj.department;
        await applyChange(omniId, {
          position: nj.position ?? nj.title ?? undefined,
          department: nj.department ?? undefined,
          location: nj.location ?? undefined,
          service_line: njSl ? resolveServiceLine(njSl) : undefined,
        });
        result.omni_id = omniId;
        break;
      }
      case "employee.scheduled_manager_change": {
        const nm = d.manager_change?.new_manager ?? {};
        const nmName = [nm.first_name ?? nm.preferred_name, nm.last_name].filter(Boolean).join(" ").trim();
        await applyChange(omniId, { manager_name: nmName || undefined });
        result.omni_id = omniId;
        break;
      }
      case "time_off.request_approved":
        result = { event, ...(await upsertLeave(d)) };
        break;
      case "time_off.request_cancelled":
      case "time_off.request_rejected":
        result = { event, ...(await removeLeave(d)) };
        break;
      default:
        result = { event, handled: false, note: "no-op for this event" };
    }
    return json({ ok: true, ...result });
  } catch (outer) {
    return json({ error: String((outer as Error)?.message ?? outer) }, 500);
  }
});
