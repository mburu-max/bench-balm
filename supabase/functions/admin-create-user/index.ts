// Admin-only "create user" endpoint. Uses the service-role key (server-side only) to
// provision a login, then assigns the chosen role + service-line memberships.
// The caller's JWT is verified to hold the developer role before anything happens.
// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SL_ROLES = ["service_line_lead", "delivery_lead"];

Deno.serve(async (req) => {
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // 1) Verify the caller is an authenticated developer.
    const authHeader = req.headers.get("Authorization") ?? "";
    const asCaller = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await asCaller.auth.getUser();
    if (!caller) return json({ error: "Not authenticated" }, 401);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: callerRoles } = await admin
      .from("user_roles").select("role").eq("user_id", caller.id);
    const isDev = (callerRoles ?? []).some((r) => r.role === "developer" || r.role === "admin");
    if (!isDev) return json({ error: "Developer role required" }, 403);

    // 2) Validate input.
    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const fullName = body.full_name ? String(body.full_name).trim() : null;
    const role = String(body.role ?? "");
    const serviceLines: string[] = Array.isArray(body.service_lines) ? body.service_lines : [];
    if (!email || !password || !role) return json({ error: "email, password and role are required" }, 400);
    if (password.length < 6) return json({ error: "Password must be at least 6 characters" }, 400);

    // 3) Create the login (email pre-confirmed so they can sign in immediately).
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, must_change_password: true },
    });
    if (cErr) return json({ error: cErr.message }, 400);
    const uid = created.user.id;

    // 4) Ensure profile, then set exactly one role (overriding the signup-trigger default).
    await admin.from("profiles").upsert({ id: uid, email, full_name: fullName }, { onConflict: "id" });
    await admin.from("user_roles").delete().eq("user_id", uid);
    const { error: rErr } = await admin.from("user_roles").insert({ user_id: uid, role });
    if (rErr) return json({ error: `User created but role failed: ${rErr.message}` }, 500);

    // 5) Service-line memberships for SL/Delivery Lead.
    await admin.from("user_service_lines").delete().eq("user_id", uid);
    if (SL_ROLES.includes(role) && serviceLines.length) {
      await admin.from("user_service_lines")
        .insert(serviceLines.map((sl) => ({ user_id: uid, service_line: sl })));
    }

    return json({ ok: true, user_id: uid });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
