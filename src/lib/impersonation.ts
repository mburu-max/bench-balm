// Developer-only "view as" preview. Lets a developer see the UI as another role would
// see it (nav items, buttons, read-only states — all of which read useCurrentRole).
//
// This is a UI-layer preview ONLY. Row-level security runs server-side against the real
// account's roles, so data access is unchanged — a developer previewing "resource" still
// has full data access at the database level. Never treat this as a security boundary.
import { APP_ROLES, type AppRole } from "@/lib/constants";

const KEY = "dev_view_as";

export function getViewAs(): AppRole | null {
  if (typeof localStorage === "undefined") return null;
  const v = localStorage.getItem(KEY);
  if (!v || v === "developer") return null;
  return (APP_ROLES as readonly string[]).includes(v) ? (v as AppRole) : null;
}

export function setViewAs(role: AppRole | null) {
  if (typeof localStorage === "undefined") return;
  if (role && role !== "developer") localStorage.setItem(KEY, role);
  else localStorage.removeItem(KEY);
}
