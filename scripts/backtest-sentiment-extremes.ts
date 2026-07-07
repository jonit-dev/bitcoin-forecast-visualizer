import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import btcHistory from '../src/data/btc-history.json';
import featureTable from '../src/data/feature-table.json';
import type { OHLCVData } from '../src/lib/api';
import type { FeatureRow } from '../src/lib/features';
import { getBacktestModels } from '../src/lib/backtestModels';

interface EventSpec {
  id: string;
  description: string;
  priceBaselineId: string;
  isActive: (features: Record<string, number>) => boolean;
  priceBaseline: (features: Record<string, number>) => boolean;
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
  upRate: number | null;
  baselineEventUpRate: number | null;
  priceBaselineSamples: number;
  priceBaselineMedianForwardReturn: number | null;
  priceBaselineUpRate: number | null;
  eventExcessUpRateVsPriceBaseline: number | null;
  medianForwardReturn: number | null;
}

interface EventReport {
  id: string;
  description: string;
  priceBaselineId: string;
  selectedCoefficientByHorizon: Record<string, number>;
  validationThinned: Record<string, MetricSummary>;
  holdoutThinned: Record<string, MetricSummary>;
  verdict: 'promote' | 'context-only' | 'reject';
  verdictReason: string;
}

const BTC_ROWS = btcHistory as OHLCVData[];
const FEATURE_ROWS = featureTable as FeatureRow[];
const FEATURE_BY_DATE = new Map(FEATURE_ROWS.map(row => [row.date, row]));
const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');
const VALIDATION_START = '2022-01-01';
const VALIDATION_END = '2024-12-31';
const HOLDOUT_START = '2025-01-01';
const HORIZONS = [7, 14, 30, 60];
const MIN_HOLDOUT_SAMPLES = 10;
const COEFFICIENT_GRID = [-0.30, -0.22, -0.16, -0.10, -0.06, -0.03, 0, 0.03, 0.06, 0.10, 0.16, 0.22, 0.30];
const BOOTSTRAP_ITERATIONS = 400;
const MIN_LOOKBACK = 365;

const EVENTS: EventSpec[] = [
  {
    id: 'extreme-fear',
    description: 'Fear & Greed index at or below 25.',
    priceBaselineId: 'drawdown-or-negative-momentum',
    isActive: f => (f.fearGreedIndex ?? 101) <= 25,
    priceBaseline: f => (f.drawdownFromCycleHigh ?? 0) <= -0.20 || (f.residualMomentum30d ?? 0) < 0,
  },
  {
    id: 'extreme-greed',
    description: 'Fear & Greed index at or above 75.',
    priceBaselineId: 'positive-momentum-or-rich-residual',
    isActive: f => (f.fearGreedIndex ?? -1) >= 75,
    priceBaseline: f => (f.residualMomentum30d ?? 0) > 0 || (f.priceResidualLog ?? 0) > 0.25,
  },
  {
    id: 'fear-after-drawdown',
    description: 'Extreme fear after a drawdown of at least 20%.',
    priceBaselineId: 'drawdown-at-least-20pct',
    isActive: f => (f.fearGreedIndex ?? 101) <= 25 && (f.drawdownFromCycleHigh ?? 0) <= -0.20,
    priceBaseline: f => (f.drawdownFromCycleHigh ?? 0) <= -0.20,
  },
  {
    id: 'greed-after-rally',
    description: 'Extreme greed with positive residual momentum.',
    priceBaselineId: 'positive-residual-momentum',
    isActive: f => (f.fearGreedIndex ?? -1) >= 75 && (f.residualMomentum30d ?? 0) > 0,
    priceBaseline: f => (f.residualMomentum30d ?? 0) > 0,
  },
  {
    id: 'sentiment-price-divergence',
    description: 'Sentiment is fearful while price residual is not cheap.',
    priceBaselineId: 'non-cheap-residual',
    isActive: f => (f.fearGreedIndex ?? 101) <= 35 && (f.priceResidualLog ?? -Infinity) >= 0,
    priceBaseline: f => (f.priceResidualLog ?? -Infinity) >= 0,
  },
];

