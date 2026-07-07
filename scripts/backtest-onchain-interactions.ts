import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import btcHistory from '../src/data/btc-history.json';
import featureTable from '../src/data/feature-table.json';
import type { OHLCVData } from '../src/lib/api';
import type { FeatureRow } from '../src/lib/features';
import { getBacktestModels } from '../src/lib/backtestModels';

interface StateSpec {
  id: string;
  description: string;
  isActive: (context: StateContext) => boolean;
}

interface StateContext {
  row: FeatureRow;
  index: number;
  activeAddressTrend30d: number | null;
  transactionTrend30d: number | null;
  transferTrend30d: number | null;
  minerRevenueZ365d: number | null;
}

interface MetricSummary {
  samples: number;
  selectedCoefficient: number;
  medianAbsLogError: number | null;
  baselineMedianAbsLogError: number | null;
  meanAbsLogError: number | null;
  baselineMeanAbsLogError: number | null;
  meanImprovementVsBaseline: number | null;
  bootstrapLower95MeanImprovement: number | null;
  directionHitRate: number | null;
  baselineDirectionHitRate: number | null;
  medianForwardReturn: number | null;
}

interface StateReport {
  id: string;
  description: string;
  selectedCoefficientByHorizon: Record<string, number>;
  validationThinned: Record<string, MetricSummary>;
  holdoutThinned: Record<string, MetricSummary>;
  verdict: 'candidate' | 'context-only' | 'reject';
  verdictReason: string;
}

const BTC_ROWS = btcHistory as OHLCVData[];
const FEATURE_ROWS = featureTable as FeatureRow[];
const FEATURE_BY_DATE = new Map(FEATURE_ROWS.map(row => [row.date, row]));
const FEATURE_INDEX_BY_DATE = new Map(FEATURE_ROWS.map((row, index) => [row.date, index]));
const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');
const VALIDATION_START = '2022-01-01';
const VALIDATION_END = '2024-12-31';
const HOLDOUT_START = '2025-01-01';
const HORIZONS = [30, 60, 90, 180];
const REQUIRED_MIN_HOLDOUT_SAMPLES = 5;
const COEFFICIENT_GRID = [-0.35, -0.25, -0.18, -0.12, -0.08, -0.04, 0, 0.04, 0.08, 0.12, 0.18, 0.25, 0.35];
const BOOTSTRAP_ITERATIONS = 400;
const MIN_LOOKBACK = 365;

const STATES: StateSpec[] = [
  {
    id: 'cheap-and-active',
    description: 'Cheap valuation with rising active-address or transaction activity.',
    isActive: context => isCheap(context.row.features) && activityTrend(context) >= 0.08,
  },
  {
    id: 'cheap-and-dead',
    description: 'Cheap valuation with falling active-address and transaction activity.',
    isActive: context => isCheap(context.row.features) && activityTrend(context) <= -0.08,
  },
  {
    id: 'miner-stress',
    description: 'Low miner revenue proxy versus prior year plus large drawdown.',
    isActive: context => (context.minerRevenueZ365d ?? 0) <= -1 && (context.row.features.drawdownFromCycleHigh ?? 0) <= -0.45,
  },
  {
    id: 'network-expansion',
    description: 'Rising activity trend with positive 30d residual momentum.',
    isActive: context => activityTrend(context) >= 0.10 && (context.row.features.residualMomentum30d ?? 0) > 0,
  },
  {
    id: 'valuation-activity-divergence',
    description: 'Cheap valuation paired with weak or negative activity trend.',
    isActive: context => isCheap(context.row.features) && activityTrend(context) <= 0,
  },
];

