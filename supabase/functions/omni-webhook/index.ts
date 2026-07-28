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
  if (raw.includes("contract")) return "Contractor";
  if (raw.includes("vendor")) return "Vendor";
  if (raw.includes("full") || raw.includes("permanent") || raw === "fte") return "FTE";
  const direct = EMPLOYMENT_TYPES.find((t) => t.toLowerCase() === raw);
  return direct ?? "FTE";
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Build a resources row from an Omni employee object (webhook `data` or a list row). Defensive:
// Omni may nest job fields under `job` or send them flat; we read both shapes.
function mapEmployee(d: any) {
  const job = d.job ?? {};
  const emp = d.employment ?? {};
  const fullName =
    (d.preferred_name && String(d.preferred_name).trim()) ||
    [d.first_name, d.last_name].filter(Boolean).join(" ").trim() ||
    (d.full_legal_name && String(d.full_legal_name).trim()) ||
    (d.employee_id ? `Employee ${d.employee_id}` : "Unknown");
  const department = job.department ?? d.department ?? null;
  // Service line = the TOP-level org unit. Prefer an explicit parent field if Omni sends one; else
  // fall back to mapping the (2nd-level) department up to its parent line via resolveServiceLine.
  const serviceLineRaw =
    job.service_line ?? job.business_unit ?? job.division ?? job.department_group ??
    d.service_line ?? d.business_unit ?? null;
  const mgr = job.manager ?? d.manager ?? null;
  const managerName = mgr
    ? [mgr.first_name ?? mgr.preferred_name, mgr.last_name].filter(Boolean).join(" ").trim() || (typeof mgr === "string" ? mgr : null)
    : null;
  return {
    omni_id: String(d.employee_id ?? d.id),
    full_name: fullName,
    email: d.email ?? null,
    position: job.position ?? job.title ?? job.job_title ?? d.position ?? null,
    department,
    location: job.location ?? d.location ?? null,
    manager_name: managerName,
    service_line: resolveServiceLine(serviceLineRaw ?? department),
    employment_type: resolveEmploymentType(emp),
    omni_hr_sync_status: "synced",
  };
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
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const omni = async (path: string) => {
      const res = await fetch(`${OMNI_BASE}${path}`, {
        headers: { Authorization: `Bearer ${OMNI_TOKEN}`, "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(`Omni ${path} -> ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
      return res.json();
    };

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

    // Approved time-off -> a Leave allocation on the resource (deduped by the time-off request id).
    const upsertLeave = async (d: any) => {
      const empId = String(d.user?.employee_id ?? d.user?.id ?? "");
      const timeOffId = String(d.id ?? "");
      if (!empId || !timeOffId) return { skipped: "missing user or request id" };
      const { data: res } = await admin
        .from("resources")
        .select("id, full_name, omni_id, service_line")
        .eq("omni_id", empId)
        .maybeSingle();
      if (!res) return { skipped: `no resource for employee ${empId}` };
      const row = {
        resource_id: res.id,
        omni_id: res.omni_id,
        resource_name: res.full_name,
        service_line: res.service_line,
        allocation_type: "Leave",
        allocation_start_date: d.start_date,
        allocation_end_date: d.end_date,
        allocation_pct: 100,
        remarks: `Omni time-off${d.time_off_type ? ` (${d.time_off_type})` : ""}${d.reason ? ` — ${d.reason}` : ""}`,
        omni_time_off_id: timeOffId,
      };
      const { data: existing } = await admin
        .from("allocations")
        .select("id")
        .eq("omni_time_off_id", timeOffId)
        .maybeSingle();
      if (existing) {
        const { error } = await admin.from("allocations").update(row).eq("id", existing.id);
        if (error) throw error;
        return { leave: "updated", omni_time_off_id: timeOffId };
      }
      const { error } = await admin.from("allocations").insert(row);
      if (error) throw error;
      return { leave: "created", omni_time_off_id: timeOffId };
    };

    // Cancelled / rejected time-off -> remove the Leave allocation it created (if any).
    const removeLeave = async (d: any) => {
      const timeOffId = String(d.id ?? "");
      if (!timeOffId) return { skipped: "missing request id" };
      const { error } = await admin.from("allocations").delete().eq("omni_time_off_id", timeOffId);
      if (error) throw error;
      return { leave: "removed", omni_time_off_id: timeOffId };
    };

    // ---- List employees ----
    // Default to the report endpoint: /employee/report/employees/ almost certainly returns the
    // "Resource Type Report" data (Service Line / Department / Classification / Emp Type / Manager /
    // Location) whose shape we've validated against the Excel export. Alternatives if that doesn't
    // fit: /employee/list/ or /employee/list/min-v2/. Override via OMNI_LIST_PATH without a redeploy.
    // Field mapping (mapEmployee) is finalised on the first authenticated call — the docs' response
    // samples are interactive and not in the reference text.
    const listEmployees = async (): Promise<any[]> => {
      const out: any[] = [];
      let path: string | null = Deno.env.get("OMNI_LIST_PATH") ?? "/employee/report/employees/";
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

      const employees = await listEmployees();
      let synced = 0;
      const errors: string[] = [];
      for (const e of employees) {
        try { await upsertEmployee(e); synced++; }
        catch (err) { errors.push(String((err as Error)?.message ?? err).slice(0, 150)); }
      }
      return json({ ok: true, employees: employees.length, synced, errors: errors.slice(0, 5) });
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
