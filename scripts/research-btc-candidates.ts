import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import btcHistory from '../src/data/btc-history.json';
import featureTable from '../src/data/feature-table.json';
import type { OHLCVData } from '../src/lib/api';
import type { FeatureRow } from '../src/lib/features';
import { POWER_LAW_CONFIG } from '../src/lib/modelConfig';

type AdjustmentRule = (features: FeatureRow['features'] | null, horizonDays: number) => number;

interface MetricSummary {
  samples: number;
  medianAbsLogError: number;
  meanAbsLogError: number;
  meanImprovementVsCurrent: number;
  bootstrapLower95MeanImprovement: number | null;
}

interface CandidateResult {
  id: string;
  description: string;
  validationAverageMedianAbsLogError: number;
  holdout: Record<string, MetricSummary>;
}

interface ResearchReport {
  generatedAt: string;
  data: {
    btcRows: number;
    btcFirstDate: string | undefined;
    btcLastDate: string | undefined;
    featureRows: number;
    featureFirstDate: string | undefined;
    featureLastDate: string | undefined;
  };
  preRegistration: {
    target: string;
    validationPeriod: string;
    finalHoldoutPeriod: string;
    horizons: number[];
    primaryMetric: string;
    secondaryMetrics: string[];
    splitPolicy: string;
    leakagePolicy: string;
  };
  baseline: {
    id: 'powerlaw-current';
    tauDays: number;
    validationAverageMedianAbsLogError: number;
    holdout: Record<string, MetricSummary>;
  };
  tauValidationGrid: { tauDays: number; validationAverageMedianAbsLogError: number }[];
  candidates: CandidateResult[];
}

const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');
const MS_PER_DAY = 86400000;
const GENESIS = new Date(POWER_LAW_CONFIG.genesisDate);
const BTC_ROWS = btcHistory as OHLCVData[];
const FEATURE_BY_DATE = new Map((featureTable as FeatureRow[]).map(row => [row.date, row]));
const PRIMARY_HORIZONS = [14, 30, 60, 90];
const ALL_HORIZONS = [7, 14, 30, 60, 90, 180, 365];
const VALIDATION_START = '2022-01-01';
const VALIDATION_END = '2024-12-31';
const FINAL_HOLDOUT_START = '2025-01-01';
const CURRENT_TAU_DAYS = POWER_LAW_CONFIG.meanReversionTauDays;
const BOOTSTRAP_ITERATIONS = 400;

const RULES: Record<string, { description: string; adjust: AdjustmentRule }> = {
  momentumTiny: {
    description: 'Small continuation adjustment from one-day-lagged 30d residual momentum, capped at +/-0.08 log points.',
    adjust: (features, horizonDays) =>
      features ? clamp(0.15 * (features.residualMomentum30d ?? 0), -0.08, 0.08) * Math.min(1, horizonDays / 30) : 0,
  },
  valueRevert: {
    description: 'Small mean-reversion adjustment from one-day-lagged power-law residual, capped at +/-0.10 log points.',
    adjust: (features, horizonDays) =>
      features ? clamp(-0.10 * (features.priceResidualLog ?? 0), -0.10, 0.10) * Math.min(1, horizonDays / 90) : 0,
  },
  mvrvValue: {
    description: 'Contrarian MVRV percentile adjustment: +0.04 below 25th percentile, -0.04 above 85th percentile.',
    adjust: (features, horizonDays) => {
      if (!features) return 0;
      const raw = features.mvrvPercentile < 0.25 ? 0.04 : features.mvrvPercentile > 0.85 ? -0.04 : 0;
      return raw * Math.min(1, horizonDays / 90);
    },
  },
  bearPenalty: {
    description: 'Bear-regime penalty when drawdown is below -35% and 30d residual momentum is negative.',
    adjust: (features, horizonDays) => {
      if (!features) return 0;
      const raw = features.drawdownFromCycleHigh < -0.35 && features.residualMomentum30d < 0 ? -0.04 : 0;
      return raw * Math.min(1, horizonDays / 60);
    },
  },
};

