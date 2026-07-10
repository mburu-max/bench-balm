import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell, ArrowRight, CheckCircle2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type AppNotification = {
  id: string;
  code: string;
  title: string;
  subtitle: string;
  to: string;
  search?: Record<string, unknown>;
};

// Central notifications inbox in the header. Lists the pending actions the user needs to take
// (verify / staff / approve, and any future role-to-role handoff), each linking to where they
// act. The unread count clears when the bell is opened; items stay listed until the action is done.
export function NotificationBell({
  items,
  unseenCount,
  onOpen,
}: {
  items: AppNotification[];
  unseenCount: number;
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) onOpen();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Notifications"
          className="relative grid size-9 place-items-center rounded-md text-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
        >
          <Bell className="size-[18px]" />
          {unseenCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold tabular-nums text-destructive-foreground">
              {unseenCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-semibold">Notifications</span>
          <span className="text-xs text-muted-foreground">{items.length} pending</span>
        </div>
        {items.length === 0 ? (
          <div className="p-8 text-center">
            <CheckCircle2 className="mx-auto size-8 text-success" />
            <div className="mt-2 text-sm font-medium">You're all caught up</div>
            <div className="mt-0.5 text-xs text-muted-foreground">No actions need your attention.</div>
          </div>
        ) : (
          <div className="max-h-96 divide-y overflow-y-auto">
            {items.map((n) => (
              <Link
                key={n.id}
                to={n.to as never}
                search={n.search as never}
                onClick={() => setOpen(false)}
                className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{n.title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    <span className="font-mono">{n.code}</span>
                    {n.subtitle ? ` · ${n.subtitle}` : ""}
                  </div>
                </div>
                <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
