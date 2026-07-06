// Bullet-style "utilisation vs target" — one horizontal bar per service line:
// the actual utilisation (green if in target, red if below), the FULL target band
// shaded behind it, a floor marker, and (optionally) the 13-week-average as a comparison tick.
type Row = {
  sl: string;
  utilization: number;
  targetMin: number;
  targetMax: number;
  inTarget: boolean;
  avg13?: number | null;
};

export function UtilBullets({ data, showAvg }: { data: Row[]; showAvg: boolean }) {
  return (
    <div className="h-full flex flex-col justify-center gap-4 px-1 overflow-y-auto">
      {data.map((d) => (
        <div key={d.sl}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="font-medium">{d.sl}</span>
            <span>
              <span className={d.inTarget ? "text-success font-medium" : "text-destructive font-medium"}>{d.utilization}%</span>
              <span className="text-muted-foreground ml-1.5">target {d.targetMin}–{d.targetMax}%</span>
            </span>
          </div>
          <div className="relative h-6 rounded bg-muted/50 overflow-hidden" title={`${d.utilization}% — target ${d.targetMin}–${d.targetMax}%`}>
            {/* full target band */}
            <div className="absolute inset-y-0 bg-foreground/10" style={{ left: `${d.targetMin}%`, width: `${Math.max(0, d.targetMax - d.targetMin)}%` }} />
            {/* actual measure (thinner so the band shows above/below) */}
            <div
              className={`absolute top-1 bottom-1 left-0 rounded-r-sm ${d.inTarget ? "bg-success" : "bg-destructive"}`}
              style={{ width: `${Math.min(100, Math.max(0, d.utilization))}%` }}
            />
            {/* target floor marker */}
            <div className="absolute inset-y-0 w-0.5 bg-foreground/60" style={{ left: `${d.targetMin}%` }} />
            {/* 13-week average comparison tick */}
            {showAvg && d.avg13 != null && (
              <div className="absolute inset-y-0 w-0.5" style={{ left: `${Math.min(100, d.avg13)}%`, background: "var(--color-chart-1)" }} title={`13-wk avg ${d.avg13}%`} />
            )}
          </div>
        </div>
      ))}
      {data.length === 0 && <div className="text-center text-sm text-muted-foreground">No service lines to show.</div>}
    </div>
  );
}
