import { durationDays, VitalDto, vitalFlag } from './wellness.module';
import { pctChange } from '../insights/insights.module';

describe('durationDays', () => {
  it.each([
    ['5 days', 5], ['5d', 5], ['2 weeks', 14], ['1 month', 30], ['10', 10], ['1.5 weeks', 11],
  ])('%s → %d', (text, days) => expect(durationDays(text)).toBe(days));

  it.each(['ongoing', 'Continue', 'SOS', 'as needed', '', undefined])('%s → null', (text) => expect(durationDays(text as string)).toBeNull());
});

describe('vitalFlag', () => {
  it('flags blood pressure', () => {
    expect(vitalFlag('BP', { systolic: 150, diastolic: 85 })).toBe('high');
    expect(vitalFlag('BP', { systolic: 118, diastolic: 76 })).toBeNull();
    expect(vitalFlag('BP', { systolic: 85, diastolic: 55 })).toBe('low');
  });
  it('uses the glucose context', () => {
    expect(vitalFlag('GLUCOSE', { mgdl: 130, context: 'fasting' })).toBe('high');
    expect(vitalFlag('GLUCOSE', { mgdl: 130, context: 'post-meal' })).toBeNull();
    expect(vitalFlag('GLUCOSE', { mgdl: 60, context: 'random' })).toBe('low');
  });
  it('flags oxygen and temperature', () => {
    expect(vitalFlag('SPO2', { percent: 91 })).toBe('low');
    expect(vitalFlag('TEMP', { celsius: 38.4 })).toBe('high');
    expect(vitalFlag('WEIGHT', { kg: 70 })).toBeNull();
  });
});

describe('VitalDto', () => {
  it('accepts a valid reading and rejects an impossible one', () => {
    expect(VitalDto.safeParse({ type: 'HR', value: { bpm: 72 } }).success).toBe(true);
    expect(VitalDto.safeParse({ type: 'HR', value: { bpm: 900 } }).success).toBe(false);
    expect(VitalDto.safeParse({ type: 'BP', value: { bpm: 72 } }).success).toBe(false);
  });
});

describe('pctChange', () => {
  it('handles zero baselines', () => {
    expect(pctChange(10, 0)).toBeNull();
    expect(pctChange(0, 0)).toBe(0);
    expect(pctChange(15, 10)).toBe(50);
    expect(pctChange(5, 10)).toBe(-50);
  });
});
