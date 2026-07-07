import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import btcHistory from '../src/data/btc-history.json';
import featureTable from '../src/data/feature-table.json';
import type { OHLCVData } from '../src/lib/api';
import type { FeatureRow } from '../src/lib/features';
import { getBacktestModels } from '../src/lib/backtestModels';
import { normalQuantile } from '../src/lib/forecastInterval';

interface RegimeSpec {
  id: string;
  description: string;
  sigmaDirection: 'widen' | 'narrow';
  isActive: (features: Record<string, number>) => boolean;
}

interface MetricSummary {
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
  medianAbsLogError: number | null;
  baselineMedianAbsLogError: number | null;
  medianForwardReturn: number | null;
  upRate: number | null;
}

interface RegimeReport {
  id: string;
  description: string;
  sigmaDirection: string;
  selectedScaleByHorizon: Record<string, number>;
  validationThinned: Record<string, MetricSummary>;
  holdoutThinned: Record<string, MetricSummary>;
  verdict: 'candidate' | 'context-only' | 'reject';
  verdictReason: string;
}

const BTC_ROWS = btcHistory as OHLCVData[];
const FEATURE_ROWS = featureTable as FeatureRow[];
const FEATURE_BY_DATE = new Map(FEATURE_ROWS.map(row => [row.date, row]));
const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');
const VALIDATION_START = '2023-08-01';
const VALIDATION_END = '2024-12-31';
const HOLDOUT_START = '2025-01-01';
const HORIZONS = [30, 60, 90, 180];
const REQUIRED_HORIZONS = [30, 60, 90];
const SCALE_GRID = [0, 0.10, 0.20, 0.35, 0.50, 0.75];
const BOOTSTRAP_ITERATIONS = 400;
const MIN_HOLDOUT_SAMPLES = 5;

const REGIMES: RegimeSpec[] = [
  {
    id: 'macro-stress',
    description: 'High macro risk score or high-yield spread z-score.',
    sigmaDirection: 'widen',
    isActive: f => (f.macroRiskScore ?? -Infinity) >= 1 || (f.macroHighYieldSpreadZ252d ?? -Infinity) >= 1,
  },
  {
    id: 'credit-stress',
    description: 'High-yield spread at least one prior-year z-score above normal.',
    sigmaDirection: 'widen',
    isActive: f => (f.macroHighYieldSpreadZ252d ?? -Infinity) >= 1,
  },
  {
    id: 'liquidity-easing',
    description: 'Positive balance-sheet impulse and low macro risk score.',
    sigmaDirection: 'narrow',
    isActive: f => (f.macroFedBalanceSheetChange13w ?? 0) > 0 && (f.macroRiskScore ?? Infinity) <= -0.25,
  },
  {
    id: 'tightening-pressure',
    description: 'Negative balance-sheet impulse or rising rates with elevated macro risk.',
    sigmaDirection: 'widen',
    isActive: f => ((f.macroFedBalanceSheetChange26w ?? 0) < -0.02 || (f.macroFedFundsChange13w ?? 0) > 0.25) && (f.macroRiskScore ?? 0) > 0,
  },
];

