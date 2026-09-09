import { describe, expect, it } from 'vitest';
import { applyContinuityGuard, assessContinuity, repairWindowStart } from '../marketContinuity';
import type { OHLCVData } from '../api';

const row = (date: string, close: number): OHLCVData => ({ date, open: close, high: close, low: close, close, volume: 1 });
const series = (dates: string[]) => dates.map((date, index) => row(date, 100 + index));

describe('calendar-aware candle continuity', () => {
  it('should treat a daily bitcoin run without holes as complete', () => {
    const rows = series(['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09']);
    expect(assessContinuity('btc', rows, '2026-07-06')).toMatchObject({ complete: true, missingDates: [], lastContiguousDate: '2026-07-09' });
  });

  it('should report every missing bitcoin calendar day inside the window', () => {
    const rows = series(['2026-07-06', '2026-07-07', '2026-07-10']);
    expect(assessContinuity('btc', rows, '2026-07-06')).toMatchObject({
      complete: false,
      missingDates: ['2026-07-08', '2026-07-09'],
      lastContiguousDate: '2026-07-07',
    });
  });

  it('should not report a weekend as an equity gap', () => {
    // 2026-08-14 is a Friday; the next session is Monday 2026-08-17.
    const rows = series(['2026-08-14', '2026-08-17', '2026-08-18']);
    expect(assessContinuity('sp500', rows, '2026-08-14')).toMatchObject({ complete: true, missingDates: [] });
    expect(assessContinuity('gold', rows, '2026-08-14')).toMatchObject({ complete: true, missingDates: [] });
  });

  it('should not report an observed exchange holiday as an equity gap', () => {
    // Independence Day 2026 falls on a Saturday and is observed on Friday 2026-07-03.
    const rows = series(['2026-07-02', '2026-07-06']);
    expect(assessContinuity('sp500', rows, '2026-07-02')).toMatchObject({ complete: true, missingDates: [] });
  });

  it('should report a missing equity session while ignoring the surrounding weekend', () => {
    const rows = series(['2026-08-14', '2026-08-17', '2026-08-19']);
    expect(assessContinuity('sp500', rows, '2026-08-14')).toMatchObject({
      complete: false,
      missingDates: ['2026-08-18'],
      lastContiguousDate: '2026-08-17',
    });
  });

  it('should treat a bitcoin weekend as an expected candle', () => {
    const rows = series(['2026-08-14', '2026-08-17']);
    expect(assessContinuity('btc', rows, '2026-08-14')).toMatchObject({
      complete: false,
      missingDates: ['2026-08-15', '2026-08-16'],
    });
  });

  it('should keep history that predates the window when the window itself opens on a hole', () => {
    const rows = series(['2026-07-01', '2026-07-02', '2026-07-20']);
    const assessment = assessContinuity('btc', rows, '2026-07-10');
    expect(assessment.complete).toBe(false);
    expect(assessment.lastContiguousDate).toBe('2026-07-02');
  });

  it('should truncate a discontinuous series at the last contiguous candle', () => {
    const rows = series(['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-24', '2026-07-25']);
    const guarded = applyContinuityGuard('btc', rows, '2026-07-06');
    expect(guarded.rows.map((entry) => entry.date)).toEqual(['2026-07-06', '2026-07-07', '2026-07-08']);
    expect(guarded.continuity.complete).toBe(false);
    expect(guarded.continuity.missingDates).toHaveLength(15);
  });

  it('should leave a contiguous series untouched', () => {
    const rows = series(['2026-07-06', '2026-07-07', '2026-07-08']);
    const guarded = applyContinuityGuard('btc', rows, '2026-07-06');
    expect(guarded.rows).toEqual(rows);
    expect(guarded.continuity.complete).toBe(true);
  });

  it('should derive the repair window from the requested lookback', () => {
    expect(repairWindowStart('2026-08-17', 7)).toBe('2026-08-10');
    expect(repairWindowStart('2026-01-03', 7)).toBe('2025-12-27');
  });

  it('should stay bounded when the observed tail is years away from the window', () => {
    const rows = series(['2026-07-06', '2026-07-07', '2036-07-08']);
    const assessment = assessContinuity('btc', rows, '2026-07-06');
    expect(assessment.complete).toBe(false);
    expect(assessment.truncated).toBe(true);
    expect(assessment.missingDates.length).toBeLessThanOrEqual(400);
    expect(assessment.lastContiguousDate).toBe('2026-07-07');
  });
});
