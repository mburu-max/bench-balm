import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Building2,
  FolderKanban,
  Users,
  CalendarRange,
  Briefcase,
  Coffee,
  LogOut,
  Layers,
  ShieldCheck,
  Camera,
  FileClock,
  BarChart2,
  ClipboardList,
  AlertOctagon,
  ChevronDown,
  Eye,
  MonitorPlay,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentRole } from "@/lib/useCurrentRole";
import { usePendingActions } from "@/lib/staffing";
import { NotificationBell, type AppNotification } from "@/components/NotificationBell";
import { setViewAs } from "@/lib/impersonation";
import { getHiddenPages, setHiddenPages } from "@/lib/demo-visibility";
import { ROLE_LABEL, type AppRole } from "@/lib/constants";

// Roles a developer can preview via the "view as" switcher.
const VIEW_AS_ROLES: AppRole[] = [
  "developer",
  "governance_lead",
  "finance",
  "service_line_lead",
  "project_manager",
  "resource",
];

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  show: (r: ReturnType<typeof useCurrentRole>["data"]) => boolean;
};

type NavGroup = {
  label: string | null;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true, show: (r) => !!r?.hasAnyOtherRole },
      { to: "/my-profile", label: "My Profile", icon: Users, show: (r) => !!(r?.isResource && !r?.hasAnyOtherRole) },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/projects", label: "Projects", icon: FolderKanban, show: (r) => !!r?.hasAnyOtherRole },
      // Allocation pages: SL Leads & Governance (and PMs for Project Allocation). Finance sees
      // neither — no allocation access. PMs staff via the deep-linked Project Allocation flow.
      { to: "/allocations", label: "Resource Allocation", icon: CalendarRange, show: (r) => !!(r?.isSlLead || r?.isGovernanceLead) },
      { to: "/project-allocations", label: "Project Allocation", icon: Briefcase, show: (r) => !!(r?.isGovernanceLead || r?.isSlLead || r?.isPm) },
      { to: "/bench", label: "Bench Report", icon: Coffee, show: (r) => !!r?.hasAnyOtherRole },
      { to: "/cliff-edge", label: "Cliff Edge", icon: AlertOctagon, show: (r) => !!r?.hasAnyOtherRole },
      // Allocation Report (July 10 sync): cross-service-line allocation view for leadership /
      // reporting. Governance + Developer + Finance only (isFinance already ⊇ governance/dev).
      { to: "/allocation-report", label: "Allocation Report", icon: ClipboardList, show: (r) => !!(r?.isGovernanceLead || r?.isFinance) },
      // KPI Dashboard is hidden from PMs (they use their own project-focused dashboard).
      { to: "/kpis", label: "KPI Dashboard", icon: BarChart2, show: (r) => !!(r?.isSlLead || r?.isGovernanceLead || r?.isFinance) },
    ],
  },
  {
    label: "Setup / Masters",
    items: [
      { to: "/customers", label: "Customer Master", icon: Building2, show: (r) => !!(r?.isGovernanceLead || r?.isDeveloper) },
      // PMs see Resource Master too, but RLS scopes it to the resources on their own projects.
      { to: "/resources", label: "Resource Master", icon: Users, show: (r) => !!(r?.isGovernanceLead || r?.isDeveloper || r?.isSlLead || r?.isPm) },
    ],
  },
  {
    label: "Administration",
    items: [
      { to: "/snapshots", label: "Snapshots", icon: Camera, show: (r) => !!r?.isDeveloper },
      { to: "/audit", label: "Audit Trail", icon: FileClock, show: (r) => !!r?.isDeveloper },
      { to: "/admin/users", label: "User Roles", icon: ShieldCheck, show: (r) => !!r?.isDeveloper },
    ],
  },
];