function main(): void {
  const powerlaw = getBacktestModels().find(model => model.id === 'powerlaw-current');
  if (!powerlaw) throw new Error('powerlaw-current model not found');
  const reports = REGIMES.map(regime => evaluateRegime(powerlaw, regime));
  const report = {
    generatedAt: new Date().toISOString(),
    data: {
      btcRows: BTC_ROWS.length,
      btcFirstDate: BTC_ROWS[0]?.date,
      btcLastDate: BTC_ROWS.at(-1)?.date,
      featureRows: FEATURE_ROWS.length,
      featureFirstDate: FEATURE_ROWS[0]?.date,
      featureLastDate: FEATURE_ROWS.at(-1)?.date,
      macroFeatureRows: FEATURE_ROWS.filter(row => Number.isFinite(row.features.macroRiskScore)).length,
    },
    preRegistration: {
      purpose: 'Research-only FRED macro liquidity/stress interval experiment with unchanged median.',
      validationPeriod: `${VALIDATION_START} through ${VALIDATION_END}`,
      finalHoldoutPeriod: `${HOLDOUT_START} through latest available target`,
      horizons: HORIZONS,
      requiredPromotionHorizons: REQUIRED_HORIZONS,
      baseline: 'powerlaw-current median and sigma',
      modelForm: 'candidate median unchanged; sigma widened or narrowed for transparent macro regimes with scale selected on validation only.',
      regimes: REGIMES.map(regime => ({ id: regime.id, description: regime.description, sigmaDirection: regime.sigmaDirection })),
      leakagePolicy: 'macro rows use latest FRED observations with conservative 30-day availableAfter lag before feature-table joins.',
      promotionGate: 'NLL or q05/q95 pinball improves on 30/60/90d holdout with positive lower95, coverage remains sane, and median absolute log error does not materially degrade.',
      limitations: 'FRED latest observations are not ALFRED vintages; high-yield spread series currently starts 2023-06-26, shortening validation history.',
    },
    regimes: reports,
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `btc-macro-liquidity-${stamp}.json`);
  const mdPath = join(REPORT_DIR, `btc-macro-liquidity-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(mdPath, renderMarkdown(report));
  console.log(`BTC macro liquidity report: ${jsonPath}`);
  console.log(`BTC macro liquidity markdown: ${mdPath}`);
  printSummary(reports);
}

function evaluateRegime(powerlaw: NonNullable<ReturnType<typeof getBacktestModels>[number]>, regime: RegimeSpec): RegimeReport {
  const selectedScaleByHorizon: Record<string, number> = {};
  for (const horizon of HORIZONS) {
    const best = SCALE_GRID
      .map(scale => ({ scale, metric: metric(powerlaw, regime, horizon, VALIDATION_START, VALIDATION_END, horizon, scale) }))
      .filter(item => item.metric.nll !== null)
      .sort((a, b) => (a.metric.nll ?? Infinity) - (b.metric.nll ?? Infinity))[0];
    selectedScaleByHorizon[String(horizon)] = best?.scale ?? 0;
  }
  const validationThinned = Object.fromEntries(HORIZONS.map(horizon => [
    String(horizon),
    metric(powerlaw, regime, horizon, VALIDATION_START, VALIDATION_END, horizon, selectedScaleByHorizon[String(horizon)]),
  ]));
  const holdoutThinned = Object.fromEntries(HORIZONS.map(horizon => [
    String(horizon),
    metric(powerlaw, regime, horizon, HOLDOUT_START, null, horizon, selectedScaleByHorizon[String(horizon)]),
  ]));
  const verdict = classifyVerdict(holdoutThinned);
  return {
    id: regime.id,
    description: regime.description,
    sigmaDirection: regime.sigmaDirection,
    selectedScaleByHorizon,
    validationThinned,
    holdoutThinned,
    verdict: verdict.verdict,
    verdictReason: verdict.reason,
  };
}

function metric(
  powerlaw: NonNullable<ReturnType<typeof getBacktestModels>[number]>,
  regime: RegimeSpec,
  horizonDays: number,
  startDate: string,
  endDate: string | null,
  spacingDays: number,
  scale: number
): MetricSummary {
  const nlls: number[] = [];
  const baseNlls: number[] = [];
  const improvements: number[] = [];
  const cover90: number[] = [];
  const baseCover90: number[] = [];
  const q05: number[] = [];
  const baseQ05: number[] = [];
  const q95: number[] = [];
  const baseQ95: number[] = [];
  const absErrors: number[] = [];
  const baseAbsErrors: number[] = [];
  const returns: number[] = [];

  for (let originIndex = 365; originIndex + horizonDays < BTC_ROWS.length; originIndex += spacingDays) {
    const origin = BTC_ROWS[originIndex];
    if (origin.date < startDate) continue;
    if (endDate && origin.date > endDate) continue;
    const features = FEATURE_BY_DATE.get(origin.date)?.features;
    if (!features || !regime.isActive(features)) continue;
    const forecast = powerlaw.forecast(BTC_ROWS, originIndex, horizonDays);
    if (!forecast?.sigma || !Number.isFinite(forecast.sigma) || forecast.sigma <= 0 || forecast.median <= 0) continue;
    const target = BTC_ROWS[originIndex + horizonDays];
    const actualLog = Math.log(target.close);
    const medianLog = Math.log(forecast.median);
    const factor = regime.sigmaDirection === 'narrow' ? Math.max(0.25, 1 - scale) : 1 + scale;
    const sigma = forecast.sigma * factor;
    const nll = normalNll(actualLog, medianLog, sigma);
    const baseNll = normalNll(actualLog, medianLog, forecast.sigma);
    nlls.push(nll);
    baseNlls.push(baseNll);
    improvements.push(baseNll - nll);
    cover90.push(isCovered(actualLog, medianLog, sigma, 0.90) ? 1 : 0);
    baseCover90.push(isCovered(actualLog, medianLog, forecast.sigma, 0.90) ? 1 : 0);
    q05.push(pinballLogLoss(actualLog, medianLog + sigma * normalQuantile(0.05), 0.05));
    baseQ05.push(pinballLogLoss(actualLog, medianLog + forecast.sigma * normalQuantile(0.05), 0.05));
    q95.push(pinballLogLoss(actualLog, medianLog + sigma * normalQuantile(0.95), 0.95));
    baseQ95.push(pinballLogLoss(actualLog, medianLog + forecast.sigma * normalQuantile(0.95), 0.95));
    absErrors.push(Math.abs(actualLog - medianLog));
    baseAbsErrors.push(Math.abs(actualLog - medianLog));
    returns.push(Math.log(target.close / origin.close));
  }

  return {
    samples: nlls.length,
    selectedScale: scale,
    nll: mean(nlls),
    baselineNll: mean(baseNlls),
    meanNllImprovement: mean(improvements),
    bootstrapLower95NllImprovement: bootstrapLower95(improvements, Math.max(1, Math.min(horizonDays, improvements.length || 1))),
    coverage90: mean(cover90),
    baselineCoverage90: mean(baseCover90),
    q05Pinball: mean(q05),
    baselineQ05Pinball: mean(baseQ05),
    q95Pinball: mean(q95),
    baselineQ95Pinball: mean(baseQ95),
    medianAbsLogError: median(absErrors),
    baselineMedianAbsLogError: median(baseAbsErrors),
    medianForwardReturn: median(returns),
    upRate: upRate(returns),
  };
}

function classifyVerdict(holdout: Record<string, MetricSummary>): { verdict: RegimeReport['verdict']; reason: string } {
  const eligible = REQUIRED_HORIZONS.map(horizon => holdout[String(horizon)]).filter(item => item.samples >= MIN_HOLDOUT_SAMPLES);
  const passes = eligible.filter(item => {
    const nllPass = (item.meanNllImprovement ?? -Infinity) > 0 && (item.bootstrapLower95NllImprovement ?? -Infinity) > 0;
    const pinballPass = (item.q05Pinball ?? Infinity) < (item.baselineQ05Pinball ?? -Infinity) ||
      (item.q95Pinball ?? Infinity) < (item.baselineQ95Pinball ?? -Infinity);
    const coverageOk = item.coverage90 !== null && item.coverage90 >= 0.75 && item.coverage90 <= 1;
    return coverageOk && (nllPass || pinballPass);
  });
  if (passes.length >= 2) return { verdict: 'candidate', reason: 'Multiple required holdout horizons improved interval/tail metrics; requires manual review given non-vintage FRED limitation.' };
  const anyImproved = eligible.some(item => (item.meanNllImprovement ?? -Infinity) > 0);
  if (anyImproved) return { verdict: 'context-only', reason: 'Some holdout interval improvement exists, but the full promotion gate did not pass.' };
  return { verdict: 'reject', reason: 'No macro regime passed the holdout interval promotion gate.' };
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
    '# BTC Macro Liquidity Regime Experiment',
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
    `- Limitation: ${report.preRegistration.limitations}`,
    '- Diagnostic policy: sparse event/state outputs are diagnostics only; `npm run backtest:features-continuous` is the PRD v2.9 promotion gate.',
    '',
    '## Regime summary',
    '',
  ];
  for (const regime of report.regimes as RegimeReport[]) {
    lines.push(`### ${regime.id}`);
    lines.push('');
    lines.push(`- Verdict: **${regime.verdict}** — ${regime.verdictReason}`);
    lines.push(`- Description: ${regime.description}`);
    lines.push(`- Sigma direction: ${regime.sigmaDirection}`);
    lines.push('- Holdout thinned metrics:');
    for (const horizon of HORIZONS) {
      const metric = regime.holdoutThinned[String(horizon)];
      lines.push(`  - ${horizon}d: samples=${metric.samples}, scale=${metric.selectedScale}, nllImprovement=${fmtNum(metric.meanNllImprovement)}, lower95=${fmtNum(metric.bootstrapLower95NllImprovement)}, coverage90=${fmtPct(metric.coverage90)}, baselineCoverage90=${fmtPct(metric.baselineCoverage90)}, medianReturn=${fmtPct(metric.medianForwardReturn)}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function printSummary(reports: RegimeReport[]): void {
  console.log('Macro liquidity holdout summary:');
  for (const regime of reports) {
    const best = HORIZONS
      .map(horizon => ({ horizon, metric: regime.holdoutThinned[String(horizon)] }))
      .sort((a, b) => (b.metric.meanNllImprovement ?? -Infinity) - (a.metric.meanNllImprovement ?? -Infinity))[0];
    console.log(`${regime.id} verdict=${regime.verdict} best=${best?.horizon}d n=${best?.metric.samples ?? 0} nllImprovement=${fmtNum(best?.metric.meanNllImprovement ?? null)} lower95=${fmtNum(best?.metric.bootstrapLower95NllImprovement ?? null)}`);
  }
}

function fmtNum(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : value.toFixed(4);
}

function fmtPct(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

main();
