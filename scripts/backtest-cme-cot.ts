import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import btcHistory from '../src/data/btc-history.json';
import featureTable from '../src/data/feature-table.json';
import type { OHLCVData } from '../src/lib/api';
import type { FeatureRow } from '../src/lib/features';
import { getBacktestModels } from '../src/lib/backtestModels';
import { normalQuantile } from '../src/lib/forecastInterval';

interface EventSpec {
  id: string;
  description: string;
  isActive: (features: Record<string, number>) => boolean;
}

interface EventMetric {
  samples: number;
  upRate: number | null;
  baselineUpRate: number | null;
  excessUpRate: number | null;
  largeUpRate: number | null;
  baselineLargeUpRate: number | null;
  largeDownRate: number | null;
  baselineLargeDownRate: number | null;
  medianReturn: number | null;
  baselineMedianReturn: number | null;
}

interface IntervalMetric {
  samples: number;
  selectedScale: number;
  nll: number | null;
  baselineNll: number | null;
  meanNllImprovement: number | null;
  bootstrapLower95NllImprovement: number | null;
  coverage90: number | null;
  baselineCoverage90: number | null;
  q05Pinball: number | null;
  baselineQ05Pinball: number | null;
  q95Pinball: number | null;
  baselineQ95Pinball: number | null;
}

