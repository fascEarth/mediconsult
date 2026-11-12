import { DateTime, Interval } from 'luxon';

export interface Rule {
  weekday: number; // ISO 1..7
  startTime: string; // HH:mm
  endTime: string;
}

export interface Busy {
  startsAt: Date;
  endsAt: Date;
}

export interface SlotOptions {
  timezone: string;
  slotMinutes: number;
  from: Date;
  days: number;
  /** Minimum notice before a slot can be booked. */
  leadMinutes?: number;
  now?: Date;
}

/**
 * Expand weekly rules (in the doctor's timezone, DST-safe via luxon) into UTC
 * slot start times, minus booked appointments and time off.
 */
export function generateSlots(rules: Rule[], busy: Busy[], opts: SlotOptions): Date[] {
  const now = DateTime.fromJSDate(opts.now ?? new Date());
  const earliest = now.plus({ minutes: opts.leadMinutes ?? 30 });
  const startDay = DateTime.fromJSDate(opts.from, { zone: opts.timezone }).startOf('day');
  const busyIntervals = busy.map((b) => Interval.fromDateTimes(DateTime.fromJSDate(b.startsAt), DateTime.fromJSDate(b.endsAt)));
  const out: Date[] = [];

  for (let d = 0; d < opts.days; d++) {
    const day = startDay.plus({ days: d });
    for (const rule of rules.filter((r) => r.weekday === day.weekday)) {
      const [sh, sm] = rule.startTime.split(':').map(Number);
      const [eh, em] = rule.endTime.split(':').map(Number);
      let cursor = day.set({ hour: sh, minute: sm, second: 0, millisecond: 0 });
      const end = day.set({ hour: eh, minute: em, second: 0, millisecond: 0 });
      while (cursor.plus({ minutes: opts.slotMinutes }) <= end) {
        const slot = Interval.fromDateTimes(cursor, cursor.plus({ minutes: opts.slotMinutes }));
        if (cursor >= earliest && !busyIntervals.some((b) => b.overlaps(slot))) out.push(cursor.toUTC().toJSDate());
        cursor = cursor.plus({ minutes: opts.slotMinutes });
      }
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}

export function isValidTime(t: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}
