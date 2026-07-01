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
