import type { FeatureRow } from './features';

export type RegimeState =
  | 'accumulation-value'
  | 'trend-expansion'
  | 'late-cycle-overheating'
  | 'deleveraging-bear'
  | 'sideways-chop';

export interface RegimeClassification {
  probabilities: Record<RegimeState, number>;
  topState: RegimeState;
  reasonCodes: string[];
  contextOnly: true;
}

const STATES: RegimeState[] = [
  'accumulation-value',
  'trend-expansion',
  'late-cycle-overheating',
  'deleveraging-bear',
  'sideways-chop',
];

export function classifyRegime(row: FeatureRow | null | undefined): RegimeClassification {
  if (!row) return normalizeScores({ 'sideways-chop': 1 }, ['missing-feature-row']);
  const f = row.features;
  const scores: Partial<Record<RegimeState, number>> = {
    'accumulation-value': 0.4,
    'trend-expansion': 0.4,
    'late-cycle-overheating': 0.4,
    'deleveraging-bear': 0.4,
    'sideways-chop': 0.4,
  };
  const reasons: string[] = [];

  if (f.priceResidualLog < -0.25 || f.mvrvPercentile < 0.25) {
    scores['accumulation-value']! += 1.2;
    reasons.push('value-discount');
  }
  if (f.residualMomentum30d > 0.08 && f.mvrvLevel < 3.5) {
    scores['trend-expansion']! += 1.1;
    reasons.push('positive-residual-momentum');
  }
  if (f.mvrvPercentile > 0.85 || f.realizedPriceDistance > 1.8) {
    scores['late-cycle-overheating']! += 1.2;
    reasons.push('valuation-stretched');
  }
  if (f.drawdownFromCycleHigh < -0.35 || f.residualMomentum30d < -0.12) {
    scores['deleveraging-bear']! += 1.2;
    reasons.push('drawdown-or-negative-momentum');
  }
  if (Math.abs(f.residualMomentum30d ?? 0) < 0.04 && (f.volatilityRegime30d ?? 1) < 0.65) {
    scores['sideways-chop']! += 0.9;
    reasons.push('low-momentum-low-volatility');
  }
  if (f.hashRate && f.hashRate > 0) {
    scores['trend-expansion']! += 0.15;
    reasons.push('hashrate-available');
  }

  return normalizeScores(scores, reasons.slice(0, 4));
}

function normalizeScores(scores: Partial<Record<RegimeState, number>>, reasonCodes: string[]): RegimeClassification {
  const total = STATES.reduce((sum, state) => sum + Math.max(0.001, scores[state] ?? 0.001), 0);
  const probabilities = Object.fromEntries(
    STATES.map(state => [state, Math.max(0.001, scores[state] ?? 0.001) / total])
  ) as Record<RegimeState, number>;
  const topState = STATES.reduce((best, state) => probabilities[state] > probabilities[best] ? state : best, STATES[0]);

  return {
    probabilities,
    topState,
    reasonCodes: reasonCodes.length > 0 ? reasonCodes : ['balanced-feature-state'],
    contextOnly: true,
  };
}
