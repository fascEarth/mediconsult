import { generateSlots } from './slots';

describe('generateSlots', () => {
  // Monday 2026-11-16, India (UTC+5:30)
  const from = new Date('2026-11-16T00:00:00+05:30');
  const now = new Date('2026-11-15T00:00:00Z');

  it('creates slots in the doctor timezone and returns UTC', () => {
    const slots = generateSlots([{ weekday: 1, startTime: '09:00', endTime: '10:00' }], [], { timezone: 'Asia/Kolkata', slotMinutes: 15, from, days: 1, now });
    expect(slots).toHaveLength(4);
    expect(slots[0].toISOString()).toBe('2026-11-16T03:30:00.000Z');
  });

  it('removes booked and time-off ranges', () => {
    const busy = [{ startsAt: new Date('2026-11-16T03:45:00Z'), endsAt: new Date('2026-11-16T04:15:00Z') }];
    const slots = generateSlots([{ weekday: 1, startTime: '09:00', endTime: '10:00' }], busy, { timezone: 'Asia/Kolkata', slotMinutes: 15, from, days: 1, now });
    expect(slots.map((s) => s.toISOString())).toEqual(['2026-11-16T03:30:00.000Z', '2026-11-16T04:15:00.000Z']);
  });

  it('respects lead time', () => {
    const slots = generateSlots([{ weekday: 1, startTime: '09:00', endTime: '10:00' }], [], {
      timezone: 'Asia/Kolkata', slotMinutes: 15, from, days: 1, now: new Date('2026-11-16T03:20:00Z'), leadMinutes: 30,
    });
    expect(slots[0].toISOString()).toBe('2026-11-16T04:00:00.000Z');
  });

  it('handles DST zones', () => {
    // US DST ends 2026-11-01. 9:00 New York = 14:00 UTC after the change.
    const slots = generateSlots([{ weekday: 1, startTime: '09:00', endTime: '09:30' }], [], {
      timezone: 'America/New_York', slotMinutes: 30, from: new Date('2026-11-02T12:00:00Z'), days: 1, now: new Date('2026-10-01T00:00:00Z'),
    });
    expect(slots[0].toISOString()).toBe('2026-11-02T14:00:00.000Z');
  });
});
