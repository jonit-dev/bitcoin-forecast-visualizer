import { describe, expect, it } from 'vitest';
import { crpsFromQuantiles, pitHistogram, pitUniformityStatistic, pitValue, winklerScore } from '../properScoring';

describe('proper scoring', () => {
  it('should return a lower CRPS for a sharper forecast when both are centred on the actual', () => {
    const actual = 100;
    const sharp = crpsFromQuantiles(actual, { q05: 95, q10: 98, q50: 100, q90: 102, q95: 105 });
    const wide = crpsFromQuantiles(actual, { q05: 50, q10: 80, q50: 100, q90: 120, q95: 150 });

    expect(sharp).not.toBeNull();
    expect(wide).not.toBeNull();
    expect(sharp!).toBeLessThan(wide!);
  });

  it('should integrate endpoint-constant tails across the full probability domain', () => {
    expect(crpsFromQuantiles(0, [[0.25, 1], [0.5, 1], [0.75, 1]])).toBeCloseTo(1);
  });

  it('should return a PIT value near 0.5 when the actual equals the median', () => {
    expect(Math.abs(pitValue(100, 100, 0.2)! - 0.5)).toBeLessThan(1e-9);
  });

  it('should produce a uniform PIT histogram for a seeded forecast-distribution sample', () => {
    const sigma = 0.35;
    const random = mulberry32(0x51A7ED);
    const values = Array.from({ length: 1_000 }, (_, index) => {
      const standardNormal = seededNormal(random(), random());
      const actual = 100 * Math.exp(sigma * standardNormal);
      return pitValue(actual, 100, sigma)!;
    });
    const statistic = pitUniformityStatistic(values, 10)!;

    expect(pitHistogram(values, 10)?.expectedCounts).toEqual(Array(10).fill(100));
    expect(statistic.chiSquare).toBeLessThan(21.666);
    expect(statistic.degreesOfFreedom).toBe(9);
  });

  it('should reject the inflated-sigma negative control as non-uniform', () => {
    const forecastSigma = 0.35;
    const random = mulberry32(0x51A7ED);
    const values = Array.from({ length: 1_000 }, (_, index) => {
      const standardNormal = seededNormal(random(), random());
      const actual = 100 * Math.exp(forecastSigma * 2 * standardNormal);
      return pitValue(actual, 100, forecastSigma)!;
    });

    expect(pitUniformityStatistic(values, 10)!.chiSquare).toBeGreaterThan(21.666);
  });

  it('should penalise a miss above the upper bound proportionally to 2/alpha', () => {
    expect(winklerScore(120, 100, 110, 0.1)).toBe(210);
  });

  it('should exclude missing or non-positive sigma from PIT values', () => {
    expect(pitValue(100, 100, undefined)).toBeNull();
    expect(pitValue(100, 100, 0)).toBeNull();
    expect(pitValue(100, 100, -0.2)).toBeNull();
    expect(pitValue(100, 100, 0.2)).not.toBeNull();
  });

  it('should return null for an empty or invalid PIT sample set', () => {
    expect(pitHistogram([])).toBeNull();
    expect(pitHistogram([Number.NaN, Number.POSITIVE_INFINITY])).toBeNull();
    expect(pitUniformityStatistic([])).toBeNull();
  });

  it('should return null when fewer than three valid quantiles are present', () => {
    expect(crpsFromQuantiles(100, { q10: 90, q50: 100 })).toBeNull();
  });
});

function seededNormal(first: number, second: number): number {
  const safeFirst = Math.max(first, Number.EPSILON);
  const safeSecond = Math.max(second, Number.EPSILON);
  return Math.sqrt(-2 * Math.log(safeFirst)) * Math.cos(2 * Math.PI * safeSecond);
}

function mulberry32(seed: number): () => number {
  return () => {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