function main(): void {
  const tauCandidates = [60, 90, 120, 150, 180, 210, 240, 270, 300, 365, 450];
  const tauResults = tauCandidates.map(tauDays => ({
    tauDays,
    validationAverageMedianAbsLogError: averageMedianAbsLogError(PRIMARY_HORIZONS, VALIDATION_START, VALIDATION_END, tauDays, null),
  }));
  const bestTau = [...tauResults].sort((a, b) => a.validationAverageMedianAbsLogError - b.validationAverageMedianAbsLogError)[0].tauDays;

  const candidates: CandidateResult[] = [
    {
      id: `tau-${bestTau}`,
      description: `Power-law residual mean-reversion tau selected on validation grid; current default is ${CURRENT_TAU_DAYS} days.`,
      validationAverageMedianAbsLogError: averageMedianAbsLogError(PRIMARY_HORIZONS, VALIDATION_START, VALIDATION_END, bestTau, null),
      holdout: evaluateCandidate(bestTau, null),
    },
    ...Object.entries(RULES).map(([id, rule]) => ({
      id,
      description: rule.description,
      validationAverageMedianAbsLogError: averageMedianAbsLogError(PRIMARY_HORIZONS, VALIDATION_START, VALIDATION_END, CURRENT_TAU_DAYS, rule.adjust),
      holdout: evaluateCandidate(CURRENT_TAU_DAYS, rule.adjust),
    })),
  ];

  const report: ResearchReport = {
    generatedAt: new Date().toISOString(),
    data: {
      btcRows: BTC_ROWS.length,
      btcFirstDate: BTC_ROWS[0]?.date,
      btcLastDate: BTC_ROWS.at(-1)?.date,
      featureRows: (featureTable as FeatureRow[]).length,
      featureFirstDate: (featureTable as FeatureRow[])[0]?.date,
      featureLastDate: (featureTable as FeatureRow[]).at(-1)?.date,
    },
    preRegistration: {
      target: 'BTC daily close endpoint price',
      validationPeriod: `${VALIDATION_START} through ${VALIDATION_END}`,
      finalHoldoutPeriod: `${FINAL_HOLDOUT_START} through latest available target`,
      horizons: ALL_HORIZONS,
      primaryMetric: 'median absolute log error',
      secondaryMetrics: ['mean absolute log error', 'paired mean absolute log error improvement vs current', 'block bootstrap lower 95% mean improvement'],
      splitPolicy: 'Candidates are selected only by 2022-2024 validation average across 14/30/60/90d horizons; 2025+ is final holdout.',
      leakagePolicy: 'Feature adjustments use feature-table rows keyed by origin date; feature sources are one day lagged by build-feature-table.ts.',
    },
    baseline: {
      id: 'powerlaw-current',
      tauDays: CURRENT_TAU_DAYS,
      validationAverageMedianAbsLogError: averageMedianAbsLogError(PRIMARY_HORIZONS, VALIDATION_START, VALIDATION_END, CURRENT_TAU_DAYS, null),
      holdout: evaluateCandidate(CURRENT_TAU_DAYS, null),
    },
    tauValidationGrid: tauResults,
    candidates,
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `btc-candidate-research-${stamp}.json`);
  const markdownPath = join(REPORT_DIR, `btc-candidate-research-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, renderMarkdown(report));

  console.log(`BTC candidate research report: ${jsonPath}`);
  console.log(`BTC candidate research markdown: ${markdownPath}`);
}

function evaluateCandidate(tauDays: number, adjust: AdjustmentRule | null): Record<string, MetricSummary> {
  return Object.fromEntries(
    ALL_HORIZONS.map(horizonDays => [
      String(horizonDays),
      evaluateMetric(horizonDays, FINAL_HOLDOUT_START, null, tauDays, adjust),
    ])
  );
}

function averageMedianAbsLogError(horizons: number[], startDate: string, endDate: string | null, tauDays: number, adjust: AdjustmentRule | null): number {
  const values = horizons.map(horizonDays => evaluateMetric(horizonDays, startDate, endDate, tauDays, adjust).medianAbsLogError);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function evaluateMetric(
  horizonDays: number,
  startDate: string,
  endDate: string | null,
  tauDays: number,
  adjust: AdjustmentRule | null
): MetricSummary {
  const errors: number[] = [];
  const improvements: number[] = [];

  for (let originIndex = 365; originIndex + horizonDays < BTC_ROWS.length; originIndex++) {
    const origin = BTC_ROWS[originIndex];
    if (origin.date < startDate || (endDate && origin.date > endDate)) continue;
    if (!isContiguous(originIndex, horizonDays)) continue;

    const features = FEATURE_BY_DATE.get(origin.date)?.features ?? null;
    const adjustment = adjust ? adjust(features, horizonDays) : 0;
    const actual = BTC_ROWS[originIndex + horizonDays].close;
    const candidate = forecastWithTau(originIndex, horizonDays, tauDays, adjustment);
    const current = forecastWithTau(originIndex, horizonDays, CURRENT_TAU_DAYS, 0);
    const candidateError = Math.abs(Math.log(candidate / actual));
    const currentError = Math.abs(Math.log(current / actual));

    if (Number.isFinite(candidateError) && Number.isFinite(currentError)) {
      errors.push(candidateError);
      improvements.push(currentError - candidateError);
    }
  }

  const blockLength = Math.max(7, Math.min(horizonDays, 90));
  return {
    samples: errors.length,
    medianAbsLogError: median(errors),
    meanAbsLogError: mean(errors),
    meanImprovementVsCurrent: mean(improvements),
    bootstrapLower95MeanImprovement: improvements.length > blockLength * 3
      ? blockBootstrapLowerBound(improvements, blockLength, BOOTSTRAP_ITERATIONS, 0xC0FFEE + horizonDays * 101 + Math.round(tauDays))
      : null,
  };
}

function forecastWithTau(originIndex: number, horizonDays: number, tauDays: number, logAdjustment: number): number {
  const origin = BTC_ROWS[originIndex];
  const target = BTC_ROWS[originIndex + horizonDays];
  const tNow = daysSinceGenesis(origin.date);
  const tFuture = daysSinceGenesis(target.date);
  const residual = Math.log(origin.close) - Math.log(basePowerLawPrice(tNow));
  return basePowerLawPrice(tFuture) * Math.exp(residual * Math.exp(-horizonDays / tauDays) + logAdjustment);
}

function basePowerLawPrice(t: number): number {
  const { base } = POWER_LAW_CONFIG;
  const omega = (2 * Math.PI) / base.cycleDays;
  return base.coefficient * Math.pow(t, base.exponent) * (1 + base.sinAmplitude * Math.sin(omega * t) + base.cosAmplitude * Math.cos(omega * t));
}

function daysSinceGenesis(date: string): number {
  return Math.floor((new Date(`${date}T00:00:00Z`).getTime() - GENESIS.getTime()) / MS_PER_DAY);
}

function isContiguous(originIndex: number, horizonDays: number): boolean {
  for (let step = 0; step < horizonDays; step++) {
    const current = new Date(`${BTC_ROWS[originIndex + step].date}T00:00:00Z`);
    const next = new Date(`${BTC_ROWS[originIndex + step + 1].date}T00:00:00Z`);
    if ((next.getTime() - current.getTime()) / MS_PER_DAY !== 1) return false;
  }
  return true;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function blockBootstrapLowerBound(values: number[], blockLength: number, iterations: number, seed: number): number {
  const rng = mulberry32(seed);
  const means: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration++) {
    let sum = 0;
    let count = 0;
    while (count < values.length) {
      const start = Math.floor(rng() * Math.max(1, values.length - blockLength + 1));
      for (let offset = 0; offset < blockLength && count < values.length; offset++, count++) {
        sum += values[start + offset];
      }
    }
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  return means[Math.floor(iterations * 0.05)];
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function renderMarkdown(report: ResearchReport): string {
  const lines = [
    '# BTC Candidate Forecast Research',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Data',
    '',
    `BTC rows: ${report.data.btcRows} (${report.data.btcFirstDate} to ${report.data.btcLastDate})`,
    `Feature rows: ${report.data.featureRows} (${report.data.featureFirstDate} to ${report.data.featureLastDate})`,
    '',
    '## Pre-Registered Evaluation',
    '',
    `Target: ${report.preRegistration.target}`,
    `Validation: ${report.preRegistration.validationPeriod}`,
    `Final holdout: ${report.preRegistration.finalHoldoutPeriod}`,
    `Horizons: ${report.preRegistration.horizons.join(', ')}`,
    `Primary metric: ${report.preRegistration.primaryMetric}`,
    `Split policy: ${report.preRegistration.splitPolicy}`,
    `Leakage policy: ${report.preRegistration.leakagePolicy}`,
    '',
    '## Tau Validation Grid',
    '',
    '| Tau days | Validation avg median abs log error |',
    '| ---: | ---: |',
    ...report.tauValidationGrid.map(row => `| ${row.tauDays} | ${format(row.validationAverageMedianAbsLogError)} |`),
    '',
    '## Final Holdout Results',
    '',
  ];

  lines.push(renderResultTable('Baseline: powerlaw-current', report.baseline.holdout));
  for (const candidate of report.candidates) {
    lines.push('');
    lines.push(`### ${candidate.id}`);
    lines.push(candidate.description);
    lines.push(`Validation avg median abs log error: ${format(candidate.validationAverageMedianAbsLogError)}`);
    lines.push('');
    lines.push(renderResultTable('2025+ final holdout', candidate.holdout));
  }

  lines.push('');
  lines.push('## Decision');
  lines.push('');
  lines.push('All candidate changes are research-only unless their paired mean improvement has a positive lower 95% block-bootstrap bound across the required horizons and they do not degrade median error on the final holdout.');
  return `${lines.join('\n')}\n`;
}

function renderResultTable(title: string, holdout: Record<string, MetricSummary>): string {
  return [
    `#### ${title}`,
    '',
    '| Horizon | Samples | Median abs log error | Mean abs log error | Mean improvement vs current | Bootstrap lower 95% |',
    '| ---: | ---: | ---: | ---: | ---: | ---: |',
    ...Object.entries(holdout).map(([horizon, row]) => [
      `| ${horizon}d`,
      row.samples,
      format(row.medianAbsLogError),
      format(row.meanAbsLogError),
      format(row.meanImprovementVsCurrent),
      format(row.bootstrapLower95MeanImprovement),
      '|',
    ].join(' | ')),
  ].join('\n');
}

function format(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : value.toFixed(6);
}

main();
