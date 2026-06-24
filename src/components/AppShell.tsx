import { Link, useLocation, useNavigate } from "@tanstack/react-router";
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
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/customers", label: "Customers", icon: Building2 },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/resources", label: "Resources", icon: Users },
  { to: "/allocations", label: "Resource Allocation", icon: CalendarRange },
  { to: "/project-allocations", label: "Project Allocation", icon: Briefcase },
  { to: "/bench", label: "Bench Report", icon: Coffee },
];

export function AppShell({ children, title, actions }: { children: ReactNode; title: string; actions?: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden md:flex w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
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
        <nav className="flex-1 px-3 space-y-0.5">
          {NAV.map((n) => {
            const active = n.exact
              ? location.pathname === n.to
              : location.pathname.startsWith(n.to);
            const Icon = n.icon;
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
              >
                <Icon className="size-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
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
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