function main(): void {
  const powerlaw = getBacktestModels().find(model => model.id === 'powerlaw-current');
  if (!powerlaw) throw new Error('powerlaw-current model not found');

  const contexts = buildStateContexts();
  const reports = STATES.map(state => evaluateState(powerlaw, contexts, state));
  const report = {
    generatedAt: new Date().toISOString(),
    data: {
      btcRows: BTC_ROWS.length,
      btcFirstDate: BTC_ROWS[0]?.date,
      btcLastDate: BTC_ROWS.at(-1)?.date,
      featureRows: FEATURE_ROWS.length,
      featureFirstDate: FEATURE_ROWS[0]?.date,
      featureLastDate: FEATURE_ROWS.at(-1)?.date,
    },
    preRegistration: {
      purpose: 'Research-only on-chain interaction regime experiment; do not test simple single-feature MVRV/activity median tweaks.',
      validationPeriod: `${VALIDATION_START} through ${VALIDATION_END}`,
      finalHoldoutPeriod: `${HOLDOUT_START} through latest available target`,
      horizons: HORIZONS,
      baseline: 'powerlaw-current median forecast',
      modelForm: 'state-specific candidate median = baseline median * exp(validation-selected coefficient); only active-state origins are evaluated.',
      states: STATES.map(state => ({ id: state.id, description: state.description })),
      leakagePolicy: 'feature rows are keyed by forecast origin and source dates are validated one-day lagged; activity/miner trends use only prior feature rows.',
      promotionGate: 'at least 5 thinned holdout samples at claimed horizon, positive validation improvement, positive holdout improvement with positive lower95 bound, no material adjacent-horizon degradation, and interpretable state definition.',
    },
    states: reports,
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `btc-onchain-interactions-${stamp}.json`);
  const mdPath = join(REPORT_DIR, `btc-onchain-interactions-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(mdPath, renderMarkdown(report));
  console.log(`BTC on-chain interactions report: ${jsonPath}`);
  console.log(`BTC on-chain interactions markdown: ${mdPath}`);
  printSummary(reports);
}

function evaluateState(
  powerlaw: NonNullable<ReturnType<typeof getBacktestModels>[number]>,
  contexts: Map<string, StateContext>,
  state: StateSpec
): StateReport {
  const selectedCoefficientByHorizon: Record<string, number> = {};
  for (const horizon of HORIZONS) {
    const best = COEFFICIENT_GRID
      .map(coefficient => ({
        coefficient,
        metric: evaluateMetric(powerlaw, contexts, state, horizon, VALIDATION_START, VALIDATION_END, horizon, coefficient),
      }))
      .filter(item => item.metric.meanAbsLogError !== null)
      .sort((a, b) => (a.metric.meanAbsLogError ?? Infinity) - (b.metric.meanAbsLogError ?? Infinity))[0];
    selectedCoefficientByHorizon[String(horizon)] = best?.coefficient ?? 0;
  }

  const validationThinned = Object.fromEntries(HORIZONS.map(horizon => [
    String(horizon),
    evaluateMetric(powerlaw, contexts, state, horizon, VALIDATION_START, VALIDATION_END, horizon, selectedCoefficientByHorizon[String(horizon)]),
  ]));
  const holdoutThinned = Object.fromEntries(HORIZONS.map(horizon => [
    String(horizon),
    evaluateMetric(powerlaw, contexts, state, horizon, HOLDOUT_START, null, horizon, selectedCoefficientByHorizon[String(horizon)]),
  ]));
  const verdict = classifyVerdict(validationThinned, holdoutThinned);

  return {
    id: state.id,
    description: state.description,
    selectedCoefficientByHorizon,
    validationThinned,
    holdoutThinned,
    verdict: verdict.verdict,
    verdictReason: verdict.reason,
  };
}

function evaluateMetric(
  powerlaw: NonNullable<ReturnType<typeof getBacktestModels>[number]>,
  contexts: Map<string, StateContext>,
  state: StateSpec,
  horizonDays: number,
  startDate: string,
  endDate: string | null,
  spacingDays: number,
  coefficient: number
): MetricSummary {
  const absErrors: number[] = [];
  const baselineAbsErrors: number[] = [];
  const improvements: number[] = [];
  const directionHits: number[] = [];
  const baselineDirectionHits: number[] = [];
  const forwardReturns: number[] = [];

  for (let originIndex = MIN_LOOKBACK; originIndex + horizonDays < BTC_ROWS.length; originIndex += spacingDays) {
    const origin = BTC_ROWS[originIndex];
    if (origin.date < startDate) continue;
    if (endDate && origin.date > endDate) continue;
    const context = contexts.get(origin.date);
    if (!context || !state.isActive(context)) continue;
    const target = BTC_ROWS[originIndex + horizonDays];
    const forecast = powerlaw.forecast(BTC_ROWS, originIndex, horizonDays);
    if (!forecast || !Number.isFinite(forecast.median) || forecast.median <= 0) continue;

    const adjustedMedian = forecast.median * Math.exp(coefficient);
    const actualLog = Math.log(target.close);
    const baselineLog = Math.log(forecast.median);
    const adjustedLog = Math.log(adjustedMedian);
    const actualReturn = Math.log(target.close / origin.close);
    const adjustedReturn = Math.log(adjustedMedian / origin.close);
    const baselineReturn = Math.log(forecast.median / origin.close);
    const absError = Math.abs(actualLog - adjustedLog);
    const baselineAbsError = Math.abs(actualLog - baselineLog);
    absErrors.push(absError);
    baselineAbsErrors.push(baselineAbsError);
    improvements.push(baselineAbsError - absError);
    directionHits.push(Math.sign(actualReturn) === Math.sign(adjustedReturn) ? 1 : 0);
    baselineDirectionHits.push(Math.sign(actualReturn) === Math.sign(baselineReturn) ? 1 : 0);
    forwardReturns.push(actualReturn);
  }

  return {
    samples: absErrors.length,
    selectedCoefficient: coefficient,
    medianAbsLogError: median(absErrors),
    baselineMedianAbsLogError: median(baselineAbsErrors),
    meanAbsLogError: mean(absErrors),
    baselineMeanAbsLogError: mean(baselineAbsErrors),
    meanImprovementVsBaseline: mean(improvements),
    bootstrapLower95MeanImprovement: bootstrapLower95(improvements, Math.max(1, Math.min(horizonDays, improvements.length || 1))),
    directionHitRate: mean(directionHits),
    baselineDirectionHitRate: mean(baselineDirectionHits),
    medianForwardReturn: median(forwardReturns),
  };
}

function buildStateContexts(): Map<string, StateContext> {
  const minerHistory: number[] = [];
  const contexts = new Map<string, StateContext>();
  for (let index = 0; index < FEATURE_ROWS.length; index++) {
    const row = FEATURE_ROWS[index];
    const activeAddressTrend30d = trend(row, index, 'activeAddresses', 30);
    const transactionTrend30d = trend(row, index, 'transactionCount', 30);
    const transferTrend30d = trend(row, index, 'transferCount', 30);
    const miner = row.features.minerStressProxy;
    const minerRevenueZ365d = Number.isFinite(miner) && minerHistory.length >= 300 ? zScore(minerHistory.slice(-365), miner) : null;
    contexts.set(row.date, {
      row,
      index,
      activeAddressTrend30d,
      transactionTrend30d,
      transferTrend30d,
      minerRevenueZ365d,
    });
    if (Number.isFinite(miner)) minerHistory.push(miner);
  }
  return contexts;
}

function trend(row: FeatureRow, index: number, featureName: string, lookback: number): number | null {
  if (index < lookback) return null;
  const current = row.features[featureName];
  const prior = FEATURE_ROWS[index - lookback]?.features[featureName];
  if (!Number.isFinite(current) || !Number.isFinite(prior) || current <= 0 || prior <= 0) return null;
  return Math.log(current / prior);
}

function isCheap(features: Record<string, number>): boolean {
  const mvrvCheap = Number.isFinite(features.mvrvPercentile) && features.mvrvPercentile <= 0.25;
  const realizedCheap = Number.isFinite(features.realizedPriceDistance) && features.realizedPriceDistance <= 0.15;
  const residualCheap = Number.isFinite(features.priceResidualLog) && features.priceResidualLog <= -0.35;
  return mvrvCheap || (realizedCheap && residualCheap);
}

function activityTrend(context: StateContext): number {
  const values = [context.activeAddressTrend30d, context.transactionTrend30d, context.transferTrend30d].filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function classifyVerdict(
  validation: Record<string, MetricSummary>,
  holdout: Record<string, MetricSummary>
): { verdict: StateReport['verdict']; reason: string } {
  const eligible = HORIZONS.filter(horizon => holdout[String(horizon)].samples >= REQUIRED_MIN_HOLDOUT_SAMPLES);
  const passes = eligible.filter(horizon => {
    const v = validation[String(horizon)];
    const h = holdout[String(horizon)];
    return (v.meanImprovementVsBaseline ?? -Infinity) > 0 &&
      (h.meanImprovementVsBaseline ?? -Infinity) > 0 &&
      (h.bootstrapLower95MeanImprovement ?? -Infinity) > 0;
  });
  const materialDegradations = eligible.filter(horizon => (holdout[String(horizon)].meanImprovementVsBaseline ?? 0) < -0.01);

  if (passes.length > 0 && materialDegradations.length === 0) {
    return { verdict: 'candidate', reason: 'At least one eligible horizon passed validation and holdout improvement gates without material adjacent degradation; requires manual review before product use.' };
  }
  const best = Math.max(...eligible.map(horizon => holdout[String(horizon)].meanImprovementVsBaseline ?? -Infinity));
  if (best > 0) {
    return { verdict: 'context-only', reason: 'Some holdout improvement exists, but sample count, validation, lower-bound, or adjacent-horizon checks did not justify forecast influence.' };
  }
  return { verdict: 'reject', reason: 'No eligible interaction state passed the thinned holdout improvement gate.' };
}

function zScore(values: number[], value: number): number | null {
  const finite = values.filter(Number.isFinite);
  if (finite.length < 30) return null;
  const avg = finite.reduce((sum, item) => sum + item, 0) / finite.length;
  const variance = finite.reduce((sum, item) => sum + (item - avg) ** 2, 0) / finite.length;
  const sd = Math.sqrt(variance);
  return sd > 0 ? (value - avg) / sd : null;
}

function mean(values: number[]): number | null {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

function median(values: number[]): number | null {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return null;
  const mid = Math.floor(finite.length / 2);
  return finite.length % 2 === 0 ? (finite[mid - 1] + finite[mid]) / 2 : finite[mid];
}

function bootstrapLower95(values: number[], blockLength: number): number | null {
  if (values.length < 10) return null;
  const samples: number[] = [];
  const blocks: number[][] = [];
  for (let i = 0; i < values.length; i += blockLength) blocks.push(values.slice(i, i + blockLength));
  for (let iter = 0; iter < BOOTSTRAP_ITERATIONS; iter++) {
    const sampled: number[] = [];
    while (sampled.length < values.length) {
      const block = blocks[Math.floor(random(iter, sampled.length) * blocks.length)];
      sampled.push(...block);
    }
    samples.push(mean(sampled.slice(0, values.length)) ?? 0);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length * 0.05)] ?? null;
}

function random(seedA: number, seedB: number): number {
  const x = Math.sin((seedA + 1) * 10000 + (seedB + 1) * 9973) * 10000;
  return x - Math.floor(x);
}

function renderMarkdown(report: any): string {
  const lines = [
    '# BTC On-Chain Interaction Regimes',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Setup',
    '',
    `- Validation: ${report.preRegistration.validationPeriod}`,
    `- Final holdout: ${report.preRegistration.finalHoldoutPeriod}`,
    `- Baseline: ${report.preRegistration.baseline}`,
    `- Model form: ${report.preRegistration.modelForm}`,
    `- Leakage policy: ${report.preRegistration.leakagePolicy}`,
    `- Promotion gate: ${report.preRegistration.promotionGate}`,
    '- Diagnostic policy: sparse event/state outputs are diagnostics only; `npm run backtest:features-continuous` is the PRD v2.9 promotion gate.',
    '',
    '## State summary',
    '',
  ];
  for (const state of report.states as StateReport[]) {
    lines.push(`### ${state.id}`);
    lines.push('');
    lines.push(`- Verdict: **${state.verdict}** — ${state.verdictReason}`);
    lines.push(`- Description: ${state.description}`);
    lines.push('- Holdout thinned target horizons:');
    for (const horizon of HORIZONS) {
      const metric = state.holdoutThinned[String(horizon)];
      lines.push(`  - ${horizon}d: samples=${metric.samples}, coefficient=${fmtNum(metric.selectedCoefficient)}, mean improvement=${fmtPct(metric.meanImprovementVsBaseline)}, lower95=${fmtPct(metric.bootstrapLower95MeanImprovement)}, median abs log error=${fmtNum(metric.medianAbsLogError)}, baseline=${fmtNum(metric.baselineMedianAbsLogError)}, median forward return=${fmtPct(metric.medianForwardReturn)}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function printSummary(reports: StateReport[]): void {
  console.log('On-chain interaction holdout summary:');
  for (const state of reports) {
    const best = HORIZONS
      .map(horizon => ({ horizon, metric: state.holdoutThinned[String(horizon)] }))
      .sort((a, b) => (b.metric.meanImprovementVsBaseline ?? -Infinity) - (a.metric.meanImprovementVsBaseline ?? -Infinity))[0];
    console.log(`${state.id} verdict=${state.verdict} best=${best?.horizon}d n=${best?.metric.samples ?? 0} improvement=${fmtPct(best?.metric.meanImprovementVsBaseline ?? null)} lower95=${fmtPct(best?.metric.bootstrapLower95MeanImprovement ?? null)}`);
  }
}

function fmtPct(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : `${(value * 100).toFixed(2)}%`;
}

function fmtNum(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : value.toFixed(4);
}

main();
