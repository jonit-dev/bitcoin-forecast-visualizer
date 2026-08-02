import { describe, expect, it } from 'vitest';
import {
  cdfAt,
  normalQuantile,
  quantileAt,
  standardizedStudentTScale,
  studentTCdf,
  studentTQuantile,
} from '../predictiveDistribution';

const PUBLISHED_STUDENT_T_QUANTILES: Record<number, [number, number, number]> = {
  3: [-3.18244630528, -2.3533634348, -1.6377443537],
  5: [-2.57058183564, -2.01504837333, -1.47588404882],
  10: [-2.22813885199, -1.81246112281, -1.37218364111],
  30: [-2.0422724563, -1.69726088659, -1.31041502539],
};

describe('predictive distributions', () => {
  it('should match published Student-t quantiles within 1e-6 for nu in 3, 5, 10 and 30', () => {
    for (const [nuText, expectedQuantiles] of Object.entries(PUBLISHED_STUDENT_T_QUANTILES)) {
      const nu = Number(nuText);
      for (const [index, probability] of [0.025, 0.05, 0.10].entries()) {
        expect(studentTQuantile(probability, nu)).toBeCloseTo(expectedQuantiles[index], 6);
      }
    }
  });

  it('should converge to the normal quantile as nu grows large', () => {
    for (const probability of [0.025, 0.05, 0.10, 0.5, 0.9, 0.975]) {
      expect(Math.abs(studentTQuantile(probability, 1_000_000) - normalQuantile(probability))).toBeLessThan(1e-4);
    }
  });

  it('should reject a degrees-of-freedom value at or below two', () => {
    expect(() => studentTQuantile(0.1, 2)).toThrow(/greater than two/);
    expect(() => studentTCdf(1, 1.5)).toThrow(/greater than two/);
    expect(() => standardizedStudentTScale(2)).toThrow(/greater than two/);
  });

  it('should leave the median unchanged when the distribution family changes', () => {
    const median = 100_000;
    const sigma = 0.42;
    expect(quantileAt({ kind: 'lognormal' }, median, sigma, 0.5)).toBe(median);
    expect(quantileAt({ kind: 'student-t', nu: 5 }, median, sigma, 0.5)).toBe(median);
  });

  it('should round-trip Student-t price quantiles through its CDF', () => {
    const distribution = { kind: 'student-t' as const, nu: 5 };
    const median = 100_000;
    const sigma = 0.35;
    for (const probability of [0.025, 0.10, 0.5, 0.9, 0.975]) {
      expect(cdfAt(distribution, median, sigma, quantileAt(distribution, median, sigma, probability)))
        .toBeCloseTo(probability, 10);
    }
  });

  it('should use deliberate CDF boundary behavior for both distribution families', () => {
    const distributions = [
      { kind: 'lognormal' as const },
      { kind: 'student-t' as const, nu: 5 },
    ];
    const median = 100_000;
    const sigma = 0.35;

    for (const distribution of distributions) {
      expect(cdfAt(distribution, median, sigma, Number.POSITIVE_INFINITY)).toBe(1);
      expect(cdfAt(distribution, median, sigma, Number.NEGATIVE_INFINITY)).toBe(0);
      expect(cdfAt(distribution, median, sigma, Number.NaN)).toBeNaN();
    }
  });

  it('should preserve the unit-variance sigma convention', () => {
    expect(standardizedStudentTScale(5)).toBeCloseTo(Math.sqrt(3 / 5), 14);
  });
});