// "Seen" staffing projects — the Projects badge behaves like a notification: once the PM opens
// Projects, the current unstaffed projects are acknowledged (persisted) and the badge clears
// until a NEW unstaffed project appears.
const PENDING_SEEN_KEY = "pending_actions_seen";
const readPendingSeen = (): string[] => {
  if (typeof localStorage === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_SEEN_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

export function AppShell({ children, title, actions }: { children: ReactNode; title: string; actions?: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const role = useCurrentRole();

  // Per-role "pending action" badge on the Projects nav item — Governance (drafts to verify),
  // PM (projects to staff) or SL Lead (staffed projects to approve). One flag per role.
  const pending = usePendingActions(role.data);
  // Notification-style: count only the items the user hasn't acknowledged yet (opened Projects).
  const [pendingSeen, setPendingSeen] = useState<string[]>(readPendingSeen);
  const pendingBadge = pending.items.filter((p) => !pendingSeen.includes(p.id)).length;
  const pendingLabel =
    pending.kind === "verify"
      ? `${pendingBadge} draft${pendingBadge === 1 ? "" : "s"} to approve`
      : pending.kind === "approve"
        ? `${pendingBadge} project${pendingBadge === 1 ? "" : "s"} awaiting your approval`
        : `${pendingBadge} project${pendingBadge === 1 ? "" : "s"} to staff`;
  // Acknowledge the current pending items — clears the unread count on the bell + Projects badge.
  const markPendingSeen = () => {
    setPendingSeen((prev) => {
      const ids = pending.items.map((p) => p.id);
      const merged = Array.from(new Set([...prev, ...ids]));
      if (merged.length === prev.length) return prev;
      try { localStorage.setItem(PENDING_SEEN_KEY, JSON.stringify(merged)); } catch {}
      return merged;
    });
  };
  useEffect(() => {
    if (location.pathname.startsWith("/projects")) markPendingSeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, pending.items]);

  // Central notifications inbox — the pending actions, each linking to where the user acts.
  const notifications: AppNotification[] = pending.items.map((p: any) => {
    const customer = p.customers?.customer_name ?? "";
    if (pending.kind === "verify")
      return { id: p.id, code: p.project_code, title: "Approve this draft", subtitle: customer, to: "/projects", search: { status: "Draft" } };
    if (pending.kind === "approve")
      return { id: p.id, code: p.project_code, title: "Approve staffing", subtitle: customer, to: "/projects", search: { status: "Active" } };
    return { id: p.id, code: p.project_code, title: "Assign resources", subtitle: customer, to: "/project-allocations", search: { projectId: p.id } };
  });

  const labelledGroups = NAV_GROUPS.filter((g) => g.label !== null).map((g) => g.label as string);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem("nav_groups_open");
      if (stored) return JSON.parse(stored);
    } catch {}
    return Object.fromEntries(labelledGroups.map((l) => [l, true]));
  });
  const toggleGroup = (label: string) =>
    setOpenGroups((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      try { localStorage.setItem("nav_groups_open", JSON.stringify(next)); } catch {}
      return next;
    });

  const qc = useQueryClient();
  const changeViewAs = (val: string) => {
    setViewAs(val === "developer" ? null : (val as AppRole));
    qc.invalidateQueries({ queryKey: ["current-role"] });
    // Land somewhere the previewed role can actually see.
    navigate({ to: val === "resource" ? "/my-profile" : "/" });
    if (val !== "developer") {
      toast(`Previewing as ${ROLE_LABEL[val] ?? val} — press Ctrl+Shift+X to return to Developer`);
    }
  };

  // Hidden escape hatch: while previewing a role there is no visible dev chrome, so
  // Ctrl/Cmd+Shift+X pops back to Developer. Sign-out also clears the preview.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === "KeyX") {
        if (role.data?.realIsDeveloper && role.data?.impersonating) {
          e.preventDefault();
          changeViewAs("developer");
          toast.success("Back to Developer");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role.data?.realIsDeveloper, role.data?.impersonating]);

  // Developer-only demo control: hide chosen pages from the sidebar for a presentation.
  const [demoOpen, setDemoOpen] = useState(false);
  const [hidden, setHidden] = useState<string[]>(() => getHiddenPages());
  const hiddenSet = new Set(hidden);
  const allNav = NAV_GROUPS.flatMap((g) => g.items);
  const applyHidden = (next: string[]) => {
    setHidden(next);
    setHiddenPages(next);
  };
  const togglePage = (to: string) =>
    applyHidden(hidden.includes(to) ? hidden.filter((x) => x !== to) : [...hidden, to]);

  // Developer chrome (View-as + Demo pages) hides while previewing another role, so the
  // presented sidebar looks like that role's. Return to developer via the "Exit preview" banner.
  const showDevControls = !!(role.data?.realIsDeveloper && !role.data?.impersonating);

  const signOut = async () => {
    setViewAs(null); // reset any role preview on the way out
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden md:sticky md:top-0 md:flex md:h-screen md:max-h-screen w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border overflow-hidden">
        <div className="px-6 py-5 flex items-center gap-2.5">
          <div className="size-8 rounded-md bg-sidebar-primary text-sidebar-primary-foreground grid place-items-center">
            <Layers className="size-4" />
          </div>
          <div className="leading-tight">
            <div className="font-display font-semibold text-sm">Allocate</div>
            <div className="text-[10px] uppercase tracking-widest text-sidebar-foreground/60">
              Service Delivery
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 overflow-y-auto min-h-0 py-2 space-y-1">
          {NAV_GROUPS.map((group, gi) => {
            const visibleItems = group.items.filter((n) => n.show(role.data) && !hiddenSet.has(n.to));
            if (visibleItems.length === 0) return null;
            const isOpen = group.label === null || openGroups[group.label];
            return (
              <div key={gi} className={group.label ? "pt-2" : ""}>
                {group.label && (
                  <button
                    onClick={() => toggleGroup(group.label!)}
                    className="w-full flex items-center justify-between px-3 py-1.5 rounded-md text-[10px] uppercase tracking-widest font-semibold text-sidebar-foreground/50 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground/80 transition-colors"
                  >
                    {group.label}
                    <ChevronDown
                      className={cn("size-3 transition-transform duration-200", isOpen ? "rotate-0" : "-rotate-90")}
                    />
                  </button>
                )}
                <div
                  className={cn(
                    "space-y-0.5 overflow-hidden transition-all duration-200",
                    isOpen ? "mt-0.5 max-h-96 opacity-100" : "max-h-0 opacity-0",
                  )}
                >
                  {visibleItems.map((n) => {
                    const active = n.exact
                      ? location.pathname === n.to
                      : location.pathname.startsWith(n.to);
                    const Icon = n.icon;
                    return (
                      <Link
                        key={n.to}
                        to={n.to}
                        className={cn(
                          "flex items-center gap-3 rounded-md px-3 py-2 text-[15px] transition-colors",
                          active
                            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                            : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                        )}
                      >
                        <Icon className="size-[17px]" />
                        {n.label}
                        {n.to === "/projects" && pendingBadge > 0 && (
                          <span
                            className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-warning/30 text-warning-foreground tabular-nums"
                            title={pendingLabel}
                          >
                            {pendingBadge}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border space-y-2">
          {role.data?.role && (
            <div className="px-3 py-2 rounded-md bg-sidebar-accent/40 text-[11px]">
              <div className="uppercase tracking-widest text-sidebar-foreground/60">Signed in as</div>
              <div className="font-medium mt-0.5">{ROLE_LABEL[role.data.role as string] ?? role.data.role}</div>
            </div>
          )}
          {showDevControls && (
            <div className="px-3 py-2 rounded-md text-[11px] space-y-1.5 bg-sidebar-accent/30">
              <div className="flex items-center gap-1.5 uppercase tracking-widest text-sidebar-foreground/60">
                <Eye className="size-3" /> View as
              </div>
              <Select value="developer" onValueChange={changeViewAs}>
                <SelectTrigger className="h-8 text-xs bg-sidebar text-sidebar-foreground border-sidebar-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VIEW_AS_ROLES.map((r) => (
                    <SelectItem key={r} value={r} className="text-xs">
                      {r === "developer" ? "Developer (you)" : ROLE_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {showDevControls && (
            <Dialog open={demoOpen} onOpenChange={setDemoOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  className="w-full justify-start text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                >
                  <MonitorPlay className="size-4 mr-2" /> Demo pages
                  {hidden.length > 0 && (
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-warning/30 text-warning-foreground">
                      {hidden.length} hidden
                    </span>
                  )}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Pages visible in the sidebar</DialogTitle>
                </DialogHeader>
                <p className="text-xs text-muted-foreground -mt-1">
                  Untick a page to hide it from the menu during your demo. This only affects what
                  shows here — it doesn't change anyone's access.
                </p>
                <div className="flex gap-2 py-1">
                  <Button size="sm" variant="outline" onClick={() => applyHidden([])}>Show all</Button>
                  <Button size="sm" variant="outline" onClick={() => applyHidden(allNav.map((n) => n.to).filter((to) => to !== "/"))}>
                    Dashboard only
                  </Button>
                </div>
                <div className="max-h-80 overflow-y-auto space-y-0.5">
                  {allNav.map((n) => {
                    const Icon = n.icon;
                    const visible = !hiddenSet.has(n.to);
                    return (
                      <label key={n.to} className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted cursor-pointer">
                        <Checkbox checked={visible} onCheckedChange={() => togglePage(n.to)} />
                        <Icon className="size-4 text-muted-foreground" />
                        {n.label}
                        <span className="ml-auto text-[10px] font-mono text-muted-foreground">{n.to}</span>
                      </label>
                    );
                  })}
                </div>
                <DialogFooter>
                  <Button onClick={() => setDemoOpen(false)}>Done</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          <Button
            variant="ghost"
            className="w-full justify-start text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            onClick={signOut}
          >
            <LogOut className="size-4 mr-2" /> Sign out
          </Button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b bg-card/50 backdrop-blur flex items-center justify-between px-6">
          <div>
            <h1 className="text-lg font-display font-semibold tracking-tight">{title}</h1>
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <NotificationBell items={notifications} unseenCount={pendingBadge} onOpen={markPendingSeen} />
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
