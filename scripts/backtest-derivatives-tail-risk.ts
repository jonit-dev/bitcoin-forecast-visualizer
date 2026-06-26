import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import btcHistory from '../src/data/btc-history.json';
import featureTable from '../src/data/feature-table.json';
import type { OHLCVData } from '../src/lib/api';
import type { FeatureRow } from '../src/lib/features';
import { getBacktestModels } from '../src/lib/backtestModels';
import { normalQuantile } from '../src/lib/forecastInterval';

interface EventMetric {
  samples: number;
  medianReturn: number | null;
  meanReturn: number | null;
  upRate: number | null;
  baselineSamples: number;
  baselineMedianReturn: number | null;
  baselineUpRate: number | null;
  excessUpRate: number | null;
}

interface IntervalMetric {
  samples: number;
  nll: number | null;
  baselineNll: number | null;
  meanNllImprovement: number | null;
  coverage80: number | null;
  coverage90: number | null;
  coverage95: number | null;
  meanInterval90WidthLog: number | null;
  baselineCoverage90: number | null;
  baselineInterval90WidthLog: number | null;
}

const BTC_ROWS = btcHistory as OHLCVData[];
const FEATURE_ROWS = featureTable as FeatureRow[];
const FEATURE_BY_DATE = new Map(FEATURE_ROWS.map(row => [row.date, row]));
const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');
const VALIDATION_START = '2022-01-01';
const VALIDATION_END = '2024-12-31';
const HOLDOUT_START = '2025-01-01';
const HORIZONS = [7, 14, 30, 60];
const INTERVAL_SCALE_GRID = [0, 0.10, 0.20, 0.35, 0.50, 0.75, 1.00];

