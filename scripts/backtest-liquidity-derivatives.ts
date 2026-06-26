import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import btcHistory from '../src/data/btc-history.json';
import featureTable from '../src/data/feature-table.json';
import type { OHLCVData } from '../src/lib/api';
import type { FeatureRow } from '../src/lib/features';
import { getBacktestModels } from '../src/lib/backtestModels';

interface CandidateSpec {
  id: string;
  family: 'stablecoin' | 'derivatives';
  featureNames: string[];
  description: string;
}

interface MetricSummary {
  samples: number;
  medianAbsLogError: number | null;
  meanAbsLogError: number | null;
  meanImprovementVsBaseline: number | null;
  directionHitRate: number | null;
  bootstrapLower95MeanImprovement: number | null;
}

interface CandidateReport {
  id: string;
  family: string;
  description: string;
  featureNames: string[];
  selectedCoefficientByHorizon: Record<string, number>;
  validationDaily: Record<string, MetricSummary>;
  validationThinned: Record<string, MetricSummary>;
  holdoutDaily: Record<string, MetricSummary>;
  holdoutThinned: Record<string, MetricSummary>;
  verdict: 'promote' | 'candidate' | 'context-only' | 'reject';
  verdictReason: string;
}

const BTC_ROWS = btcHistory as OHLCVData[];
const FEATURE_ROWS = featureTable as FeatureRow[];
const FEATURE_BY_DATE = new Map(FEATURE_ROWS.map(row => [row.date, row]));
const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');
const HORIZONS = [7, 14, 30, 60, 90, 180, 365];
const VALIDATION_START = '2022-01-01';
const VALIDATION_END = '2024-12-31';
const HOLDOUT_START = '2025-01-01';
const COEFFICIENT_GRID = [-0.30, -0.24, -0.18, -0.12, -0.08, -0.04, 0, 0.04, 0.08, 0.12, 0.18, 0.24, 0.30];
const BOOTSTRAP_ITERATIONS = 400;
const MIN_EXPANDING_HISTORY = 365;

const CANDIDATES: CandidateSpec[] = [
  {
    id: 'stablecoin-supply-z365',
    family: 'stablecoin',
    featureNames: ['stablecoinSupplyZ365d'],
    description: 'Aggregate stablecoin supply z-score versus trailing 365d history.',
  },
  {
    id: 'stablecoin-30d-impulse',
    family: 'stablecoin',
    featureNames: ['stablecoinSupplyChange30d'],
    description: 'Aggregate stablecoin supply 30d growth, expanding-z normalized.',
  },
  {
    id: 'stablecoin-90d-impulse',
    family: 'stablecoin',
    featureNames: ['stablecoinSupplyChange90d'],
    description: 'Aggregate stablecoin supply 90d growth, expanding-z normalized.',
  },
  {
    id: 'stablecoin-liquidity-impulse',
    family: 'stablecoin',
    featureNames: ['stablecoinLiquidityImpulse30dVsAnnual'],
    description: '30d stablecoin liquidity impulse relative to annualized 365d trend, expanding-z normalized.',
  },
  {
    id: 'stablecoin-dry-powder-ratio',
    family: 'stablecoin',
    featureNames: ['stablecoinSupplyToBtcMarketCap'],
    description: 'Stablecoin supply divided by BTC market cap, expanding-z normalized.',
  },
  {
    id: 'derivatives-funding-z90',
    family: 'derivatives',
    featureNames: ['futuresFundingRateSumZ90d'],
    description: 'Binance BTCUSDT daily funding sum z-score versus trailing 90d funding history.',
  },
  {
    id: 'derivatives-funding-30d',
    family: 'derivatives',
    featureNames: ['futuresFundingRateSum30d'],
    description: 'Binance BTCUSDT trailing 30d funding sum, expanding-z normalized.',
  },
  {
    id: 'derivatives-premium-z90',
    family: 'derivatives',
    featureNames: ['futuresPremiumCloseZ90d'],
    description: 'Binance BTCUSDT premium-index close z-score versus trailing 90d premium history.',
  },
  {
    id: 'derivatives-premium-range',
    family: 'derivatives',
    featureNames: ['futuresPremiumRange'],
    description: 'Daily premium-index range, expanding-z normalized.',
  },
  {
    id: 'derivatives-crowding-composite',
    family: 'derivatives',
    featureNames: ['futuresFundingRateSumZ90d', 'futuresPremiumCloseZ90d'],
    description: 'Equal-weight funding and premium crowding composite.',
  },
];

