// HK holiday lookup. Uses date-holidays package; centralizes it here so the
// UI components stay declarative.
//
// `date-holidays` is a client-safe, dependency-free package — fine to import
// from both server and client components. The instance is module-singleton so
// we only construct it once per process.

import Holidays from 'date-holidays';

const hd = new Holidays('HK');

export type Holiday = {
  date: string;       // YYYY-MM-DD
  name: string;       // Chinese name for HK locale
  type: string;       // 'public' | 'bank' | 'optional' | 'observance'
  public: boolean;    // public holiday
};

function dateOnly(d: Date): string {
  // Strip time so comparisons are exact-day regardless of TZ shift
  return d.toISOString().slice(0, 10);
}

/** Returns holiday(s) for the given date, or null if none. */
export function getHoliday(d: Date): Holiday | null {
  // date-holidays gives us the date string in the device's local TZ. We
  // pass YYYY-MM-DD directly for the lookup to avoid TZ off-by-one.
  const key = dateOnly(d);
  const all = hd.getHolidays(d.getFullYear()) as Array<{ date: string; name: string; type: string; public?: boolean }>;
  const hit = all.find(h => h.date.slice(0, 10) === key);
  if (!hit) return null;
  return {
    date: key,
    name: hit.name,
    type: hit.type,
    public: !!hit.public
  };
}

/** Returns all holidays in the calendar's visible range, indexed by YYYY-MM-DD. */
export function getHolidaysInRange(start: Date, end: Date): Record<string, Holiday> {
  const years = new Set<number>();
  for (let y = start.getFullYear(); y <= end.getFullYear(); y++) years.add(y);
  const all: Holiday[] = [];
  for (const y of years) {
    const arr = hd.getHolidays(y) as Array<{ date: string; name: string; type: string; public?: boolean }>;
    for (const h of arr) {
      all.push({
        date: h.date.slice(0, 10),
        name: h.name,
        type: h.type,
        public: !!h.public
      });
    }
  }
  const result: Record<string, Holiday> = {};
  for (const h of all) {
    const t = new Date(h.date + 'T00:00:00');
    if (t >= start && t <= end) result[h.date] = h;
  }
  return result;
}
