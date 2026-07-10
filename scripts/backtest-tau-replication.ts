import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import btcHistory from '../src/data/btc-history.json';
import type { OHLCVData } from '../src/lib/api';
import { aggregateForecastMetrics, type BacktestMetricRow, type ForecastDistribution } from '../src/lib/backtestMetrics';
import { computePowerLawInterval, normalQuantile } from '../src/lib/forecastInterval';
import { powerLawForecastWithTau } from '../src/lib/powerLaw';

const BASELINE_TAU = 210;
const CANDIDATE_TAU = 120;
const HORIZONS = [14, 30, 60, 90] as const;
const EVALUATION_START = '2017-01-01';
const BOOTSTRAP_ITERATIONS = 10_000;
const PRACTICAL_EFFECT_FRACTION = 0.01;
const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');
const DATA_PATH = join(process.cwd(), 'src', 'data', 'btc-history.json');
const rows = btcHistory as OHLCVData[];

interface PairRow {
  originDate: string;
  targetDate: string;
  actual: number;
  baseline: ForecastDistribution;
  candidate: ForecastDistribution;
  baselineAbsLogError: number;
  candidateAbsLogError: number;
  improvement: number;
}

interface BootstrapResult {
  blockLength: number;
  iterations: number;
  lower95: number;
  twoSided95: [number, number];
  practicalNullMargin: number;
  oneSidedPValue: number;
}

interface HorizonResult {
  horizonDays: number;
  samples: number;
  nominalNonOverlappingEquivalents: number;
  baseline: BacktestMetricRow;
  candidate: BacktestMetricRow;
  meanAbsLogErrorImprovement: number;
  relativeMeanAbsLogErrorImprovement: number;
  bootstrap: BootstrapResult;
  subperiodMeanImprovements: Record<string, number | null>;
  coverageDeltas: Record<'interval80' | 'interval90' | 'interval95', number | null>;
  unadjustedPassed: boolean;
  holmAdjustedPValue?: number;
  passed?: boolean;
  reasons: string[];
}

function main(): void {
  const results = HORIZONS.map(evaluateHorizon);
  const adjusted = holmAdjust(results.map(result => result.bootstrap.oneSidedPValue));
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    result.holmAdjustedPValue = adjusted[index];
    if (adjusted[index] >= 0.05) result.reasons.push(`Holm-adjusted p=${adjusted[index].toFixed(5)} is not below 0.05`);
    result.passed = result.unadjustedPassed && adjusted[index] < 0.05;
  }

  const historicalGatePassed = results.every(result => result.passed);
  const generatedAt = new Date().toISOString();
  const report = {
    metadata: {
      generatedAt,
      command: 'npm run backtest:tau-replication',
      gitCommit: gitCommit(),
      datasetSha256: createHash('sha256').update(readFileSync(DATA_PATH)).digest('hex'),
      dataset: { firstDate: rows[0]?.date, lastDate: rows.at(-1)?.date, rowCount: rows.length },
      evaluationStart: EVALUATION_START,
      horizons: HORIZONS,
      baselineTauDays: BASELINE_TAU,
      candidateTauDays: CANDIDATE_TAU,
      bootstrapIterations: BOOTSTRAP_ITERATIONS,
      practicalEffectFraction: PRACTICAL_EFFECT_FRACTION,
    },
    claimLimitations: [
      'The candidate was selected by prior tau searches; this run is a research-only replication, not a fresh confirmatory test.',
      'The 2022+ and 2025+ periods have been repeatedly inspected and are not untouched holdouts.',
      'Static power-law coefficients may contain information from after some historical origins, so results are conditional on the current structural curve.',
      'Current interval multipliers were previously calibrated on 2022+; distribution metrics are descriptive guardrails, not clean out-of-sample calibration evidence.',
    ],
    formula: {
      forecast: 'F_tau(o,h) = B(o+h) * exp(log(P_o / B(o)) * exp(-h/tau))',
      loss: 'L_tau(o,h) = abs(log(F_tau(o,h) / P_(o+h)))',
      pairedImprovement: 'd(o,h) = L_210(o,h) - L_120(o,h)',
      practicalNull: 'H0_h: E[d(o,h)] <= 0.01 * E[L_210(o,h)]',
    },
    historicalGatePassed,
    verdict: historicalGatePassed ? 'research-only-positive' : 'rejected',
    verdictReason: historicalGatePassed
      ? 'The historical replication gate passed, but no production change is permitted without a prospectively frozen holdout.'
      : 'The single fixed-tau candidate failed at least one pre-specified statistical, practical, calibration, sample-size, or origin-subperiod gate.',
    results,
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `tau-120-replication-${stamp}.json`);
  const markdownPath = join(REPORT_DIR, `tau-120-replication-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, renderMarkdown(report));
  console.log(`Tau replication verdict: ${report.verdict}`);
  for (const result of results) {
    console.log(`${result.horizonDays}d: mean improvement=${format(result.meanAbsLogErrorImprovement)} relative=${formatPercent(result.relativeMeanAbsLogErrorImprovement)} lower95=${format(result.bootstrap.lower95)} pHolm=${format(result.holmAdjustedPValue ?? null)} ${result.passed ? 'PASS' : 'FAIL'}`);
  }
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${markdownPath}`);
}

