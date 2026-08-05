import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type DateRange = { from: string; to: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return iso(d);
};

export const today = () => iso(new Date());

// Common presets. Forward-looking ones suit coverage/cliff reports; backward ones suit historical
// reports. Pages pass whichever subset makes sense (default = a general mix).
export const RANGE_PRESETS: { label: string; range: () => DateRange }[] = [
  { label: "Today", range: () => ({ from: today(), to: today() }) },
  { label: "Next 30 days", range: () => ({ from: today(), to: shift(30) }) },
  { label: "Next 60 days", range: () => ({ from: today(), to: shift(60) }) },
  { label: "Next 90 days", range: () => ({ from: today(), to: shift(90) }) },
  { label: "Last 30 days", range: () => ({ from: shift(-30), to: today() }) },
  { label: "Last 90 days", range: () => ({ from: shift(-90), to: today() }) },
];

// Shared from → to picker used across all reports. Overlap/at-any-point semantics live in each report;
// this is purely the control. Guards against an inverted range in the UI (from ≤ to).
export function DateRangePicker({
  value,
  onChange,
  presets = RANGE_PRESETS,
  className,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
  presets?: { label: string; range: () => DateRange }[];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end gap-2", className)}>
      <div className="space-y-1.5">
        <Label className="text-xs">From</Label>
        <Input
          type="date"
          value={value.from}
          max={value.to || undefined}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
          className="w-auto"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">To</Label>
        <Input
          type="date"
          value={value.to}
          min={value.from || undefined}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
          className="w-auto"
        />
      </div>
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1 pb-0.5">
          {presets.map((p) => {
            const r = p.range();
            const active = r.from === value.from && r.to === value.to;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => onChange(r)}
                className={cn(
                  "rounded-md border px-2 py-1 text-[11px] transition-colors",
                  active ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted",
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Inclusive overlap test: does [start,end] intersect [range.from,range.to]? Empty bounds = unbounded.
export function overlapsRange(start: string | null | undefined, end: string | null | undefined, range: DateRange): boolean {
  if (!start || !end) return false;
  if (range.from && end < range.from) return false;
  if (range.to && start > range.to) return false;
  return true;
}
