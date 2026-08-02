import { describe, expect, it } from 'vitest';
import type { OHLCVData } from '../api';
import { bollingerBands, bollingerReentrySignals, buildTechnicalReversalSignals, macd, macdOppositeZeroSignals, rsiExtremeExitSignals, stochasticExtremeCrossSignals, stochasticOscillator, wilderRsi } from '../technicalReversal';

describe('canonical technical reversal indicators', () => {
  it('seeds Wilder RSI after exactly 14 changes and handles one-sided/flat changes', () => {
    expect(wilderRsi(Array.from({ length: 15 }, (_, index) => index + 1), 14).at(-1)).toBe(100);
    expect(wilderRsi(Array.from({ length: 15 }, (_, index) => 15 - index), 14).at(-1)).toBe(0);
    expect(wilderRsi(Array(15).fill(10), 14).at(-1)).toBe(50);
  });

  it('uses trailing population standard deviation for Bollinger bands', () => {
    const bands = bollingerBands([1, 2, 3, 4], 4, 2);
    expect(bands.middle.at(-1)).toBe(2.5);
    expect(bands.lower.at(-1)).toBeCloseTo(2.5 - 2 * Math.sqrt(1.25));
    expect(bands.upper.at(-1)).toBeCloseTo(2.5 + 2 * Math.sqrt(1.25));
  });

  it('returns no stochastic value when the trailing range is zero', () => {
    const rows = Array.from({ length: 20 }, (_, index) => candle(index, 10, 10, 10));
    expect(stochasticOscillator(rows, 14, 3).k.every(value => value === null)).toBe(true);
  });

  it('keeps every indicator prefix invariant to future rows', () => {
    const rows = Array.from({ length: 80 }, (_, index) => candle(index, 100 + Math.sin(index / 3) * 10, 105 + Math.sin(index / 3) * 10, 95 + Math.sin(index / 3) * 10));
    const prefix = rows.slice(0, 60);
    const fullSignals = buildTechnicalReversalSignals(rows);
    const prefixSignals = buildTechnicalReversalSignals(prefix);
    for (let candidate = 0; candidate < fullSignals.length; candidate++) {
      expect(fullSignals[candidate].signal.slice(0, prefix.length)).toEqual(prefixSignals[candidate].signal);
    }
  });

  it('uses the frozen first-value EMA convention for MACD', () => {
    const values = [10, 11, 13, 12, 15];
    const result = macd(values, 2, 3, 2);
    expect(result.line[0]).toBe(0);
    expect(result.signal[0]).toBe(0);
    expect(result.histogram.map(Number.isFinite).every(Boolean)).toBe(true);
  });

  it('applies frozen threshold equality and direction filters to events', () => {
    expect(rsiExtremeExitSignals([null, 30, 31, 70, 69])).toEqual([0, 0, 1, 0, -1]);
    expect(bollingerReentrySignals([8, 10, 12, 10], [9, 9, 9, 9], [11, 11, 11, 11])).toEqual([0, 1, 0, -1]);
    expect(stochasticExtremeCrossSignals([10, 15, 85, 80], [12, 14, 82, 81])).toEqual([0, 1, 0, -1]);
    expect(macdOppositeZeroSignals([-1, -1, 1, 1], [-1, 1, 1, -1])).toEqual([0, 1, 0, -1]);
  });
});

function candle(index: number, close: number, high: number, low: number): OHLCVData {
  const date = new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10);
  return { date, open: close, high, low, close, volume: 1_000 };
}
