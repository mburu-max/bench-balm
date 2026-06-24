import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = "primary",
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  accent?: "primary" | "success" | "warning" | "destructive" | "info";
}) {
  const ring = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/25 text-warning-foreground",
    destructive: "bg-destructive/15 text-destructive",
    info: "bg-info/15 text-info",
  }[accent];

  return (
    <div className="rounded-xl border bg-card p-5 flex items-start gap-4">
      {Icon ? (
        <div className={cn("size-10 rounded-lg grid place-items-center shrink-0", ring)}>
          <Icon className="size-5" />
        </div>
      ) : null}
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-widest text-muted-foreground font-medium">
          {label}
        </div>
        <div className="font-display text-3xl font-semibold tabular-nums mt-1 leading-none">
          {value}
        </div>
        {hint ? <div className="text-xs text-muted-foreground mt-1.5">{hint}</div> : null}
      </div>
    </div>
  );
}
