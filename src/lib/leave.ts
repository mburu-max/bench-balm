// Extended-leave escalation (Dashboard Dev Tracker: allocation_type "Leave Code - Extended
// (>5 days)" triggers an escalation flag per RA doc §5.4.1). We keep a single "Leave"
// allocation_type and derive short-vs-extended from the row's own duration, so the flag is
// always accurate to the dates rather than a manually-chosen code.
export const LEAVE_EXTENDED_MIN_DAYS = 5;

type Leaveish = {
  allocation_type?: string | null;
  allocation_start_date?: string | null;
  allocation_end_date?: string | null;
};

/** Inclusive calendar-day span of a leave row (start and end both counted). */
export function leaveDurationDays(start: string, end: string): number {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (isNaN(s) || isNaN(e) || e < s) return 0;
  return Math.floor((e - s) / 86_400_000) + 1;
}

/** True when a Leave allocation spans more than 5 days (tracker's "Extended" threshold). */
export function isExtendedLeave(a: Leaveish): boolean {
  if (a.allocation_type !== "Leave") return false;
  if (!a.allocation_start_date || !a.allocation_end_date) return false;
  return leaveDurationDays(a.allocation_start_date, a.allocation_end_date) > LEAVE_EXTENDED_MIN_DAYS;
}

/** True when the leave row is in effect on the given date (defaults to today). */
export function isCurrentLeave(a: Leaveish, on: Date = new Date()): boolean {
  if (!a.allocation_start_date || !a.allocation_end_date) return false;
  const d = on.toISOString().slice(0, 10);
  return a.allocation_start_date <= d && a.allocation_end_date >= d;
}

type AllocLike = Leaveish & { resource_id?: string | null };
const inEffect = (a: AllocLike, onDate: string) =>
  a.allocation_type === "Leave" &&
  !!a.resource_id &&
  !!a.allocation_start_date &&
  !!a.allocation_end_date &&
  a.allocation_start_date <= onDate &&
  a.allocation_end_date >= onDate;

/** Resource ids on a SHORT current leave (<= 5 days) — these are excluded from the bench. */
export function shortLeaveResourceIds(allocations: AllocLike[], onDate: string): Set<string> {
  const s = new Set<string>();
  for (const a of allocations ?? []) if (inEffect(a, onDate) && !isExtendedLeave(a)) s.add(a.resource_id!);
  return s;
}

/** Resource ids on an EXTENDED current leave (> 5 days) — these still appear on the bench, with
 *  the leave freeing their (retained) allocation for backfill until they return. */
export function extendedLeaveResourceIds(allocations: AllocLike[], onDate: string): Set<string> {
  const s = new Set<string>();
  for (const a of allocations ?? []) if (inEffect(a, onDate) && isExtendedLeave(a)) s.add(a.resource_id!);
  return s;
}

/** Leave rows that START in the future (start_date > onDate), sorted by start ascending — "upcoming"
 *  leave. Surfaces approved time-off before it's in effect, so it's visible ahead of time. */
export function upcomingLeave<T extends AllocLike>(allocations: T[], onDate: string): T[] {
  return (allocations ?? [])
    .filter((a) => a.allocation_type === "Leave" && !!a.resource_id && !!a.allocation_start_date && a.allocation_start_date > onDate)
    .sort((a, b) => (a.allocation_start_date! < b.allocation_start_date! ? -1 : 1));
}