function main(): void {
  const powerlaw = getBacktestModels().find(model => model.id === 'powerlaw-current');
  if (!powerlaw) throw new Error('powerlaw-current not found');

  const eventResults = Object.fromEntries(HORIZONS.map(horizon => [String(horizon), {
    negativeFundingAfterDrawdown: eventMetric(horizon, HOLDOUT_START, null, isNegativeFundingAfterDrawdown),
    positiveCrowdingAfterRally: eventMetric(horizon, HOLDOUT_START, null, isPositiveCrowdingAfterRally),
  }]));

  const selectedIntervalScales = Object.fromEntries(HORIZONS.map(horizon => {
    const best = INTERVAL_SCALE_GRID
      .map(scale => ({ scale, metric: intervalMetric(powerlaw, horizon, VALIDATION_START, VALIDATION_END, horizon, scale) }))
      .sort((a, b) => (a.metric.nll ?? Infinity) - (b.metric.nll ?? Infinity))[0];
    return [String(horizon), best?.scale ?? 0];
  }));

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
      purpose: 'Test Binance funding/premium as short-horizon bounce-risk and interval/tail-risk signals after median-adjustment ablation failed.',
      validationPeriod: `${VALIDATION_START} through ${VALIDATION_END}`,
      finalHoldoutPeriod: `${HOLDOUT_START} through latest available target`,
      horizons: HORIZONS,
      baseline: 'powerlaw-current median and sigma',
      eventHypotheses: [
        'Negative funding after drawdown should increase 7/14/30d bounce probability.',
        'Positive funding/premium after rally should increase downside/crowded-long risk.',
      ],
      intervalModel: 'median unchanged; sigma scaled by 1 + selectedScale * max(0, abs(fundingZ) + abs(premiumZ) - 1)',
      leakagePolicy: 'uses one-day-lagged feature table only; interval scale selected on 2022-2024 validation, then reported on 2025+ holdout.',
      overlapPolicy: 'interval validation uses thinned origins spaced by horizon days.',
    },
    eventResults,
    intervalCandidate: {
      selectedIntervalScales,
      validationThinned: Object.fromEntries(HORIZONS.map(horizon => [
        String(horizon),
        intervalMetric(powerlaw, horizon, VALIDATION_START, VALIDATION_END, horizon, selectedIntervalScales[String(horizon)]),
      ])),
      holdoutThinned: Object.fromEntries(HORIZONS.map(horizon => [
        String(horizon),
        intervalMetric(powerlaw, horizon, HOLDOUT_START, null, horizon, selectedIntervalScales[String(horizon)]),
      ])),
    },
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `btc-derivatives-tail-risk-${stamp}.json`);
  const mdPath = join(REPORT_DIR, `btc-derivatives-tail-risk-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(mdPath, renderMarkdown(report));
  console.log(`BTC derivatives tail-risk report: ${jsonPath}`);
  console.log(`BTC derivatives tail-risk markdown: ${mdPath}`);
  printSummary(report);
}

function eventMetric(horizonDays: number, startDate: string, endDate: string | null, predicate: (features: Record<string, number>) => boolean): EventMetric {
  const eventReturns: number[] = [];
  const baselineReturns: number[] = [];
  for (let originIndex = 365; originIndex + horizonDays < BTC_ROWS.length; originIndex += horizonDays) {
    const origin = BTC_ROWS[originIndex];
    if (origin.date < startDate) continue;
    if (endDate && origin.date > endDate) continue;
    const target = BTC_ROWS[originIndex + horizonDays];
    const features = FEATURE_BY_DATE.get(origin.date)?.features;
    if (!features) continue;
    const value = Math.log(target.close / origin.close);
    baselineReturns.push(value);
    if (predicate(features)) eventReturns.push(value);
  }
  return {
    samples: eventReturns.length,
    medianReturn: median(eventReturns),
    meanReturn: mean(eventReturns),
    upRate: upRate(eventReturns),
    baselineSamples: baselineReturns.length,
    baselineMedianReturn: median(baselineReturns),
    baselineUpRate: upRate(baselineReturns),
    excessUpRate: nullableDiff(upRate(eventReturns), upRate(baselineReturns)),
  };
}

function isNegativeFundingAfterDrawdown(features: Record<string, number>): boolean {
  return (
    (features.futuresFundingRateSumZ90d ?? 0) <= -1 &&
    (features.drawdownFromCycleHigh ?? 0) <= -0.20 &&
    (features.residualMomentum30d ?? 0) < 0
  );
}

function isPositiveCrowdingAfterRally(features: Record<string, number>): boolean {
  return (
    (features.futuresFundingRateSumZ90d ?? 0) >= 1 &&
    (features.futuresPremiumCloseZ90d ?? 0) >= 0.5 &&
    (features.residualMomentum30d ?? 0) > 0
  );
}

function intervalMetric(
  powerlaw: NonNullable<ReturnType<typeof getBacktestModels>[number]>,
  horizonDays: number,
  startDate: string,
  endDate: string | null,
  spacingDays: number,
  scale: number
): IntervalMetric {
  const nlls: number[] = [];
  const baselineNlls: number[] = [];
  const improvements: number[] = [];
  const cover80: number[] = [];
  const cover90: number[] = [];
  const cover95: number[] = [];
  const baseCover90: number[] = [];
  const widths90: number[] = [];
  const baseWidths90: number[] = [];

  for (let originIndex = 365; originIndex + horizonDays < BTC_ROWS.length; originIndex += spacingDays) {
    const origin = BTC_ROWS[originIndex];
    if (origin.date < startDate) continue;
    if (endDate && origin.date > endDate) continue;
    const target = BTC_ROWS[originIndex + horizonDays];
    const forecast = powerlaw.forecast(BTC_ROWS, originIndex, horizonDays);
    const features = FEATURE_BY_DATE.get(origin.date)?.features;
    if (!forecast?.sigma || !features || !Number.isFinite(forecast.sigma) || forecast.sigma <= 0) continue;
    const crowding = crowdingScore(features);
    if (crowding === null) continue;
    const adjustedSigma = forecast.sigma * (1 + scale * Math.max(0, crowding - 1));
    const actualLog = Math.log(target.close);
    const medianLog = Math.log(forecast.median);
    const nll = normalNll(actualLog, medianLog, adjustedSigma);
    const baselineNll = normalNll(actualLog, medianLog, forecast.sigma);
    nlls.push(nll);
    baselineNlls.push(baselineNll);
    improvements.push(baselineNll - nll);
    cover80.push(isCovered(actualLog, medianLog, adjustedSigma, 0.80) ? 1 : 0);
    cover90.push(isCovered(actualLog, medianLog, adjustedSigma, 0.90) ? 1 : 0);
    cover95.push(isCovered(actualLog, medianLog, adjustedSigma, 0.95) ? 1 : 0);
    baseCover90.push(isCovered(actualLog, medianLog, forecast.sigma, 0.90) ? 1 : 0);
    widths90.push(2 * adjustedSigma * normalQuantile(0.95));
    baseWidths90.push(2 * forecast.sigma * normalQuantile(0.95));
  }

  return {
    samples: nlls.length,
    nll: mean(nlls),
    baselineNll: mean(baselineNlls),
    meanNllImprovement: mean(improvements),
    coverage80: mean(cover80),
    coverage90: mean(cover90),
    coverage95: mean(cover95),
    meanInterval90WidthLog: mean(widths90),
    baselineCoverage90: mean(baseCover90),
    baselineInterval90WidthLog: mean(baseWidths90),
  };
}

function crowdingScore(features: Record<string, number>): number | null {
  const vals = [features.futuresFundingRateSumZ90d, features.futuresPremiumCloseZ90d].filter(Number.isFinite).map(Math.abs);
  if (vals.length === 0) return null;
  return vals.reduce((sum, value) => sum + Math.min(4, value), 0) / vals.length;
}

function normalNll(x: number, meanValue: number, sd: number): number {
  return 0.5 * Math.log(2 * Math.PI * sd * sd) + ((x - meanValue) ** 2) / (2 * sd * sd);
}

function isCovered(actualLog: number, medianLog: number, sigma: number, interval: number): boolean {
  const tail = (1 - interval) / 2;
  const lo = medianLog + sigma * normalQuantile(tail);
  const hi = medianLog + sigma * normalQuantile(1 - tail);
  return actualLog >= lo && actualLog <= hi;
}

function renderMarkdown(report: any): string {
  const lines = [
    '# BTC Derivatives Tail-Risk / Bounce-Risk Experiment',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Setup',
    '',
    `- Validation: ${report.preRegistration.validationPeriod}`,
    `- Holdout: ${report.preRegistration.finalHoldoutPeriod}`,
    `- Interval model: ${report.preRegistration.intervalModel}`,
    `- Leakage policy: ${report.preRegistration.leakagePolicy}`,
    '',
    '## Event-condition holdout results',
    '',
  ];
  for (const horizon of HORIZONS) {
    const result = report.eventResults[String(horizon)];
    lines.push(`### ${horizon}d`);
    for (const [name, metric] of Object.entries(result) as [string, EventMetric][]) {
      lines.push(`- ${name}: samples=${metric.samples}, upRate=${fmtPct(metric.upRate)}, baselineUpRate=${fmtPct(metric.baselineUpRate)}, excessUpRate=${fmtPct(metric.excessUpRate)}, medianReturn=${fmtPct(metric.medianReturn)}`);
    }
    lines.push('');
  }
  lines.push('## Interval NLL holdout results');
  lines.push('');
  for (const horizon of HORIZONS) {
    const metric = report.intervalCandidate.holdoutThinned[String(horizon)] as IntervalMetric;
    lines.push(`- ${horizon}d: selectedScale=${report.intervalCandidate.selectedIntervalScales[String(horizon)]}, samples=${metric.samples}, meanNllImprovement=${fmtNum(metric.meanNllImprovement)}, coverage90=${fmtPct(metric.coverage90)}, baselineCoverage90=${fmtPct(metric.baselineCoverage90)}, width90=${fmtNum(metric.meanInterval90WidthLog)}, baselineWidth90=${fmtNum(metric.baselineInterval90WidthLog)}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function printSummary(report: any): void {
  console.log('Event holdout summary:');
  for (const horizon of HORIZONS) {
    const neg = report.eventResults[String(horizon)].negativeFundingAfterDrawdown as EventMetric;
    const pos = report.eventResults[String(horizon)].positiveCrowdingAfterRally as EventMetric;
    console.log(`${horizon}d negFundingAfterDrawdown n=${neg.samples} excessUp=${fmtPct(neg.excessUpRate)} median=${fmtPct(neg.medianReturn)} | posCrowdingAfterRally n=${pos.samples} excessUp=${fmtPct(pos.excessUpRate)} median=${fmtPct(pos.medianReturn)}`);
  }
  console.log('Interval holdout summary:');
  for (const horizon of HORIZONS) {
    const metric = report.intervalCandidate.holdoutThinned[String(horizon)] as IntervalMetric;
    console.log(`${horizon}d scale=${report.intervalCandidate.selectedIntervalScales[String(horizon)]} nllImprovement=${fmtNum(metric.meanNllImprovement)} coverage90=${fmtPct(metric.coverage90)} baseCoverage90=${fmtPct(metric.baselineCoverage90)}`);
  }
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

function nullableDiff(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a - b;
}

function fmtPct(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function fmtNum(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : value.toFixed(4);
}

main();