function main(): void {
  const powerlaw = getBacktestModels().find(model => model.id === 'powerlaw-current');
  if (!powerlaw) throw new Error('powerlaw-current model not found');

  const normalizedFeatures = buildNormalizedFeatures();
  const baselineValidation = Object.fromEntries(HORIZONS.map(h => [String(h), evaluateMetric(powerlaw, normalizedFeatures, h, VALIDATION_START, VALIDATION_END, 1, null, 0)]));
  const baselineHoldout = Object.fromEntries(HORIZONS.map(h => [String(h), evaluateMetric(powerlaw, normalizedFeatures, h, HOLDOUT_START, null, 1, null, 0)]));

  const candidates: CandidateReport[] = CANDIDATES.map(candidate => evaluateCandidate(powerlaw, normalizedFeatures, candidate));
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
      purpose: 'Research-only ablation of public stablecoin liquidity and Binance derivatives crowding features against current power-law BTC forecast.',
      validationPeriod: `${VALIDATION_START} through ${VALIDATION_END}`,
      finalHoldoutPeriod: `${HOLDOUT_START} through latest available target`,
      horizons: HORIZONS,
      baseline: 'powerlaw-current median forecast',
      modelForm: 'candidate median = baseline median * exp(coefficient * featureComposite); coefficient selected on validation grid only',
      leakagePolicy: 'feature-table sources are one-day lagged; this script additionally uses expanding-z normalization from prior feature rows only.',
      caution: 'Daily labels overlap; thinned metrics use origin spacing equal to horizon days and are the promotion gate.',
    },
    baseline: {
      validationDaily: baselineValidation,
      holdoutDaily: baselineHoldout,
    },
    candidates,
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `btc-liquidity-derivatives-ablation-${stamp}.json`);
  const mdPath = join(REPORT_DIR, `btc-liquidity-derivatives-ablation-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(mdPath, renderMarkdown(report));
  console.log(`BTC liquidity/derivatives ablation report: ${jsonPath}`);
  console.log(`BTC liquidity/derivatives ablation markdown: ${mdPath}`);
  printConsoleSummary(candidates);
}

function evaluateCandidate(powerlaw: NonNullable<ReturnType<typeof getBacktestModels>[number]>, normalizedFeatures: Map<string, Record<string, number>>, candidate: CandidateSpec): CandidateReport {
  const selectedCoefficientByHorizon: Record<string, number> = {};
  for (const horizon of HORIZONS) {
    const scored = COEFFICIENT_GRID.map(coefficient => ({
      coefficient,
      metric: evaluateMetric(powerlaw, normalizedFeatures, horizon, VALIDATION_START, VALIDATION_END, horizon, candidate, coefficient),
    })).filter(item => item.metric.meanAbsLogError !== null);
    const best = scored.sort((a, b) => (a.metric.meanAbsLogError ?? Infinity) - (b.metric.meanAbsLogError ?? Infinity))[0];
    selectedCoefficientByHorizon[String(horizon)] = best?.coefficient ?? 0;
  }

  const validationDaily = Object.fromEntries(HORIZONS.map(horizon => [
    String(horizon),
    evaluateMetric(powerlaw, normalizedFeatures, horizon, VALIDATION_START, VALIDATION_END, 1, candidate, selectedCoefficientByHorizon[String(horizon)]),
  ]));
  const validationThinned = Object.fromEntries(HORIZONS.map(horizon => [
    String(horizon),
    evaluateMetric(powerlaw, normalizedFeatures, horizon, VALIDATION_START, VALIDATION_END, horizon, candidate, selectedCoefficientByHorizon[String(horizon)]),
  ]));
  const holdoutDaily = Object.fromEntries(HORIZONS.map(horizon => [
    String(horizon),
    evaluateMetric(powerlaw, normalizedFeatures, horizon, HOLDOUT_START, null, 1, candidate, selectedCoefficientByHorizon[String(horizon)]),
  ]));
  const holdoutThinned = Object.fromEntries(HORIZONS.map(horizon => [
    String(horizon),
    evaluateMetric(powerlaw, normalizedFeatures, horizon, HOLDOUT_START, null, horizon, candidate, selectedCoefficientByHorizon[String(horizon)]),
  ]));

  const verdict = classifyVerdict(candidate, holdoutThinned, validationThinned);
  return {
    id: candidate.id,
    family: candidate.family,
    description: candidate.description,
    featureNames: candidate.featureNames,
    selectedCoefficientByHorizon,
    validationDaily,
    validationThinned,
    holdoutDaily,
    holdoutThinned,
    verdict: verdict.verdict,
    verdictReason: verdict.reason,
  };
}

function evaluateMetric(
  powerlaw: NonNullable<ReturnType<typeof getBacktestModels>[number]>,
  normalizedFeatures: Map<string, Record<string, number>>,
  horizonDays: number,
  startDate: string,
  endDate: string | null,
  spacingDays: number,
  candidate: CandidateSpec | null,
  coefficient: number
): MetricSummary {
  const absErrors: number[] = [];
  const baselineAbsErrors: number[] = [];
  const improvements: number[] = [];
  const directionHits: number[] = [];

  for (let originIndex = 365; originIndex + horizonDays < BTC_ROWS.length; originIndex += spacingDays) {
    const origin = BTC_ROWS[originIndex];
    if (origin.date < startDate) continue;
    if (endDate && origin.date > endDate) continue;
    const target = BTC_ROWS[originIndex + horizonDays];
    const forecast = powerlaw.forecast(BTC_ROWS, originIndex, horizonDays);
    if (!forecast || !Number.isFinite(forecast.median) || forecast.median <= 0) continue;
    const featureValue = candidate ? compositeFeatureValue(normalizedFeatures.get(origin.date), candidate) : 0;
    if (candidate && featureValue === null) continue;

    const adjustedMedian = forecast.median * Math.exp(coefficient * (featureValue ?? 0));
    const actualLog = Math.log(target.close);
    const baselineForecastLog = Math.log(forecast.median);
    const adjustedForecastLog = Math.log(adjustedMedian);
    const actualReturn = Math.log(target.close / origin.close);
    const forecastReturn = Math.log(adjustedMedian / origin.close);
    const absError = Math.abs(actualLog - adjustedForecastLog);
    const baselineAbsError = Math.abs(actualLog - baselineForecastLog);
    absErrors.push(absError);
    baselineAbsErrors.push(baselineAbsError);
    improvements.push(baselineAbsError - absError);
    directionHits.push(Math.sign(actualReturn) === Math.sign(forecastReturn) ? 1 : 0);
  }

  return {
    samples: absErrors.length,
    medianAbsLogError: median(absErrors),
    meanAbsLogError: mean(absErrors),
    meanImprovementVsBaseline: mean(improvements),
    directionHitRate: mean(directionHits),
    bootstrapLower95MeanImprovement: bootstrapLower95(improvements, Math.max(1, Math.min(horizonDays, improvements.length || 1))),
  };
}

function compositeFeatureValue(features: Record<string, number> | undefined, candidate: CandidateSpec): number | null {
  if (!features) return null;
  const values = candidate.featureNames.map(name => features[name]).filter(Number.isFinite);
  if (values.length !== candidate.featureNames.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildNormalizedFeatures(): Map<string, Record<string, number>> {
  const rawNames = [...new Set(CANDIDATES.flatMap(candidate => candidate.featureNames))];
  const histories = new Map(rawNames.map(name => [name, [] as number[]]));
  const out = new Map<string, Record<string, number>>();

  for (const row of FEATURE_ROWS) {
    const normalized: Record<string, number> = {};
    for (const name of rawNames) {
      const raw = row.features[name];
      if (Number.isFinite(raw)) {
        if (name.endsWith('Z90d') || name.endsWith('Z365d')) {
          normalized[name] = clamp(raw, -4, 4);
        } else {
          const history = histories.get(name)!;
          if (history.length >= MIN_EXPANDING_HISTORY) {
            const z = zScore(history, raw);
            if (z !== null) normalized[name] = clamp(z, -4, 4);
          }
        }
      }
    }
    out.set(row.date, normalized);
    for (const name of rawNames) {
      const raw = row.features[name];
      if (Number.isFinite(raw)) histories.get(name)!.push(raw);
    }
  }
  return out;
}

function classifyVerdict(candidate: CandidateSpec, holdoutThinned: Record<string, MetricSummary>, validationThinned: Record<string, MetricSummary>): { verdict: CandidateReport['verdict']; reason: string } {
  const targetHorizons = candidate.family === 'derivatives' ? [7, 14, 30, 60] : [30, 60, 90, 180];
  const holdout = targetHorizons.map(h => holdoutThinned[String(h)]).filter(metric => metric.samples >= 3);
  const validation = targetHorizons.map(h => validationThinned[String(h)]).filter(metric => metric.samples >= 10);
  const holdoutPositive = holdout.filter(metric => (metric.meanImprovementVsBaseline ?? -Infinity) > 0 && (metric.bootstrapLower95MeanImprovement ?? -Infinity) > 0).length;
  const validationPositive = validation.filter(metric => (metric.meanImprovementVsBaseline ?? -Infinity) > 0).length;
  const bestHoldout = Math.max(...holdout.map(metric => metric.meanImprovementVsBaseline ?? -Infinity));

  if (holdoutPositive >= 2 && validationPositive >= 2) {
    return { verdict: 'candidate', reason: 'Multiple target horizons improved on thinned validation and holdout with positive bootstrap lower bound; needs broader review before forecast influence.' };
  }
  if (bestHoldout > 0 && validationPositive >= 1) {
    return { verdict: 'context-only', reason: 'Some target-horizon improvement exists, but it is not stable enough across thinned horizons to promote.' };
  }
  return { verdict: 'reject', reason: 'Did not show stable thinned holdout improvement over current power-law baseline.' };
}

function renderMarkdown(report: any): string {
  const lines = [
    '# BTC Stablecoin Liquidity + Derivatives Ablation',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Setup',
    '',
    `- Validation: ${report.preRegistration.validationPeriod}`,
    `- Final holdout: ${report.preRegistration.finalHoldoutPeriod}`,
    `- Model form: ${report.preRegistration.modelForm}`,
    `- Leakage policy: ${report.preRegistration.leakagePolicy}`,
    `- Overlap caution: ${report.preRegistration.caution}`,
    '',
    '## Candidate summary',
    '',
  ];

  for (const candidate of report.candidates as CandidateReport[]) {
    lines.push(`### ${candidate.id}`);
    lines.push('');
    lines.push(`- Family: ${candidate.family}`);
    lines.push(`- Verdict: **${candidate.verdict}** — ${candidate.verdictReason}`);
    lines.push(`- Features: ${candidate.featureNames.join(', ')}`);
    lines.push('- Holdout thinned target horizons:');
    const targets = candidate.family === 'derivatives' ? [7, 14, 30, 60] : [30, 60, 90, 180];
    for (const horizon of targets) {
      const metric = candidate.holdoutThinned[String(horizon)];
      lines.push(`  - ${horizon}d: samples=${metric.samples}, mean improvement=${formatPct(metric.meanImprovementVsBaseline)}, median abs log error=${formatNumber(metric.medianAbsLogError)}, bootstrap lower95=${formatPct(metric.bootstrapLower95MeanImprovement)}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function printConsoleSummary(candidates: CandidateReport[]): void {
  console.log('Top holdout-thinned target improvements:');
  for (const candidate of candidates) {
    const targets = candidate.family === 'derivatives' ? [7, 14, 30, 60] : [30, 60, 90, 180];
    const best = targets
      .map(h => ({ horizon: h, metric: candidate.holdoutThinned[String(h)] }))
      .sort((a, b) => (b.metric.meanImprovementVsBaseline ?? -Infinity) - (a.metric.meanImprovementVsBaseline ?? -Infinity))[0];
    console.log(`${candidate.id}  verdict=${candidate.verdict}  best=${best?.horizon}d improvement=${formatPct(best?.metric.meanImprovementVsBaseline ?? null)} lower95=${formatPct(best?.metric.bootstrapLower95MeanImprovement ?? null)}`);
  }
}

function zScore(values: number[], value: number): number | null {
  if (values.length < 2) return null;
  const avg = values.reduce((sum, item) => sum + item, 0) / values.length;
  const variance = values.reduce((sum, item) => sum + (item - avg) ** 2, 0) / values.length;
  const sd = Math.sqrt(variance);
  return sd > 0 ? (value - avg) / sd : null;
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
  let x = Math.sin((seedA + 1) * 10000 + (seedB + 1) * 9973) * 10000;
  return x - Math.floor(x);
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

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function formatPct(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : `${(value * 100).toFixed(2)}%`;
}

function formatNumber(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : value.toFixed(4);
}

main();
