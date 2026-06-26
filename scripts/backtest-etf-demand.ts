import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import btcHistory from '../src/data/btc-history.json';
import featureTable from '../src/data/feature-table.json';
import type { OHLCVData } from '../src/lib/api';
import type { FeatureRow } from '../src/lib/features';
import { getBacktestModels } from '../src/lib/backtestModels';

interface CandidateSpec {
  id: string;
  description: string;
  featureName: string;
  normalize: 'none' | 'expanding-z';
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
  excludedLargestFlowDays: boolean;
}

interface CandidateReport {
  id: string;
  description: string;
  featureName: string;
  selectedCoefficientByHorizon: Record<string, number>;
  validationThinned: Record<string, MetricSummary>;
  holdoutThinned: Record<string, MetricSummary>;
  holdoutThinnedExLargestFlowDays: Record<string, MetricSummary>;
  verdict: 'promote' | 'context-only' | 'reject';
  verdictReason: string;
}

const BTC_ROWS = btcHistory as OHLCVData[];
const FEATURE_ROWS = featureTable as FeatureRow[];
const FEATURE_BY_DATE = new Map(FEATURE_ROWS.map(row => [row.date, row]));
const FEATURE_INDEX_BY_DATE = new Map(FEATURE_ROWS.map((row, index) => [row.date, index]));
const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');
const VALIDATION_START = '2024-01-11';
const VALIDATION_END = '2024-12-31';
const HOLDOUT_START = '2025-01-01';
const HORIZONS = [14, 30, 60, 90];
const MIN_HOLDOUT_SAMPLES = 8;
const COEFFICIENT_GRID = [-0.40, -0.30, -0.22, -0.16, -0.10, -0.06, -0.03, 0, 0.03, 0.06, 0.10, 0.16, 0.22, 0.30, 0.40];
const BOOTSTRAP_ITERATIONS = 400;
const MIN_LOOKBACK = 365;

const CANDIDATES: CandidateSpec[] = [
  {
    id: 'etf-flow-5d-marketcap',
    description: 'Five ETF business-day net flow as a share of BTC market cap.',
    featureName: 'spotEtfFlow5dToBtcMarketCap',
    normalize: 'expanding-z',
  },
  {
    id: 'etf-flow-20d-marketcap',
    description: 'Twenty ETF business-day net flow as a share of BTC market cap.',
    featureName: 'spotEtfFlow20dToBtcMarketCap',
    normalize: 'expanding-z',
  },
  {
    id: 'etf-flow-shock',
    description: 'Daily spot ETF flow shock z-score versus prior 90 ETF rows.',
    featureName: 'spotEtfFlowShockZ90d',
    normalize: 'none',
  },
  {
    id: 'etf-cumulative-trend',
    description: 'Cumulative spot ETF net flow trend, expanding-z normalized.',
    featureName: 'spotEtfCumulativeFlowUSD',
    normalize: 'expanding-z',
  },
];