function evaluateHorizon(horizonDays: number): HorizonResult {
  const pairs: PairRow[] = [];
  for (let originIndex = 365; originIndex + horizonDays < rows.length; originIndex++) {
    const origin = rows[originIndex];
    if (origin.date < EVALUATION_START || !isContiguous(originIndex, horizonDays)) continue;
    const target = rows[originIndex + horizonDays];
    const baseline = forecast(originIndex, horizonDays, BASELINE_TAU);
    const candidate = forecast(originIndex, horizonDays, CANDIDATE_TAU);
    if (!baseline || !candidate) continue;
    const baselineAbsLogError = Math.abs(Math.log(baseline.median / target.close));
    const candidateAbsLogError = Math.abs(Math.log(candidate.median / target.close));
    pairs.push({
      originDate: origin.date,
      targetDate: target.date,
      actual: target.close,
      baseline,
      candidate,
      baselineAbsLogError,
      candidateAbsLogError,
      improvement: baselineAbsLogError - candidateAbsLogError,
    });
  }

  const baseline = aggregateForecastMetrics(pairs.map(pair => ({ actual: pair.actual, forecast: pair.baseline })));
  const candidate = aggregateForecastMetrics(pairs.map(pair => ({ actual: pair.actual, forecast: pair.candidate })));
  const improvements = pairs.map(pair => pair.improvement);
  const meanImprovement = mean(improvements);
  const baselineMean = baseline.meanAbsLogError ?? NaN;
  const practicalMargin = PRACTICAL_EFFECT_FRACTION * baselineMean;
  const bootstrap = movingBlockBootstrap(improvements, horizonDays, practicalMargin, 0x120000 + horizonDays * 997);
  const coverageDeltas = {
    interval80: nullableDiff(candidate.coverage.interval80, baseline.coverage.interval80),
    interval90: nullableDiff(candidate.coverage.interval90, baseline.coverage.interval90),
    interval95: nullableDiff(candidate.coverage.interval95, baseline.coverage.interval95),
  };
  const subperiodMeanImprovements = {
    '2017-2021': subsetMean(pairs, '2017-01-01', '2021-12-31'),
    '2022-2024': subsetMean(pairs, '2022-01-01', '2024-12-31'),
    '2025+': subsetMean(pairs, '2025-01-01', null),
  };
  const nominalNonOverlappingEquivalents = Math.floor(pairs.length / horizonDays);
  const reasons: string[] = [];
  if (nominalNonOverlappingEquivalents < 30) reasons.push(`nominal non-overlapping equivalents ${nominalNonOverlappingEquivalents} < 30`);
  if (!(meanImprovement >= practicalMargin)) reasons.push(`mean improvement ${format(meanImprovement)} is below 1% practical margin ${format(practicalMargin)}`);
  if (!(bootstrap.lower95 > 0)) reasons.push(`one-sided 95% lower bound ${format(bootstrap.lower95)} is not positive`);
  for (const [interval, delta] of Object.entries(coverageDeltas)) {
    if (delta === null || delta < -0.02) reasons.push(`${interval} coverage delta ${format(delta)} is below -0.02`);
  }
  for (const [period, improvement] of Object.entries(subperiodMeanImprovements)) {
    if (improvement === null || improvement < 0) reasons.push(`${period} mean improvement ${format(improvement)} is negative`);
  }
  return {
    horizonDays,
    samples: pairs.length,
    nominalNonOverlappingEquivalents,
    baseline,
    candidate,
    meanAbsLogErrorImprovement: meanImprovement,
    relativeMeanAbsLogErrorImprovement: meanImprovement / baselineMean,
    bootstrap,
    subperiodMeanImprovements,
    coverageDeltas,
    unadjustedPassed: reasons.length === 0,
    reasons,
  };
}

