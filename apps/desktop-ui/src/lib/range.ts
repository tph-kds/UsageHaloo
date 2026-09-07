import type { DatePreset, DateRange } from './types';

function toISO(d: Date): string { return d.toISOString(); }

export function rangeForPreset(preset: DatePreset, tz: string): DateRange {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  switch (preset) {
    case 'today': start.setHours(0, 0, 0, 0); break;
    case 'last7': start.setDate(start.getDate() - 7); break;
    case 'week': {
      const dow = (start.getDay() + 6) % 7; // Monday start
      start.setDate(start.getDate() - dow); start.setHours(0, 0, 0, 0); break;
    }
    case 'last30': start.setDate(start.getDate() - 30); break;
    case 'month': start.setDate(1); start.setHours(0, 0, 0, 0); break;
    case 'billing': start.setDate(1); start.setHours(0, 0, 0, 0); break;
    case 'custom': start.setDate(start.getDate() - 7); break;
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