function main(): void {
  const powerlaw = getBacktestModels().find(model => model.id === 'powerlaw-current');
  if (!powerlaw) throw new Error('powerlaw-current model not found');
  const candidates = CANDIDATES.map(candidate => evaluateCandidate(powerlaw, candidate));
  const report = {
    generatedAt: new Date().toISOString(),
    data: {
      btcRows: BTC_ROWS.length,
      btcFirstDate: BTC_ROWS[0]?.date,
      btcLastDate: BTC_ROWS.at(-1)?.date,
      featureRows: FEATURE_ROWS.length,
      featureFirstDate: FEATURE_ROWS[0]?.date,
      featureLastDate: FEATURE_ROWS.at(-1)?.date,
      etfFeatureRows: FEATURE_ROWS.filter(row => Number.isFinite(row.features.spotEtfFlowUSD)).length,
    },
    preRegistration: {
      purpose: 'Research-only spot Bitcoin ETF demand-pressure median experiment; ETF fields stay context-only unless the holdout gate passes.',
      validationPeriod: `${VALIDATION_START} through ${VALIDATION_END}`,
      finalHoldoutPeriod: `${HOLDOUT_START} through latest available target`,
      horizons: HORIZONS,
      baseline: 'powerlaw-current median forecast',
      modelForm: 'candidate median = baseline median * exp(validation-selected coefficient * feature value); origins are thinned by horizon.',
      candidates: CANDIDATES.map(candidate => ({ id: candidate.id, description: candidate.description, featureName: candidate.featureName, normalize: candidate.normalize })),
      leakagePolicy: 'ETF rows are joined only after next-UTC-day availableAfter timing; expanding-z candidate values use only prior feature rows.',
      promotionGate: 'enough non-overlapping samples, positive validation and holdout median-error improvement at 14/30/60d, positive lower95, and the effect survives excluding largest single-flow days.',
      sourceLimitation: 'Farside is a public HTML table rather than a versioned API, so parser/source changes must fail validation rather than silently changing features.',
    },
    candidates,
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `btc-etf-demand-${stamp}.json`);
  const mdPath = join(REPORT_DIR, `btc-etf-demand-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(mdPath, renderMarkdown(report));
  console.log(`BTC ETF demand report: ${jsonPath}`);
  console.log(`BTC ETF demand markdown: ${mdPath}`);
  printSummary(candidates);
}

function evaluateCandidate(powerlaw: NonNullable<ReturnType<typeof getBacktestModels>[number]>, candidate: CandidateSpec): CandidateReport {
  const selectedCoefficientByHorizon: Record<string, number> = {};
  for (const horizon of HORIZONS) {
    const best = COEFFICIENT_GRID
      .map(coefficient => ({ coefficient, metric: metric(powerlaw, candidate, horizon, VALIDATION_START, VALIDATION_END, horizon, coefficient, false) }))
      .filter(item => item.metric.meanAbsLogError !== null)
      .sort((a, b) => (a.metric.meanAbsLogError ?? Infinity) - (b.metric.meanAbsLogError ?? Infinity))[0];
    selectedCoefficientByHorizon[String(horizon)] = best?.coefficient ?? 0;
  }

  const validationThinned = Object.fromEntries(HORIZONS.map(horizon => [
    String(horizon),
    metric(powerlaw, candidate, horizon, VALIDATION_START, VALIDATION_END, horizon, selectedCoefficientByHorizon[String(horizon)], false),
  ]));
  const holdoutThinned = Object.fromEntries(HORIZONS.map(horizon => [
    String(horizon),
    metric(powerlaw, candidate, horizon, HOLDOUT_START, null, horizon, selectedCoefficientByHorizon[String(horizon)], false),
  ]));
  const holdoutThinnedExLargestFlowDays = Object.fromEntries(HORIZONS.map(horizon => [
    String(horizon),
    metric(powerlaw, candidate, horizon, HOLDOUT_START, null, horizon, selectedCoefficientByHorizon[String(horizon)], true),
  ]));
  const verdict = classifyVerdict(validationThinned, holdoutThinned, holdoutThinnedExLargestFlowDays);
  return {
    id: candidate.id,
    description: candidate.description,
    featureName: candidate.featureName,
    selectedCoefficientByHorizon,
    validationThinned,
    holdoutThinned,
    holdoutThinnedExLargestFlowDays,
    verdict: verdict.verdict,
    verdictReason: verdict.reason,
  };
}

function metric(
  powerlaw: NonNullable<ReturnType<typeof getBacktestModels>[number]>,
  candidate: CandidateSpec,
  horizonDays: number,
  startDate: string,
  endDate: string | null,
  spacingDays: number,
  coefficient: number,
  excludeLargestFlowDays: boolean
): MetricSummary {
  const absErrors: number[] = [];
  const baselineAbsErrors: number[] = [];
  const improvements: number[] = [];
  const directionHits: number[] = [];
  const baselineDirectionHits: number[] = [];
  const largestFlowCutoff = excludeLargestFlowDays ? largestFlowCutoffForPeriod(startDate, endDate) : Infinity;

  for (let originIndex = MIN_LOOKBACK; originIndex + horizonDays < BTC_ROWS.length; originIndex += spacingDays) {
    const origin = BTC_ROWS[originIndex];
    if (origin.date < startDate) continue;
    if (endDate && origin.date > endDate) continue;
    const featureRow = FEATURE_BY_DATE.get(origin.date);
    if (!featureRow) continue;
    if (Math.abs(featureRow.features.spotEtfFlowUSD ?? 0) > largestFlowCutoff) continue;
    const rawValue = featureRow.features[candidate.featureName];
    if (!Number.isFinite(rawValue)) continue;
    const featureValue = candidate.normalize === 'expanding-z'
      ? expandingFeatureZ(candidate.featureName, origin.date, rawValue)
      : rawValue;
    if (!Number.isFinite(featureValue)) continue;

    const target = BTC_ROWS[originIndex + horizonDays];
    const forecast = powerlaw.forecast(BTC_ROWS, originIndex, horizonDays);
    if (!forecast || !Number.isFinite(forecast.median) || forecast.median <= 0) continue;
    const adjustedMedian = forecast.median * Math.exp(coefficient * featureValue);
    if (!Number.isFinite(adjustedMedian) || adjustedMedian <= 0) continue;

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
    excludedLargestFlowDays: excludeLargestFlowDays,
  };
}

function classifyVerdict(
  validation: Record<string, MetricSummary>,
  holdout: Record<string, MetricSummary>,
  exLargest: Record<string, MetricSummary>
): { verdict: CandidateReport['verdict']; reason: string } {
  const required = [14, 30, 60];
  const passes = required.filter(horizon => {
    const key = String(horizon);
    const v = validation[key];
    const h = holdout[key];
    const x = exLargest[key];
    return h.samples >= MIN_HOLDOUT_SAMPLES &&
      x.samples >= Math.max(4, MIN_HOLDOUT_SAMPLES - 2) &&
      (v.meanImprovementVsBaseline ?? -Infinity) > 0 &&
      (h.meanImprovementVsBaseline ?? -Infinity) > 0 &&
      (h.bootstrapLower95MeanImprovement ?? -Infinity) > 0 &&
      (x.meanImprovementVsBaseline ?? -Infinity) > 0;
  });
  if (passes.length === required.length) return { verdict: 'promote', reason: '14/30/60d holdout gates passed and survived excluding largest single-flow days.' };
  const best = Math.max(...HORIZONS.map(horizon => holdout[String(horizon)].meanImprovementVsBaseline ?? -Infinity));
  if (best > 0) return { verdict: 'context-only', reason: 'Some holdout improvement exists, but the full ETF promotion gate did not pass.' };
  return { verdict: 'reject', reason: 'No ETF demand candidate passed the ETF-era thinned holdout promotion gate.' };
}

function expandingFeatureZ(featureName: string, date: string, value: number): number | null {
  const index = FEATURE_INDEX_BY_DATE.get(date);
  if (index === undefined || index < 30) return null;
  const prior = FEATURE_ROWS
    .slice(0, index)
    .map(row => row.features[featureName])
    .filter(Number.isFinite);
  if (prior.length < 30) return null;
  const meanValue = mean(prior);
  if (meanValue === null) return null;
  const variance = prior.reduce((sum, item) => sum + (item - meanValue) ** 2, 0) / prior.length;
  const sd = Math.sqrt(variance);
  return sd > 0 ? (value - meanValue) / sd : null;
}

function largestFlowCutoffForPeriod(startDate: string, endDate: string | null): number {
  const values = FEATURE_ROWS
    .filter(row => row.date >= startDate && (!endDate || row.date <= endDate))
    .map(row => Math.abs(row.features.spotEtfFlowUSD))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!values.length) return Infinity;
  return values[Math.floor(values.length * 0.95)] ?? Infinity;
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
  if (values.length < 8) return null;
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
    '# BTC Spot ETF Demand Pressure Experiment',
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
    `- Source limitation: ${report.preRegistration.sourceLimitation}`,
    '',
    '## Candidate summary',
    '',
  ];
  for (const candidate of report.candidates as CandidateReport[]) {
    lines.push(`### ${candidate.id}`);
    lines.push('');
    lines.push(`- Verdict: **${candidate.verdict}** - ${candidate.verdictReason}`);
    lines.push(`- Feature: ${candidate.featureName}`);
    lines.push(`- Description: ${candidate.description}`);
    lines.push('- Holdout thinned target horizons:');
    for (const horizon of HORIZONS) {
      const metric = candidate.holdoutThinned[String(horizon)];
      const robust = candidate.holdoutThinnedExLargestFlowDays[String(horizon)];
      lines.push(`  - ${horizon}d: samples=${metric.samples}, coefficient=${fmtNum(metric.selectedCoefficient)}, mean improvement=${fmtPct(metric.meanImprovementVsBaseline)}, lower95=${fmtPct(metric.bootstrapLower95MeanImprovement)}, ex-largest improvement=${fmtPct(robust.meanImprovementVsBaseline)}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function printSummary(candidates: CandidateReport[]): void {
  console.log('ETF demand holdout summary:');
  for (const candidate of candidates) {
    const best = HORIZONS
      .map(horizon => ({ horizon, metric: candidate.holdoutThinned[String(horizon)] }))
      .sort((a, b) => (b.metric.meanImprovementVsBaseline ?? -Infinity) - (a.metric.meanImprovementVsBaseline ?? -Infinity))[0];
    console.log(`${candidate.id} verdict=${candidate.verdict} best=${best?.horizon}d n=${best?.metric.samples ?? 0} improvement=${fmtPct(best?.metric.meanImprovementVsBaseline ?? null)} lower95=${fmtPct(best?.metric.bootstrapLower95MeanImprovement ?? null)}`);
  }
}

function fmtNum(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? 'n/a' : value.toFixed(4);
}

function fmtPct(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? 'n/a' : `${(value * 100).toFixed(2)}%`;
}

main();
