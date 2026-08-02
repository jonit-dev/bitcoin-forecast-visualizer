import type { FeatureRow } from './features';

export type RegimeState =
  | 'accumulation-value'
  | 'trend-expansion'
  | 'late-cycle-overheating'
  | 'deleveraging-bear'
  | 'sideways-chop'
  | 'insufficient-data';

export interface RegimeClassification {
  probabilities: Record<RegimeState, number>;
  topState: RegimeState;
  reasonCodes: string[];
  contextOnly: true;
}

export const MAX_UNAVAILABLE_FEATURE_FRACTION = 0.4;

const SCORING_STATES: Exclude<RegimeState, 'insufficient-data'>[] = [
  'accumulation-value',
  'trend-expansion',
  'late-cycle-overheating',
  'deleveraging-bear',
  'sideways-chop',
];

const REGIME_INPUT_FEATURES = [
  'priceResidualLog',
  'mvrvPercentile',
  'residualMomentum30d',
  'mvrvLevel',
  'realizedPriceDistance',
  'drawdownFromCycleHigh',
  'futuresOpenInterestToMarketCap',
  'futuresFundingRateDailySum',
  'volatilityRegime30d',
  'hashRate',
] as const;

function finiteFeature(features: Record<string, number>, name: string): number | null {
  return Number.isFinite(features[name]) ? features[name] : null;
}

function uniqueReasons(reasons: string[]): string[] {
  return [...new Set(reasons)];
}

function insufficientDataClassification(reasonCodes: string[], unavailableCount: number, inputCount: number): RegimeClassification {
  const probabilities = {
    'accumulation-value': 0,
    'trend-expansion': 0,
    'late-cycle-overheating': 0,
    'deleveraging-bear': 0,
    'sideways-chop': 0,
    'insufficient-data': 1,
  } satisfies Record<RegimeState, number>;
  return {
    probabilities,
    topState: 'insufficient-data',
    reasonCodes: uniqueReasons([
      ...reasonCodes,
      `insufficient-data:${unavailableCount}/${inputCount}-inputs-unavailable`,
    ]),
    contextOnly: true,
  };
}

export function classifyRegime(row: FeatureRow | null | undefined): RegimeClassification {
  if (!row) return insufficientDataClassification(['missing-feature-row'], REGIME_INPUT_FEATURES.length, REGIME_INPUT_FEATURES.length);

  const f = row.features;
  const values = Object.fromEntries(
    REGIME_INPUT_FEATURES.map(name => [name, finiteFeature(f, name)])
  ) as Record<(typeof REGIME_INPUT_FEATURES)[number], number | null>;
  const unavailable = REGIME_INPUT_FEATURES.filter(name => values[name] === null);
  const unavailableReasons = unavailable.map(name => `unavailable:${name}`);
  if (unavailable.length / REGIME_INPUT_FEATURES.length >= MAX_UNAVAILABLE_FEATURE_FRACTION) {
    return insufficientDataClassification(unavailableReasons, unavailable.length, REGIME_INPUT_FEATURES.length);
  }

  const scores: Partial<Record<Exclude<RegimeState, 'insufficient-data'>, number>> = {
    'accumulation-value': 0.4,
    'trend-expansion': 0.4,
    'late-cycle-overheating': 0.4,
    'deleveraging-bear': 0.4,
    'sideways-chop': 0.4,
  };
  const reasons: string[] = [...unavailableReasons];

  if ((values.priceResidualLog !== null && values.priceResidualLog < -0.25) ||
      (values.mvrvPercentile !== null && values.mvrvPercentile < 0.25)) {
    scores['accumulation-value']! += 1.2;
    reasons.push('value-discount');
  }
  if (values.residualMomentum30d !== null && values.mvrvLevel !== null &&
      values.residualMomentum30d > 0.08 && values.mvrvLevel < 3.5) {
    scores['trend-expansion']! += 1.1;
    reasons.push('positive-residual-momentum');
  }
  if ((values.mvrvPercentile !== null && values.mvrvPercentile > 0.85) ||
      (values.realizedPriceDistance !== null && values.realizedPriceDistance > 1.8)) {
    scores['late-cycle-overheating']! += 1.2;
    reasons.push('valuation-stretched');
  }
  if ((values.drawdownFromCycleHigh !== null && values.drawdownFromCycleHigh < -0.35) ||
      (values.residualMomentum30d !== null && values.residualMomentum30d < -0.12)) {
    scores['deleveraging-bear']! += 1.2;
    reasons.push('drawdown-or-negative-momentum');
  }
  if (values.futuresOpenInterestToMarketCap !== null && values.futuresFundingRateDailySum !== null &&
      values.futuresOpenInterestToMarketCap > 0.0035 && values.futuresFundingRateDailySum > 0.00025) {
    scores['late-cycle-overheating']! += 0.5;
    scores['deleveraging-bear']! += 0.3;
    reasons.push('elevated-futures-leverage');
  }
  if (values.futuresFundingRateDailySum !== null && values.futuresFundingRateDailySum < -0.00015) {
    scores['accumulation-value']! += 0.25;
    reasons.push('negative-perp-funding');
  }
  if (values.residualMomentum30d !== null && values.volatilityRegime30d !== null &&
      Math.abs(values.residualMomentum30d) < 0.04 && values.volatilityRegime30d < 0.65) {
    scores['sideways-chop']! += 0.9;
    reasons.push('low-momentum-low-volatility');
  }
  if (values.hashRate !== null && values.hashRate > 0) {
    scores['trend-expansion']! += 0.15;
    reasons.push('hashrate-available');
  }

  return normalizeScores(scores, reasons.length > 0 ? reasons : ['balanced-feature-state']);
}

function normalizeScores(
  scores: Partial<Record<Exclude<RegimeState, 'insufficient-data'>, number>>,
  reasonCodes: string[]
): RegimeClassification {
  const total = SCORING_STATES.reduce((sum, state) => sum + Math.max(0.001, scores[state] ?? 0.001), 0);
  const probabilities = Object.fromEntries(
    SCORING_STATES.map(state => [state, Math.max(0.001, scores[state] ?? 0.001) / total])
  ) as Record<Exclude<RegimeState, 'insufficient-data'>, number>;
  const fullProbabilities = {
    ...probabilities,
    'insufficient-data': 0,
  } satisfies Record<RegimeState, number>;
  const topState = SCORING_STATES.reduce(
    (best, state) => fullProbabilities[state] > fullProbabilities[best] ? state : best,
    SCORING_STATES[0]
  );

  return {
    probabilities: fullProbabilities,
    topState,
    reasonCodes: uniqueReasons(reasonCodes),
    contextOnly: true,
  };
}
