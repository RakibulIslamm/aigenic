/**
 * Shared UTC date-window helpers. Every "this month" figure in the app
 * (dashboard, billing, site overview, chat quota) must use the same boundary
 * — import from here instead of re-deriving it.
 */

export function startOfCurrentMonthUTC(): Date {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Midnight UTC `days` days ago (0 = today's midnight). */
export function daysAgoUTC(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