function forecast(originIndex: number, horizonDays: number, tauDays: number): ForecastDistribution | null {
  const origin = rows[originIndex];
  const currentDate = parseDate(origin.date);
  const targetDate = parseDate(rows[originIndex + horizonDays].date);
  const median = powerLawForecastWithTau(targetDate, origin.close, currentDate, tauDays);
  const interval = computePowerLawInterval({
    ohlcv: rows.slice(0, originIndex + 1),
    horizonDays,
    median,
    currentPrice: origin.close,
  });
  if (!interval) return null;
  return {
    median,
    sigma: interval.sigma,
    quantiles: {
      q025: median * Math.exp(interval.sigma * normalQuantile(0.025)),
      q05: median * Math.exp(interval.sigma * normalQuantile(0.05)),
      q10: median * Math.exp(interval.sigma * normalQuantile(0.10)),
      q50: median,
      q90: median * Math.exp(interval.sigma * normalQuantile(0.90)),
      q95: median * Math.exp(interval.sigma * normalQuantile(0.95)),
      q975: median * Math.exp(interval.sigma * normalQuantile(0.975)),
    },
  };
}

function movingBlockBootstrap(values: number[], blockLength: number, practicalMargin: number, seed: number): BootstrapResult {
  const rng = mulberry32(seed);
  const observed = mean(values);
  const centeredAtNull = values.map(value => value - observed + practicalMargin);
  const bootstrapMeans: number[] = [];
  let nullExceedances = 0;
  for (let iteration = 0; iteration < BOOTSTRAP_ITERATIONS; iteration++) {
    let rawSum = 0;
    let nullSum = 0;
    let count = 0;
    while (count < values.length) {
      const start = Math.floor(rng() * Math.max(1, values.length - blockLength + 1));
      for (let offset = 0; offset < blockLength && count < values.length; offset++, count++) {
        rawSum += values[start + offset];
        nullSum += centeredAtNull[start + offset];
      }
    }
    bootstrapMeans.push(rawSum / values.length);
    if (nullSum / values.length >= observed) nullExceedances++;
  }
  bootstrapMeans.sort((a, b) => a - b);
  return {
    blockLength,
    iterations: BOOTSTRAP_ITERATIONS,
    lower95: quantileSorted(bootstrapMeans, 0.05),
    twoSided95: [quantileSorted(bootstrapMeans, 0.025), quantileSorted(bootstrapMeans, 0.975)],
    practicalNullMargin: practicalMargin,
    oneSidedPValue: (nullExceedances + 1) / (BOOTSTRAP_ITERATIONS + 1),
  };
}

function holmAdjust(pValues: number[]): number[] {
  const ranked = pValues.map((p, index) => ({ p, index })).sort((a, b) => a.p - b.p);
  const adjusted = Array(pValues.length).fill(1);
  let runningMax = 0;
  ranked.forEach((item, rank) => {
    runningMax = Math.max(runningMax, Math.min(1, (pValues.length - rank) * item.p));
    adjusted[item.index] = runningMax;
  });
  return adjusted;
}