interface EventReport {
  id: string;
  description: string;
  eventHoldout: Record<string, EventMetric>;
  selectedScaleByHorizon: Record<string, number>;
  intervalValidation: Record<string, IntervalMetric>;
  intervalHoldout: Record<string, IntervalMetric>;
  verdict: 'candidate' | 'context-only' | 'reject';
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
const SCALE_GRID = [0, 0.10, 0.20, 0.35, 0.50, 0.75, 1.00];
const BOOTSTRAP_ITERATIONS = 400;
const MIN_HOLDOUT_SAMPLES = 10;

const EVENTS: EventSpec[] = [
  {
    id: 'leveraged-money-crowded-short',
    description: 'Leveraged-money net positioning in the bottom historical decile.',
    isActive: f => (f.cmeCotLeveragedMoneyNetPctRank ?? 1) <= 0.10,
  },
  {
    id: 'leveraged-money-crowded-long',
    description: 'Leveraged-money net positioning in the top historical decile.',
    isActive: f => (f.cmeCotLeveragedMoneyNetPctRank ?? 0) >= 0.90,
  },
  {
    id: 'asset-manager-crowded-long',
    description: 'Asset-manager net positioning in the top historical decile.',
    isActive: f => (f.cmeCotAssetManagerNetPctRank ?? 0) >= 0.90,
  },
  {
    id: 'dealer-short-pressure',
    description: 'Dealer net positioning in the bottom historical decile.',
    isActive: f => (f.cmeCotDealerNetPctRank ?? 1) <= 0.10,
  },
  {
    id: 'open-interest-expansion',
    description: 'Open interest in the top historical decile with positive 4w change.',
    isActive: f => (f.cmeCotOpenInterestPctRank ?? 0) >= 0.90 && (f.cmeCotOpenInterestChange4w ?? 0) > 0.05,
  },
];

function main(): void {
  const powerlaw = getBacktestModels().find(model => model.id === 'powerlaw-current');
  if (!powerlaw) throw new Error('powerlaw-current model not found');
  const weeklyOrigins = buildWeeklyOrigins();
  const reports = EVENTS.map(event => evaluateEvent(powerlaw, weeklyOrigins, event));
  const report = {
    generatedAt: new Date().toISOString(),
    data: {
      btcRows: BTC_ROWS.length,
      btcFirstDate: BTC_ROWS[0]?.date,
      btcLastDate: BTC_ROWS.at(-1)?.date,
      featureRows: FEATURE_ROWS.length,
      featureFirstDate: FEATURE_ROWS[0]?.date,
      featureLastDate: FEATURE_ROWS.at(-1)?.date,
      weeklyOrigins: weeklyOrigins.length,
    },
    preRegistration: {
      purpose: 'Research-only CME COT weekly positioning event study; median remains unchanged.',
      validationPeriod: `${VALIDATION_START} through ${VALIDATION_END}`,
      finalHoldoutPeriod: `${HOLDOUT_START} through latest available target`,
      horizons: HORIZONS,
      baseline: 'powerlaw-current distribution on weekly origins with lag-safe COT features',
      modelForm: 'event stats plus event-specific sigma widening; no median adjustment is tested.',
      events: EVENTS.map(event => ({ id: event.id, description: event.description })),
      leakagePolicy: 'COT feature source dates are weekly report dates and rows are only used after conservative availableAfter timing through build-feature-table.ts.',
      promotionGate: 'at least 10 thinned holdout event samples, tail classification better than unconditional weekly baseline, and NLL or q05/q95 pinball improvement with positive lower95 bound.',
    },
    events: reports,
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `btc-cme-cot-${stamp}.json`);
  const mdPath = join(REPORT_DIR, `btc-cme-cot-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(mdPath, renderMarkdown(report));
  console.log(`BTC CME COT report: ${jsonPath}`);
  console.log(`BTC CME COT markdown: ${mdPath}`);
  printSummary(reports);
}

function buildWeeklyOrigins(): number[] {
  const origins: number[] = [];
  let lastCotSourceDate: string | null = null;
  for (let index = 365; index < BTC_ROWS.length; index++) {
    const feature = FEATURE_BY_DATE.get(BTC_ROWS[index].date);
    const cotSourceDate = feature?.sourceDates.cmeCotOpenInterestBtc;
    if (!cotSourceDate || cotSourceDate === lastCotSourceDate) continue;
    origins.push(index);
    lastCotSourceDate = cotSourceDate;
  }
  return origins;
}

function evaluateEvent(
  powerlaw: NonNullable<ReturnType<typeof getBacktestModels>[number]>,
  weeklyOrigins: number[],
  event: EventSpec
): EventReport {
  const selectedScaleByHorizon: Record<string, number> = {};
  for (const horizon of HORIZONS) {
    const best = SCALE_GRID
      .map(scale => ({
        scale,
        metric: intervalMetric(powerlaw, weeklyOrigins, event, horizon, VALIDATION_START, VALIDATION_END, scale),
      }))
      .filter(item => item.metric.nll !== null)
      .sort((a, b) => (a.metric.nll ?? Infinity) - (b.metric.nll ?? Infinity))[0];
    selectedScaleByHorizon[String(horizon)] = best?.scale ?? 0;
  }
  const eventHoldout = Object.fromEntries(HORIZONS.map(horizon => [
    String(horizon),
    eventMetric(weeklyOrigins, event, horizon, HOLDOUT_START, null),
  ]));
  const intervalValidation = Object.fromEntries(HORIZONS.map(horizon => [
    String(horizon),
    intervalMetric(powerlaw, weeklyOrigins, event, horizon, VALIDATION_START, VALIDATION_END, selectedScaleByHorizon[String(horizon)]),
  ]));
  const intervalHoldout = Object.fromEntries(HORIZONS.map(horizon => [
    String(horizon),
    intervalMetric(powerlaw, weeklyOrigins, event, horizon, HOLDOUT_START, null, selectedScaleByHorizon[String(horizon)]),
  ]));
  const verdict = classifyVerdict(eventHoldout, intervalHoldout);
  return {
    id: event.id,
    description: event.description,
    eventHoldout,
    selectedScaleByHorizon,
    intervalValidation,
    intervalHoldout,
    verdict: verdict.verdict,
    verdictReason: verdict.reason,
  };
}

function eventMetric(weeklyOrigins: number[], event: EventSpec, horizonDays: number, startDate: string, endDate: string | null): EventMetric {
  const eventReturns: number[] = [];
  const baselineReturns: number[] = [];
  for (const originIndex of weeklyOrigins) {
    if (originIndex + horizonDays >= BTC_ROWS.length) continue;
    const origin = BTC_ROWS[originIndex];
    if (origin.date < startDate) continue;
    if (endDate && origin.date > endDate) continue;
    const features = FEATURE_BY_DATE.get(origin.date)?.features;
    if (!features) continue;
    const target = BTC_ROWS[originIndex + horizonDays];
    const ret = Math.log(target.close / origin.close);
    baselineReturns.push(ret);
    if (event.isActive(features)) eventReturns.push(ret);
  }
  return {
    samples: eventReturns.length,
    upRate: upRate(eventReturns),
    baselineUpRate: upRate(baselineReturns),
    excessUpRate: nullableDiff(upRate(eventReturns), upRate(baselineReturns)),
    largeUpRate: rate(eventReturns, value => value >= 0.10),
    baselineLargeUpRate: rate(baselineReturns, value => value >= 0.10),
    largeDownRate: rate(eventReturns, value => value <= -0.10),
    baselineLargeDownRate: rate(baselineReturns, value => value <= -0.10),
    medianReturn: median(eventReturns),
    baselineMedianReturn: median(baselineReturns),
  };
}

function intervalMetric(
  powerlaw: NonNullable<ReturnType<typeof getBacktestModels>[number]>,
  weeklyOrigins: number[],
  event: EventSpec,
  horizonDays: number,
  startDate: string,
  endDate: string | null,
  scale: number
): IntervalMetric {
  const nlls: number[] = [];
  const baselineNlls: number[] = [];
  const improvements: number[] = [];
  const cover90: number[] = [];
  const baseCover90: number[] = [];
  const q05: number[] = [];
  const baseQ05: number[] = [];
  const q95: number[] = [];
  const baseQ95: number[] = [];

  for (const originIndex of weeklyOrigins) {
    if (originIndex + horizonDays >= BTC_ROWS.length) continue;
    const origin = BTC_ROWS[originIndex];
    if (origin.date < startDate) continue;
    if (endDate && origin.date > endDate) continue;
    const features = FEATURE_BY_DATE.get(origin.date)?.features;
    if (!features || !event.isActive(features)) continue;
    const forecast = powerlaw.forecast(BTC_ROWS, originIndex, horizonDays);
    if (!forecast?.sigma || !Number.isFinite(forecast.sigma) || forecast.sigma <= 0 || forecast.median <= 0) continue;
    const target = BTC_ROWS[originIndex + horizonDays];
    const actualLog = Math.log(target.close);
    const medianLog = Math.log(forecast.median);
    const sigma = forecast.sigma * (1 + scale);
    const nll = normalNll(actualLog, medianLog, sigma);
    const baselineNll = normalNll(actualLog, medianLog, forecast.sigma);
    nlls.push(nll);
    baselineNlls.push(baselineNll);
    improvements.push(baselineNll - nll);
    cover90.push(isCovered(actualLog, medianLog, sigma, 0.90) ? 1 : 0);
    baseCover90.push(isCovered(actualLog, medianLog, forecast.sigma, 0.90) ? 1 : 0);
    q05.push(pinballLogLoss(actualLog, medianLog + sigma * normalQuantile(0.05), 0.05));
    baseQ05.push(pinballLogLoss(actualLog, medianLog + forecast.sigma * normalQuantile(0.05), 0.05));
    q95.push(pinballLogLoss(actualLog, medianLog + sigma * normalQuantile(0.95), 0.95));
    baseQ95.push(pinballLogLoss(actualLog, medianLog + forecast.sigma * normalQuantile(0.95), 0.95));
  }

  return {
    samples: nlls.length,
    selectedScale: scale,
    nll: mean(nlls),
    baselineNll: mean(baselineNlls),
    meanNllImprovement: mean(improvements),
    bootstrapLower95NllImprovement: bootstrapLower95(improvements, Math.max(1, Math.min(horizonDays / 7, improvements.length || 1))),
    coverage90: mean(cover90),
    baselineCoverage90: mean(baseCover90),
    q05Pinball: mean(q05),
    baselineQ05Pinball: mean(baseQ05),
    q95Pinball: mean(q95),
    baselineQ95Pinball: mean(baseQ95),
  };
}

function classifyVerdict(eventHoldout: Record<string, EventMetric>, intervalHoldout: Record<string, IntervalMetric>): { verdict: EventReport['verdict']; reason: string } {
  const eligible = HORIZONS.filter(horizon => eventHoldout[String(horizon)].samples >= MIN_HOLDOUT_SAMPLES);
  const passes = eligible.filter(horizon => {
    const event = eventHoldout[String(horizon)];
    const interval = intervalHoldout[String(horizon)];
    const tailImproved = Math.abs(event.excessUpRate ?? 0) >= 0.05 ||
      Math.abs((event.largeDownRate ?? 0) - (event.baselineLargeDownRate ?? 0)) >= 0.05 ||
      Math.abs((event.largeUpRate ?? 0) - (event.baselineLargeUpRate ?? 0)) >= 0.05;
    const nllPass = (interval.meanNllImprovement ?? -Infinity) > 0 && (interval.bootstrapLower95NllImprovement ?? -Infinity) > 0;
    const pinballPass = (interval.q05Pinball ?? Infinity) < (interval.baselineQ05Pinball ?? -Infinity) ||
      (interval.q95Pinball ?? Infinity) < (interval.baselineQ95Pinball ?? -Infinity);
    return tailImproved && (nllPass || pinballPass);
  });
  if (passes.length >= 2) return { verdict: 'candidate', reason: 'At least two eligible horizons improved tail classification and interval/tail metrics; requires manual review before product use.' };
  const anySignal = eligible.some(horizon => Math.abs(eventHoldout[String(horizon)].excessUpRate ?? 0) >= 0.05);
  if (anySignal) return { verdict: 'context-only', reason: 'Some tail behavior differs from weekly baseline, but interval/tail metric gates did not pass.' };
  return { verdict: 'reject', reason: 'No eligible COT event passed the weekly-origin holdout promotion gate.' };
}

function normalNll(x: number, meanValue: number, sd: number): number {
  return 0.5 * Math.log(2 * Math.PI * sd * sd) + ((x - meanValue) ** 2) / (2 * sd * sd);
}

function pinballLogLoss(actual: number, predicted: number, quantile: number): number {
  const error = actual - predicted;
  return Math.max(quantile * error, (quantile - 1) * error);
}

function isCovered(actualLog: number, medianLog: number, sigma: number, interval: number): boolean {
  const tail = (1 - interval) / 2;
  const lo = medianLog + sigma * normalQuantile(tail);
  const hi = medianLog + sigma * normalQuantile(1 - tail);
  return actualLog >= lo && actualLog <= hi;
}

function upRate(values: number[]): number | null {
  return rate(values, value => value > 0);
}

function rate(values: number[], predicate: (value: number) => boolean): number | null {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.filter(predicate).length / finite.length : null;
}

function nullableDiff(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a - b;
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
    '# BTC CME COT Positioning Event Study',
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
    '',
    '## Event summary',
    '',
  ];
  for (const event of report.events as EventReport[]) {
    lines.push(`### ${event.id}`);
    lines.push('');
    lines.push(`- Verdict: **${event.verdict}** — ${event.verdictReason}`);
    lines.push(`- Description: ${event.description}`);
    lines.push('- Holdout weekly-origin metrics:');
    for (const horizon of HORIZONS) {
      const e = event.eventHoldout[String(horizon)];
      const i = event.intervalHoldout[String(horizon)];
      lines.push(`  - ${horizon}d: samples=${e.samples}, upRate=${fmtPct(e.upRate)}, excessUp=${fmtPct(e.excessUpRate)}, largeDown=${fmtPct(e.largeDownRate)}, medianReturn=${fmtPct(e.medianReturn)}, scale=${i.selectedScale}, nllImprovement=${fmtNum(i.meanNllImprovement)}, lower95=${fmtNum(i.bootstrapLower95NllImprovement)}, coverage90=${fmtPct(i.coverage90)}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function printSummary(reports: EventReport[]): void {
  console.log('CME COT holdout summary:');
  for (const event of reports) {
    const best = HORIZONS
      .map(horizon => ({ horizon, metric: event.eventHoldout[String(horizon)] }))
      .sort((a, b) => (Math.abs(b.metric.excessUpRate ?? 0)) - (Math.abs(a.metric.excessUpRate ?? 0)))[0];
    console.log(`${event.id} verdict=${event.verdict} best=${best?.horizon}d n=${best?.metric.samples ?? 0} excessUp=${fmtPct(best?.metric.excessUpRate ?? null)} median=${fmtPct(best?.metric.medianReturn ?? null)}`);
  }
}

function fmtPct(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function fmtNum(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : value.toFixed(4);
}

main();
