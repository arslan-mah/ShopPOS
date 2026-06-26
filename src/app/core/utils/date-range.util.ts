export type DateRangePreset =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'custom';

export interface DateRange {
  start: Date;
  end: Date;
  preset: DateRangePreset;
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function rangeToMs(range: DateRange): { startMs: number; endMs: number } {
  return {
    startMs: startOfDay(range.start).getTime(),
    endMs: endOfDay(range.end).getTime(),
  };
}

export function isDateInRange(date: Date, range: DateRange): boolean {
  const t = date.getTime();
  const { startMs, endMs } = rangeToMs(range);
  return t >= startMs && t <= endMs;
}

export function presetRange(
  preset: DateRangePreset,
  customStart?: Date,
  customEnd?: Date,
): DateRange {
  const now = new Date();
  const today = startOfDay(now);

  switch (preset) {
    case 'today':
      return { start: today, end: endOfDay(today), preset };
    case 'yesterday': {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      return { start: y, end: endOfDay(y), preset };
    }
    case 'thisWeek': {
      const start = new Date(today);
      const day = start.getDay();
      const diff = day === 0 ? 6 : day - 1;
      start.setDate(start.getDate() - diff);
      return { start, end: endOfDay(now), preset };
    }
    case 'lastWeek': {
      const end = new Date(today);
      const day = end.getDay();
      const diffToMonday = day === 0 ? 6 : day - 1;
      end.setDate(end.getDate() - diffToMonday - 1);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      return { start, end: endOfDay(end), preset };
    }
    case 'thisMonth': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start, end: endOfDay(now), preset };
    }
    case 'lastMonth': {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return { start, end: endOfDay(end), preset };
    }
    case 'custom': {
      const start = customStart ? startOfDay(customStart) : today;
      const end = customEnd ? endOfDay(customEnd) : endOfDay(customStart ?? today);
      if (start.getTime() > end.getTime()) {
        return { start: end, end: start, preset };
      }
      return { start, end, preset };
    }
    default:
      return { start: today, end: endOfDay(today), preset: 'today' };
  }
}

export function formatRangeLabel(range: DateRange): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
  const sameDay = startOfDay(range.start).getTime() === startOfDay(range.end).getTime();
  if (sameDay) return fmt(range.start);
  return `${fmt(range.start)} – ${fmt(range.end)}`;
}

export function eachDayInRange(range: DateRange): Date[] {
  const days: Date[] = [];
  const cursor = startOfDay(range.start);
  const last = startOfDay(range.end);
  while (cursor.getTime() <= last.getTime()) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDateInputValue(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return startOfDay(new Date(y, m - 1, d));
}