function renderMarkdown(report: any): string {
  const lines = [
    '# Fixed-Tau 120 Replication Report',
    '',
    '## Claim',
    '',
    '- Asset: BTC.',
    '- Forecast target: daily close endpoint price.',
    `- Horizons: ${report.metadata.horizons.join(', ')} calendar days.`,
    `- Candidate change: residual mean-reversion tau ${report.metadata.baselineTauDays} → ${report.metadata.candidateTauDays} days.`,
    '- Current app baseline: static power-law curve with tau=210.',
    '- Naive baseline: previously validated current-price persistence; this paired replication isolates tau only.',
    '- Expected benefit: lower endpoint error without material interval-calibration loss.',
    '',
    '## Data',
    '',
    `- Source: \`src/data/btc-history.json\` (SHA-256 \`${report.metadata.datasetSha256}\`).`,
    `- Range: ${report.metadata.dataset.firstDate} → ${report.metadata.dataset.lastDate}; ${report.metadata.dataset.rowCount} daily UTC rows.`,
    `- Evaluation origins: ${report.metadata.evaluationStart} through the latest origin with an observed target.`,
    '- Leakage check: forecasts use the origin close and prior rows only; target close is used only for scoring.',
    '- Structural limitation: current static power-law coefficients may encode post-origin information.',
    '',
    '## Pre-Specified Evaluation',
    '',
    '- Single candidate: tau=120; no grid or parameter selection in this run.',
    '- Primary metric: paired mean absolute log-error improvement.',
    '- Practical null: candidate improvement must exceed 1% of baseline mean absolute log error.',
    '- Dependence: 10,000 seeded moving-block bootstrap iterations with block length equal to horizon.',
    '- Multiplicity: one-sided p-values adjusted by Holm across four horizons.',
    '- Gate: ≥30 nominal non-overlapping equivalents, positive lower95, adjusted p<0.05, ≥1% improvement, coverage loss ≤2pp, and no negative reported origin subperiod.',
    '- `lower95` is the uncentered one-sided confidence bound against zero; the Holm p-value tests the stricter 1% practical-improvement null.',
    '- Claim status is capped at research-only because no untouched final holdout exists.',
    '',
    '## Results',
    '',
    `Command: \`${report.metadata.command}\``,
    '',
    '| Horizon | N | Nominal non-overlap N | Baseline MALE | Candidate MALE | Relative improvement | Lower95 | Holm p | Δcov 80/90/95 | Gate |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |',
  ];
  for (const result of report.results as HorizonResult[]) {
    lines.push([
      `| ${result.horizonDays}d`,
      result.samples,
      result.nominalNonOverlappingEquivalents,
      format(result.baseline.meanAbsLogError),
      format(result.candidate.meanAbsLogError),
      formatPercent(result.relativeMeanAbsLogErrorImprovement),
      format(result.bootstrap.lower95),
      format(result.holmAdjustedPValue ?? null),
      `${formatPercent(result.coverageDeltas.interval80)} / ${formatPercent(result.coverageDeltas.interval90)} / ${formatPercent(result.coverageDeltas.interval95)}`,
      result.passed ? 'PASS' : 'FAIL',
      '|',
    ].join(' | '));
  }
  lines.push('', '### Origin-subperiod robustness', '', '| Horizon | 2017–2021 | 2022–2024 | 2025+ |', '| ---: | ---: | ---: | ---: |');
  for (const result of report.results as HorizonResult[]) {
    lines.push(`| ${result.horizonDays}d | ${format(result.subperiodMeanImprovements['2017-2021'])} | ${format(result.subperiodMeanImprovements['2022-2024'])} | ${format(result.subperiodMeanImprovements['2025+'])} |`);
  }
  lines.push('', 'Positive values mean tau=120 had lower absolute log error.', '', '### Gate failures', '');
  for (const result of report.results as HorizonResult[]) {
    lines.push(`- ${result.horizonDays}d: ${result.reasons.length ? result.reasons.join('; ') : 'none'}.`);
  }
  lines.push(
    '',
    '## Regression Controls',
    '',
    '- Production model/config: unchanged.',
    '- API/UI behavior: unchanged.',
    '- Experiment output only: deterministic JSON and Markdown artifacts.',
    '- Repository validation: TypeScript, unit tests, and the default backtest are run separately after this report.',
    '',
    '## Independent Validation',
    '',
    '- Validator roles: separate data audit, signal/backtest audit, and statistical skeptic.',
    '- Math: `F_tau(o,h)=B(o+h) exp(log(P_o/B(o)) exp(-h/tau))`; loss is `abs(log(F/P_target))`.',
    '- Statistical assumption: paired loss differences are locally dependent; horizon-length moving blocks preserve overlap dependence approximately.',
    '- Future-information proof: the tau forecast itself reads no row after the origin; the static structural curve provenance remains a disclosed retrospective limitation.',
    '',
    '## Decision',
    '',
    `Decision: \`${report.verdict}\`.`,
    '',
    report.verdictReason,
    '',
    `Rollout recommendation: ${report.historicalGatePassed ? 'do not modify production; freeze tau=120 only as a prospective challenger' : 'retain tau=210 and do not freeze or promote tau=120 from this evidence'}.`,
    '',
    'Remaining risks: repeated prior model searches, contaminated nominal holdouts, static coefficient provenance, and interval multipliers calibrated on 2022+.',
    ''
  );
  return `${lines.join('\n')}\n`;
}

function subsetMean(pairs: PairRow[], start: string, end: string | null): number | null {
  const selected = pairs.filter(pair => pair.originDate >= start && (!end || pair.originDate <= end));
  return selected.length > 0 ? mean(selected.map(pair => pair.improvement)) : null;
}

function isContiguous(originIndex: number, horizonDays: number): boolean {
  for (let step = 0; step < horizonDays; step++) {
    if ((parseDate(rows[originIndex + step + 1].date).getTime() - parseDate(rows[originIndex + step].date).getTime()) / 86400000 !== 1) return false;
  }
  return true;
}

function nullableDiff(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left - right;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantileSorted(values: number[], q: number): number {
  const position = (values.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return low === high ? values[low] : values[low] + (values[high] - values[low]) * (position - low);
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function format(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : value.toFixed(6);
}

function formatPercent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : `${(value * 100).toFixed(2)}%`;
}

function gitCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

main();