function main(): void {
  const powerlaw = getBacktestModels().find(model => model.id === 'powerlaw-current');
  if (!powerlaw) throw new Error('powerlaw-current model not found');

  const events = EVENTS.map(event => evaluateEvent(powerlaw, event));
  const report = {
    generatedAt: new Date().toISOString(),
    data: {
      btcRows: BTC_ROWS.length,
      btcFirstDate: BTC_ROWS[0]?.date,
      btcLastDate: BTC_ROWS.at(-1)?.date,
      featureRows: FEATURE_ROWS.length,
      featureFirstDate: FEATURE_ROWS[0]?.date,
      featureLastDate: FEATURE_ROWS.at(-1)?.date,
      sentimentFeatureRows: FEATURE_ROWS.filter(row => Number.isFinite(row.features.fearGreedIndex)).length,
    },
    preRegistration: {
      purpose: 'Research-only Alternative.me Fear & Greed event study; sentiment remains optional context unless the holdout gate passes.',
      validationPeriod: `${VALIDATION_START} through ${VALIDATION_END}`,
      finalHoldoutPeriod: `${HOLDOUT_START} through latest available target`,
      horizons: HORIZONS,
      baseline: 'powerlaw-current median forecast',
      modelForm: 'event-specific candidate median = baseline median * exp(validation-selected coefficient); only active-event origins are evaluated.',
      events: EVENTS.map(event => ({ id: event.id, description: event.description, priceBaselineId: event.priceBaselineId })),
      leakagePolicy: 'sentiment features are one-day lagged through build-feature-table.ts; price baselines use feature rows keyed by forecast origin.',
      promotionGate: 'at least 10 thinned holdout samples, positive validation improvement, positive holdout improvement with positive lower95 bound, and event behavior better than its price-only baseline.',
    },
    events,
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `btc-sentiment-extremes-${stamp}.json`);
  const mdPath = join(REPORT_DIR, `btc-sentiment-extremes-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(mdPath, renderMarkdown(report));
  console.log(`BTC sentiment extremes report: ${jsonPath}`);
  console.log(`BTC sentiment extremes markdown: ${mdPath}`);
  printSummary(events);
}

function evaluateEvent(powerlaw: NonNullable<ReturnType<typeof getBacktestModels>[number]>, event: EventSpec): EventReport {
  const selectedCoefficientByHorizon: Record<string, number> = {};
  for (const horizon of HORIZONS) {
    const best = COEFFICIENT_GRID
      .map(coefficient => ({
        coefficient,
        metric: evaluateMetric(powerlaw, event, horizon, VALIDATION_START, VALIDATION_END, horizon, coefficient),
      }))
      .filter(item => item.metric.meanAbsLogError !== null)
      .sort((a, b) => (a.metric.meanAbsLogError ?? Infinity) - (b.metric.meanAbsLogError ?? Infinity))[0];
    selectedCoefficientByHorizon[String(horizon)] = best?.coefficient ?? 0;
  }
  const validationThinned = Object.fromEntries(HORIZONS.map(horizon => [
    String(horizon),
    evaluateMetric(powerlaw, event, horizon, VALIDATION_START, VALIDATION_END, horizon, selectedCoefficientByHorizon[String(horizon)]),
  ]));
  const holdoutThinned = Object.fromEntries(HORIZONS.map(horizon => [
    String(horizon),
    evaluateMetric(powerlaw, event, horizon, HOLDOUT_START, null, horizon, selectedCoefficientByHorizon[String(horizon)]),
  ]));
  const verdict = classifyVerdict(validationThinned, holdoutThinned);
  return {
    id: event.id,
    description: event.description,
    priceBaselineId: event.priceBaselineId,
    selectedCoefficientByHorizon,
    validationThinned,
    holdoutThinned,
    verdict: verdict.verdict,
    verdictReason: verdict.reason,
  };
}

function evaluateMetric(
  powerlaw: NonNullable<ReturnType<typeof getBacktestModels>[number]>,
  event: EventSpec,
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
  const eventReturns: number[] = [];
  const priceBaselineReturns: number[] = [];

  for (let originIndex = MIN_LOOKBACK; originIndex + horizonDays < BTC_ROWS.length; originIndex += spacingDays) {
    const origin = BTC_ROWS[originIndex];
    if (origin.date < startDate) continue;
    if (endDate && origin.date > endDate) continue;
    const features = FEATURE_BY_DATE.get(origin.date)?.features;
    if (!features) continue;
    const target = BTC_ROWS[originIndex + horizonDays];
    const actualReturn = Math.log(target.close / origin.close);
    if (event.priceBaseline(features)) priceBaselineReturns.push(actualReturn);
    if (!event.isActive(features)) continue;
    const forecast = powerlaw.forecast(BTC_ROWS, originIndex, horizonDays);
    if (!forecast || !Number.isFinite(forecast.median) || forecast.median <= 0) continue;
    const adjustedMedian = forecast.median * Math.exp(coefficient);
    const actualLog = Math.log(target.close);
    const baselineLog = Math.log(forecast.median);
    const adjustedLog = Math.log(adjustedMedian);
    const adjustedReturn = Math.log(adjustedMedian / origin.close);
    const baselineReturn = Math.log(forecast.median / origin.close);
    const absError = Math.abs(actualLog - adjustedLog);
    const baselineAbsError = Math.abs(actualLog - baselineLog);
    absErrors.push(absError);
    baselineAbsErrors.push(baselineAbsError);
    improvements.push(baselineAbsError - absError);
    directionHits.push(Math.sign(actualReturn) === Math.sign(adjustedReturn) ? 1 : 0);
    baselineDirectionHits.push(Math.sign(actualReturn) === Math.sign(baselineReturn) ? 1 : 0);
    eventReturns.push(actualReturn);
  }

  const upRateValue = upRate(eventReturns);
  const priceBaselineUpRateValue = upRate(priceBaselineReturns);
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
    upRate: upRateValue,
    baselineEventUpRate: mean(baselineDirectionHits),
    priceBaselineSamples: priceBaselineReturns.length,
    priceBaselineMedianForwardReturn: median(priceBaselineReturns),
    priceBaselineUpRate: priceBaselineUpRateValue,
    eventExcessUpRateVsPriceBaseline: upRateValue === null || priceBaselineUpRateValue === null ? null : upRateValue - priceBaselineUpRateValue,
    medianForwardReturn: median(eventReturns),
  };
}

function classifyVerdict(validation: Record<string, MetricSummary>, holdout: Record<string, MetricSummary>): { verdict: EventReport['verdict']; reason: string } {
  const eligible = HORIZONS.filter(horizon => holdout[String(horizon)].samples >= MIN_HOLDOUT_SAMPLES);
  const passes = eligible.filter(horizon => {
    const v = validation[String(horizon)];
    const h = holdout[String(horizon)];
    const eventBeatsPriceContext = Math.abs(h.eventExcessUpRateVsPriceBaseline ?? 0) >= 0.05 ||
      Math.abs((h.medianForwardReturn ?? 0) - (h.priceBaselineMedianForwardReturn ?? 0)) >= 0.02;
    return (v.meanImprovementVsBaseline ?? -Infinity) > 0 &&
      (h.meanImprovementVsBaseline ?? -Infinity) > 0 &&
      (h.bootstrapLower95MeanImprovement ?? -Infinity) > 0 &&
      eventBeatsPriceContext;
  });
  if (passes.length >= 2) return { verdict: 'promote', reason: 'Multiple eligible horizons passed validation, holdout, lower-bound, and price-context comparison gates.' };
  const best = Math.max(...eligible.map(horizon => holdout[String(horizon)].meanImprovementVsBaseline ?? -Infinity));
  if (best > 0) return { verdict: 'context-only', reason: 'Some eligible holdout improvement exists, but the full promotion gate did not pass.' };
  return { verdict: 'reject', reason: 'No eligible sentiment event passed the thinned holdout promotion gate.' };
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

function upRate(values: number[]): number | null {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.filter(value => value > 0).length / finite.length : null;
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
    '# BTC Sentiment Extremes Event Study',
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
    '## Event summary',
    '',
  ];
  for (const event of report.events as EventReport[]) {
    lines.push(`### ${event.id}`);
    lines.push('');
    lines.push(`- Verdict: **${event.verdict}** — ${event.verdictReason}`);
    lines.push(`- Description: ${event.description}`);
    lines.push(`- Price baseline: ${event.priceBaselineId}`);
    lines.push('- Holdout thinned target horizons:');
    for (const horizon of HORIZONS) {
      const metric = event.holdoutThinned[String(horizon)];
      lines.push(`  - ${horizon}d: samples=${metric.samples}, coefficient=${fmtNum(metric.selectedCoefficient)}, mean improvement=${fmtPct(metric.meanImprovementVsBaseline)}, lower95=${fmtPct(metric.bootstrapLower95MeanImprovement)}, upRate=${fmtPct(metric.upRate)}, priceBaselineUpRate=${fmtPct(metric.priceBaselineUpRate)}, medianReturn=${fmtPct(metric.medianForwardReturn)}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function printSummary(events: EventReport[]): void {
  console.log('Sentiment extremes holdout summary:');
  for (const event of events) {
    const best = HORIZONS
      .map(horizon => ({ horizon, metric: event.holdoutThinned[String(horizon)] }))
      .sort((a, b) => (b.metric.meanImprovementVsBaseline ?? -Infinity) - (a.metric.meanImprovementVsBaseline ?? -Infinity))[0];
    console.log(`${event.id} verdict=${event.verdict} best=${best?.horizon}d n=${best?.metric.samples ?? 0} improvement=${fmtPct(best?.metric.meanImprovementVsBaseline ?? null)} lower95=${fmtPct(best?.metric.bootstrapLower95MeanImprovement ?? null)}`);
  }
}

function fmtPct(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : `${(value * 100).toFixed(2)}%`;
}

function fmtNum(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : value.toFixed(4);
}

main();
