import type { DatePreset, DateRange } from './types';

function toISO(d: Date): string { return d.toISOString(); }

// Wall-clock parts of an instant in an IANA zone. Throws RangeError for
// unknown zones — the `timezone` label must never silently mean UTC.
function tzParts(tz: string, d: Date): { y: number; mo: number; day: number; dowMon0: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
    }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { y: Number(parts.year), mo: Number(parts.month), day: Number(parts.day), dowMon0: (wd + 6) % 7 };
}

// UTC instant of local midnight for a zone calendar day. The offset is
// resolved at the candidate instant (not "now") so DST days stay exact.
function zonedMidnightUtc(tz: string, y: number, mo: number, day: number): Date {
  const wall = Date.UTC(y, mo - 1, day);
  const offsetAt = (utcMs: number): number => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]),
    );
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second)) - utcMs;
  };
  let guess = wall;
  for (let i = 0; i < 3; i++) guess = wall - offsetAt(guess);
  return new Date(guess);
}

export function rangeForPreset(preset: DatePreset, tz: string, now: Date = new Date()): DateRange {
  const end = new Date(now);
  if (preset === 'last7' || preset === 'custom') {
    return { start: toISO(new Date(end.getTime() - 7 * 86400_000)), end: toISO(end), timezone: tz, preset };
  }
  if (preset === 'last30') {
    return { start: toISO(new Date(end.getTime() - 30 * 86400_000)), end: toISO(end), timezone: tz, preset };
  }
  const { y, mo, day, dowMon0 } = tzParts(tz, end);
  let start: Date;
  switch (preset) {
    case 'today': start = zonedMidnightUtc(tz, y, mo, day); break;
    case 'week': {
      // Monday start; date arithmetic (not ms subtraction) keeps DST exact.
      const monday = new Date(Date.UTC(y, mo - 1, day - dowMon0));
      start = zonedMidnightUtc(tz, monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate());
      break;
    }
    case 'month':
    case 'billing': start = zonedMidnightUtc(tz, y, mo, 1); break;
    default: start = zonedMidnightUtc(tz, y, mo, day); break;
  }
  return { start: toISO(start), end: toISO(end), timezone: tz, preset };
}

export const PRESETS: Array<{ id: DatePreset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'last7', label: 'Last 7 days' },
  { id: 'week', label: 'This week' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'month', label: 'This month' },
  { id: 'billing', label: 'Billing cycle' },
  { id: 'custom', label: 'Custom' },
];

export function rangeLabel(r: DateRange): string {
  const p = PRESETS.find((x) => x.id === r.preset);
  return p ? p.label : r.preset;
}
