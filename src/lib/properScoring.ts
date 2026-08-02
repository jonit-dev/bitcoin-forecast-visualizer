import { cdfAt, type PredictiveDistribution } from './predictiveDistribution';

export interface PitHistogram {
  bins: number;
  counts: number[];
  expectedCounts: number[];
  binEdges: number[];
  samples: number;
}

export interface PitUniformityStatistic {
  bins: number;
  samples: number;
  chiSquare: number;
  degreesOfFreedom: number;
}

type QuantilePoint = { probability: number; value: number };
export type QuantileInput =
  | Record<string, number | null | undefined>
  | readonly (readonly [number, number])[]
  | readonly { probability: number; value: number }[];

const NAMED_QUANTILES: Record<string, number> = {
  q025: 0.025,
  q05: 0.05,
  q10: 0.10,
  q50: 0.50,
  q90: 0.90,
  q95: 0.95,
  q975: 0.975,
};

export const CRPS_METHOD_METADATA = {
  method: 'quantile pinball integral identity with trapezoidal quadrature',
  quantileGrid: ['q025', 'q05', 'q10', 'q50', 'q90', 'q95', 'q975'],
  tailConvention: 'Endpoint-constant extension over the full probability domain: Q(p) equals the first supplied quantile below the first grid probability and the last supplied quantile above the last grid probability.',
  approximationErrorBound: null,
  approximationErrorBoundStatement: 'A numeric approximation-error bound is not estimable from this sparse quantile grid and endpoint-tail assumption.',
  label: 'Approximate CRPS (sparse quantile grid; endpoint-constant tails)',
} as const;

/**
 * Approximate CRPS from the supplied quantile grid using the full-domain
 * identity CRPS(F, y) = 2 * integral rho_p(y - Q(p)) dp and trapezoidal
 * integration. Outside the supplied probabilities, Q(p) is held constant at
 * the nearest endpoint quantile. Those endpoint-tail segments are included
 * in the [0, 1] integral and are exact for the fixed endpoint quantile because
 * pinball loss is linear in p.
 *
 * The result still inherits discretisation error from the sparse interior
 * grid; a numeric error bound is not estimable without stronger assumptions
 * about the unknown quantile function. Fewer than three valid quantiles
 * returns null.
 */
export function crpsFromQuantiles(actual: number, quantiles: QuantileInput): number | null {
  if (!Number.isFinite(actual)) return null;
  const points = normalizeQuantiles(quantiles);
  if (points.length < 3) return null;

  const extendedPoints = [
    { probability: 0, value: points[0].value },
    ...points,
    { probability: 1, value: points[points.length - 1].value },
  ];
  let integral = 0;
  for (let index = 1; index < extendedPoints.length; index++) {
    const left = extendedPoints[index - 1];
    const right = extendedPoints[index];
    const spacing = right.probability - left.probability;
    if (spacing <= 0) continue;
    const leftLoss = quantilePinballLoss(actual, left.value, left.probability);
    const rightLoss = quantilePinballLoss(actual, right.value, right.probability);
    // The factor two in the CRPS identity cancels the one-half in the
    // trapezoidal rule.
    integral += spacing * (leftLoss + rightLoss);
  }

  return Number.isFinite(integral) ? integral : null;
}

/**
 * Evaluate the PIT for a log-normal forecast. Invalid or non-positive actual,
 * median, or sigma values are excluded rather than replaced with defaults.
 */
export function pitValue(
  actual: number,
  median: number,
  sigma: number | null | undefined,
  distribution: PredictiveDistribution = { kind: 'lognormal' }
): number | null {
  if (!Number.isFinite(actual) || actual <= 0) return null;
  if (!Number.isFinite(median) || median <= 0) return null;
  if (!Number.isFinite(sigma) || sigma <= 0) return null;
  return cdfAt(distribution, median, sigma, actual);
}

/** Return PIT counts and the uniform expected count, or null with no valid samples. */
export function pitHistogram(values: readonly number[], bins = 10): PitHistogram | null {
  if (!Number.isInteger(bins) || bins < 2) return null;
  const validValues = values.filter(value => Number.isFinite(value) && value >= 0 && value <= 1);
  if (validValues.length === 0) return null;
  const counts = Array.from({ length: bins }, () => 0);
  for (const value of validValues) {
    const index = value === 1 ? bins - 1 : Math.floor(value * bins);
    counts[index]++;
  }
  const expectedCount = validValues.length / bins;
  return {
    bins,
    counts,
    expectedCounts: counts.map(() => expectedCount),
    binEdges: Array.from({ length: bins + 1 }, (_, index) => index / bins),
    samples: validValues.length,
  };
}

/**
 * Return the chi-square statistic and degrees of freedom for PIT uniformity.
 * No p-value is emitted: overlapping forecast origins make PIT observations
 * serially dependent, so a nominal independent-sample p-value is misleading.
 */
export function pitUniformityStatistic(values: readonly number[], bins = 10): PitUniformityStatistic | null {
  const histogram = pitHistogram(values, bins);
  if (!histogram || histogram.samples === 0) return null;
  const chiSquare = histogram.counts.reduce((total, count, index) => {
    const expected = histogram.expectedCounts[index];
    return expected > 0 ? total + (count - expected) ** 2 / expected : total;
  }, 0);
  return {
    bins: histogram.bins,
    samples: histogram.samples,
    chiSquare,
    degreesOfFreedom: histogram.bins - 1,
  };
}

/** Calculate the Winkler interval score at nominal miscoverage alpha. */
export function winklerScore(actual: number, low: number, high: number, alpha: number): number | null {
  if (!Number.isFinite(actual) || !Number.isFinite(low) || !Number.isFinite(high)) return null;
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1 || high < low) return null;
  const penalty = 2 / alpha;
  return (high - low) + penalty * Math.max(low - actual, 0) + penalty * Math.max(actual - high, 0);
}

function normalizeQuantiles(input: QuantileInput): QuantilePoint[] {
  const points: QuantilePoint[] = Array.isArray(input)
    ? input.map(item => Array.isArray(item)
      ? { probability: item[0], value: item[1] }
      : { probability: item.probability, value: item.value })
    : Object.entries(input).map(([key, value]) => ({
      probability: NAMED_QUANTILES[key] ?? Number(key),
      value: value as number,
    }));

  const valid = points.filter(point =>
    Number.isFinite(point.probability) && point.probability > 0 && point.probability < 1 && Number.isFinite(point.value)
  );
  const deduplicated = new Map<number, QuantilePoint>();
  for (const point of valid) deduplicated.set(point.probability, point);
  return [...deduplicated.values()].sort((left, right) => left.probability - right.probability);
}

function quantilePinballLoss(actual: number, predicted: number, probability: number): number {
  const error = actual - predicted;
  return Math.max(probability * error, (probability - 1) * error);
}
