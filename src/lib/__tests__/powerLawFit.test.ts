import { describe, expect, it } from 'vitest';
import { buildFitWindows, fitPowerLawCoefficients } from '../powerLawFit';
import type { OHLCVData } from '../api';

function buildSyntheticHistory(): OHLCVData[] {
  const rows: OHLCVData[] = [];
  const start = new Date('2009-01-03T00:00:00Z');
  const end = new Date('2022-03-15T00:00:00Z');
  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const day = Math.max(1, rows.length + 1);
    const close = 0.15 * day ** 1.45;
    rows.push({
      date: date.toISOString().slice(0, 10),
      open: close,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume: 1000 + day,
    });
  }
  return rows;
}

describe('power-law coefficient fitting', () => {
  it('should not use post-origin data when fitting', () => {
    const rows = buildSyntheticHistory();
    const originIndex = rows.findIndex(row => row.date === '2022-01-01');
    const trainingRows = rows.slice(0, originIndex);
    const baseline = fitPowerLawCoefficients(trainingRows);

    const mutated = rows.map(row => row.date >= '2022-01-01'
      ? { ...row, close: row.close * 1000, open: row.open * 1000, high: row.high * 1000, low: row.low * 1000 }
      : row
    );
    const mutatedWindows = buildFitWindows(mutated);
    const firstExpandingWindow = mutatedWindows.find(window => window.originDate === '2022-01-01' && window.mode === 'expanding');

    expect(baseline).not.toBeNull();
    expect(firstExpandingWindow).toBeDefined();
    expect(firstExpandingWindow?.lastTrainingDate).toBe('2021-12-31');
    expect(firstExpandingWindow?.coefficients.coefficient).toBeCloseTo(baseline!.coefficient, 10);
    expect(firstExpandingWindow?.coefficients.exponent).toBeCloseTo(baseline!.exponent, 10);
    expect(firstExpandingWindow?.coefficients.sinAmplitude).toBeCloseTo(baseline!.sinAmplitude, 10);
    expect(firstExpandingWindow?.coefficients.cosAmplitude).toBeCloseTo(baseline!.cosAmplitude, 10);
  });
});
