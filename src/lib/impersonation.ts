// Developer-only "view as" preview. Lets a developer see the UI as another role would
// see it (nav items, buttons, read-only states — all of which read useCurrentRole).
//
// This is a UI-layer preview ONLY. Row-level security runs server-side against the real
// account's roles, so data access is unchanged — a developer previewing "resource" still
// has full data access at the database level. Never treat this as a security boundary.
//
// Two flavours share the same `KEY` (the previewed role, so all existing role gating resolves):
//   • setViewAs(role)         — a plain role preview (the sidebar "View as" dropdown).
//   • setViewAsAccount(acc)   — a specific account from Admin → User Roles: previews that
//                               person's role AND their service-line scope (best-effort,
//                               still UI-only). Stored in ACCOUNT_KEY alongside KEY.
import { APP_ROLES, type AppRole } from "@/lib/constants";

const KEY = "dev_view_as";
const ACCOUNT_KEY = "dev_view_as_account";

export type ViewAsAccount = {
  userId: string;
  role: AppRole;
  serviceLines: string[];
  label: string;
};

export function getViewAs(): AppRole | null {
  if (typeof localStorage === "undefined") return null;
  const v = localStorage.getItem(KEY);
  if (!v || v === "developer") return null;
  return (APP_ROLES as readonly string[]).includes(v) ? (v as AppRole) : null;
}

export function getViewAsAccount(): ViewAsAccount | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(ACCOUNT_KEY);
  if (!raw) return null;
  try {
    const acc = JSON.parse(raw);
    if (!acc || typeof acc.role !== "string") return null;
    if (!(APP_ROLES as readonly string[]).includes(acc.role) || acc.role === "developer") return null;
    return {
      userId: String(acc.userId ?? ""),
      role: acc.role as AppRole,
      serviceLines: Array.isArray(acc.serviceLines) ? acc.serviceLines.map(String) : [],
      label: String(acc.label ?? ""),
    };
  } catch {
    return null;
  }
}

export function setViewAs(role: AppRole | null) {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(ACCOUNT_KEY); // a plain role switch clears any account-scoped preview
  if (role && role !== "developer") localStorage.setItem(KEY, role);
  else localStorage.removeItem(KEY);
}

export function setViewAsAccount(acc: ViewAsAccount | null) {
  if (typeof localStorage === "undefined") return;
  if (!acc || acc.role === "developer") {
    localStorage.removeItem(KEY);
    localStorage.removeItem(ACCOUNT_KEY);
    return;
  }
  localStorage.setItem(KEY, acc.role); // keep KEY in sync so getViewAs() + all role gating resolve
  localStorage.setItem(ACCOUNT_KEY, JSON.stringify(acc));
}
