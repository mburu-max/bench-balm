import { cn } from "@/lib/utils";
import type { AllocationType, ProjectStatus, ResourceStatus } from "@/lib/constants";
import { PROJECT_STATUS_LABEL } from "@/lib/constants";

const tone = {
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/20 text-warning-foreground border-warning/40",
  destructive: "bg-destructive/15 text-destructive border-destructive/30",
  info: "bg-info/15 text-info border-info/30",
  muted: "bg-muted text-muted-foreground border-border",
  primary: "bg-primary/10 text-primary border-primary/20",
};

function Pill({ tone: t, children }: { tone: keyof typeof tone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
        tone[t],
      )}
    >
      {children}
    </span>
  );
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const map: Record<ProjectStatus, keyof typeof tone> = {
    Draft: "muted",
    Pending_Delivery_Lead: "warning",
    Pending_Finance: "warning",
    Active: "success",
    On_Hold: "info",
    Closed: "muted",
    Rejected: "destructive",
  };
  return <Pill tone={map[status]}>{PROJECT_STATUS_LABEL[status]}</Pill>;
}

export function ResourceStatusBadge({ status }: { status: ResourceStatus }) {
  const map: Record<ResourceStatus, keyof typeof tone> = {
    Active: "success",
    On_Leave: "info",
    Exited: "muted",
  };
  return <Pill tone={map[status]}>{status.replace("_", " ")}</Pill>;
}

export function AllocationTypeBadge({ type }: { type: AllocationType }) {
  const map: Record<AllocationType, keyof typeof tone> = {
    Billable: "success",
    "Non-Billable": "info",
    Bench: "warning",
    Leave: "muted",
  };
  return <Pill tone={map[type]}>{type}</Pill>;
}

export function BenchBandBadge({ pct }: { pct: number }) {
  if (pct < 0) return <Pill tone="destructive">Over-allocated {Math.abs(pct)}%</Pill>;
  if (pct === 0) return <Pill tone="success">Fully allocated</Pill>;
  if (pct === 100) return <Pill tone="warning">Zero allocation</Pill>;
  if (pct >= 50) return <Pill tone="warning">Partial · {pct}% free</Pill>;
  return <Pill tone="info">Partial · {pct}% free</Pill>;
}
