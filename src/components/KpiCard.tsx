import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = "primary",
  to,
  params,
  search,
  onClick,
  active,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  accent?: "primary" | "success" | "warning" | "destructive" | "info";
  // When set, the whole card becomes a link to this route (with a hover affordance).
  to?: string;
  params?: Record<string, string>;
  search?: Record<string, unknown>;
  // When set (and no `to`), the card becomes an in-page button — e.g. to filter a list on the
  // same page. `active` highlights it as the current selection.
  onClick?: () => void;
  active?: boolean;
}) {
  const ring = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/25 text-warning-foreground",
    destructive: "bg-destructive/15 text-destructive",
    info: "bg-info/15 text-info",
  }[accent];

  const content = (
    <>
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
    </>
  );

  const base = "rounded-xl border bg-card p-5 flex items-start gap-4";

  if (to) {
    return (
      <Link
        to={to as never}
        params={params as never}
        search={search as never}
        className={cn(base, "group relative transition-colors hover:border-primary/40 hover:bg-muted/30")}
      >
        <ArrowUpRight className="absolute top-2.5 right-2.5 size-4 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100" />
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={cn(
          base,
          "group relative w-full text-left transition-colors hover:border-primary/40 hover:bg-muted/30",
          active && "border-primary ring-1 ring-primary/40 bg-muted/30",
        )}
      >
        <ArrowUpRight className="absolute top-2.5 right-2.5 size-4 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100" />
        {content}
      </button>
    );
  }

  return <div className={base}>{content}</div>;
}
