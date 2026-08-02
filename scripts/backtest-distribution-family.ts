import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import btcHistory from '../src/data/btc-history.json';
import { aggregateForecastMetrics, type BacktestMetricRow, type ForecastDistribution, type MetricInput } from '../src/lib/backtestMetrics';
import type { OHLCVData } from '../src/lib/api';
import { BACKTEST_CONFIG, DISTRIBUTION_CONFIG, INTERVAL_CALIBRATION_CONFIG, POWER_LAW_CONFIG } from '../src/lib/modelConfig';
import { crpsFromQuantiles, CRPS_METHOD_METADATA } from '../src/lib/properScoring';
import { powerLawForecast } from '../src/lib/powerLaw';
import { quantileAt, type PredictiveDistribution } from '../src/lib/predictiveDistribution';
import { computePowerLawInterval } from '../src/lib/forecastInterval';

export const DISTRIBUTION_NU_GRID = [3, 4, 5, 6, 8, 10, 15, 20, 30, Number.POSITIVE_INFINITY] as const;
export const DISTRIBUTION_GATE_HORIZONS = [...BACKTEST_CONFIG.requiredGateHorizons] as const;
export const DISTRIBUTION_BOOTSTRAP_ITERATIONS = 4_000;
export const DISTRIBUTION_PROMOTION_GATE = `\`DISTRIBUTION_CONFIG.defaultEnabled\` may flip to \`true\` only if, at **every** one of 14/30/60/90d:

1. Validation CRPS improves versus log-normal, with a positive block-bootstrap 5% lower bound after Holm correction across the four horizons;
2. 80% coverage moves toward nominal and 95% coverage does not move away from it;
3. PIT uniformity improves (lower chi-square statistic);
4. Median absolute log error is **identical** to the baseline — any movement means the median was touched, which is out of scope and voids the run;
5. The selected \`nu\` is within a factor of two between the fit and validation windows. Instability here is the ledger's most common failure signature (tau=120, close-sma200, MACD all reversed sign across subperiods) and must block promotion rather than be argued around.`;

const QUANTILE_POINTS = [
  ['q025', 0.025],
  ['q05', 0.05],
  ['q10', 0.10],
  ['q50', 0.50],
  ['q90', 0.90],
  ['q95', 0.95],
  ['q975', 0.975],
] as const;

const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');
const ALPHA = 0.05;

export interface DistributionObservation {
  originDate: string;
  targetDate: string;
  actual: number;
  median: number;
  sigma: number;
}

export interface DistributionScore {
  metrics: BacktestMetricRow;
  crpsValues: number[];
  inputs: MetricInput[];
}

interface BootstrapSummary {
  blockLength: number;
  iterations: number;
  observedMeanImprovement: number | null;
  rawPValue: number;
  lower95: number | null;
  means: number[];
}

interface HorizonEvaluation {
  horizonDays: number;
  fitSamples: number;
  validationSamples: number;
  fitSelectedNu: number;
  validationSelectedNu: number;
  baseline: BacktestMetricRow;
  candidate: BacktestMetricRow;
  fitSelectedMetrics: BacktestMetricRow;
  validationSelectedMetrics: BacktestMetricRow;
  grid: { nu: number; fitCrps: number | null; validationCrps: number | null }[];
  bootstrap: BootstrapSummary;
  holmRank: number | null;
  holmAdjustedPValue: number | null;
  lowerBoundAfterHolm: number | null;
  gates: {
    crps: boolean;
    coverage: boolean;
    pit: boolean;
    median: boolean;
    stability: boolean;
  };
  passed: boolean;
}

export function distributionForNu(nu: number): PredictiveDistribution {
  return nu === Number.POSITIVE_INFINITY ? { kind: 'lognormal' } : { kind: 'student-t', nu };
}

export function scoreLognormalBaseline(observations: DistributionObservation[]): DistributionScore {
  return scoreWithDistribution(observations, { kind: 'lognormal' });
}

export function scoreDistribution(observations: DistributionObservation[], nu: number): DistributionScore {
  return scoreWithDistribution(observations, distributionForNu(nu));
}

function scoreWithDistribution(
  observations: DistributionObservation[],
  distribution: PredictiveDistribution
): DistributionScore {
  const inputs = observations.map(observation => ({
    actual: observation.actual,
    forecast: forecastDistribution(observation, distribution),
  }));
  const metrics = aggregateForecastMetrics(inputs);
  const crpsValues = inputs
    .map(input => crpsFromQuantiles(input.actual, input.forecast.quantiles ?? {}))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  return { metrics, crpsValues, inputs };
}

function forecastDistribution(
  observation: DistributionObservation,
  distribution: PredictiveDistribution
): ForecastDistribution {
  return {
    median: observation.median,
    sigma: observation.sigma,
    distribution,
    quantiles: Object.fromEntries(
      QUANTILE_POINTS.map(([key, probability]) => [
        key,
        key === 'q50' ? observation.median : quantileAt(distribution, observation.median, observation.sigma, probability),
      ])
    ) as ForecastDistribution['quantiles'],
  };
}

function collectObservations(
  rows: OHLCVData[],
  horizonDays: number,
  startDate: string,
  endDate?: string,
  requireTargetBeforeEnd = false
): DistributionObservation[] {
  const observations: DistributionObservation[] = [];
  for (
    let originIndex = BACKTEST_CONFIG.minimumLookbackDays;
    originIndex + horizonDays < rows.length;
    originIndex += BACKTEST_CONFIG.rollingOriginSpacingDays
  ) {
    const origin = rows[originIndex];
    const target = rows[originIndex + horizonDays];
    if (origin.date < startDate || endDate && origin.date > endDate) continue;
    if (requireTargetBeforeEnd && endDate && target.date > endDate) continue;
    if (!isContiguous(rows, originIndex, horizonDays)) continue;

    const originDate = parseDate(origin.date);
    const targetDate = parseDate(target.date);
    const median = powerLawForecast(targetDate, origin.close, originDate);
    const interval = computePowerLawInterval({
      ohlcv: rows.slice(0, originIndex + 1),
      horizonDays,
      median,
      currentPrice: origin.close,
    });
    if (!interval || !Number.isFinite(target.close) || target.close <= 0 || !Number.isFinite(median) || median <= 0) continue;
    observations.push({
      originDate: origin.date,
      targetDate: target.date,
      actual: target.close,
      median,
      sigma: interval.sigma,
    });
  }
  return observations;
}

function evaluateHorizon(
  rows: OHLCVData[],
  horizonDays: number
): HorizonEvaluation {
  const fit = collectObservations(
    rows,
    horizonDays,
    INTERVAL_CALIBRATION_CONFIG.fitStartDate,
    INTERVAL_CALIBRATION_CONFIG.fitEndDate,
    true
  );
  const validation = collectObservations(
    rows,
    horizonDays,
    INTERVAL_CALIBRATION_CONFIG.validationStartDate
  );
  const scored = DISTRIBUTION_NU_GRID.map(nu => ({
    nu,
    fit: scoreDistribution(fit, nu),
    validation: scoreDistribution(validation, nu),
  }));
  const fitSelected = selectByCrps(scored.map(candidate => ({ nu: candidate.nu, score: candidate.fit })));
  const validationSelected = selectByCrps(scored.map(candidate => ({ nu: candidate.nu, score: candidate.validation })));
  const baseline = scoreLognormalBaseline(validation);
  const selectedCandidate = scored.find(candidate => candidate.nu === fitSelected.nu)?.validation ?? scoreDistribution(validation, fitSelected.nu);
  const fitSelectedMetrics = scored.find(candidate => candidate.nu === fitSelected.nu)?.fit.metrics ?? fitSelected.score.metrics;
  const validationSelectedMetrics = validationSelected.score.metrics;
  const bootstrap = blockBootstrapCrpsDifference(
    baseline.crpsValues,
    selectedCandidate.crpsValues,
    horizonDays,
    0xD157000 + horizonDays * 997
  );

  return {
    horizonDays,
    fitSamples: fit.length,
    validationSamples: validation.length,
    fitSelectedNu: fitSelected.nu,
    validationSelectedNu: validationSelected.nu,
    baseline: baseline.metrics,
    candidate: selectedCandidate.metrics,
    fitSelectedMetrics,
    validationSelectedMetrics,
    grid: scored.map(candidate => ({
      nu: candidate.nu,
      fitCrps: candidate.fit.metrics.crps,
      validationCrps: candidate.validation.metrics.crps,
    })),
    bootstrap,
    holmRank: null,
    holmAdjustedPValue: null,
    lowerBoundAfterHolm: null,
    gates: {
      crps: false,
      coverage: coverageGate(selectedCandidate.metrics, baseline.metrics),
      pit: pitGate(selectedCandidate.metrics, baseline.metrics),
      median: selectedCandidate.metrics.medianAbsLogError === baseline.metrics.medianAbsLogError,
      stability: withinFactorOfTwo(fitSelected.nu, validationSelected.nu),
    },
    passed: false,
  };
}

function applyHolmCorrection(evaluations: HorizonEvaluation[]): void {
  const ranked = [...evaluations].sort((left, right) => left.bootstrap.rawPValue - right.bootstrap.rawPValue);
  let previousAdjusted = 0;
  ranked.forEach((evaluation, rank) => {
    const familySize = ranked.length - rank;
    const adjusted = Math.min(1, evaluation.bootstrap.rawPValue * familySize);
    previousAdjusted = Math.max(previousAdjusted, adjusted);
    evaluation.holmRank = rank + 1;
    evaluation.holmAdjustedPValue = previousAdjusted;
    const correctedAlpha = ALPHA / familySize;
    const lowerIndex = Math.floor((evaluation.bootstrap.means.length - 1) * correctedAlpha);
    evaluation.lowerBoundAfterHolm = evaluation.bootstrap.means.length > 0
      ? evaluation.bootstrap.means[Math.max(0, lowerIndex)]
      : null;
    evaluation.gates.crps = (
      evaluation.candidate.crps !== null &&
      evaluation.baseline.crps !== null &&
      evaluation.candidate.crps < evaluation.baseline.crps &&
      evaluation.lowerBoundAfterHolm !== null &&
      evaluation.lowerBoundAfterHolm > 0 &&
      evaluation.holmAdjustedPValue < ALPHA
    );
    evaluation.passed = Object.values(evaluation.gates).every(Boolean);
  });
}

function coverageGate(candidate: BacktestMetricRow, baseline: BacktestMetricRow): boolean {
  const candidate80 = candidate.coverage.interval80;
  const baseline80 = baseline.coverage.interval80;
  const candidate95 = candidate.coverage.interval95;
  const baseline95 = baseline.coverage.interval95;
  return candidate80 !== null && baseline80 !== null && candidate95 !== null && baseline95 !== null
    && Math.abs(candidate80 - 0.8) <= Math.abs(baseline80 - 0.8)
    && Math.abs(candidate95 - 0.95) <= Math.abs(baseline95 - 0.95);
}

function pitGate(candidate: BacktestMetricRow, baseline: BacktestMetricRow): boolean {
  const candidatePit = candidate.pitUniformity?.chiSquare;
  const baselinePit = baseline.pitUniformity?.chiSquare;
  return candidatePit !== undefined && candidatePit !== null && baselinePit !== undefined && baselinePit !== null
    && candidatePit < baselinePit;
}

function withinFactorOfTwo(left: number, right: number): boolean {
  if (left === Number.POSITIVE_INFINITY || right === Number.POSITIVE_INFINITY) return left === right;
  return Number.isFinite(left) && Number.isFinite(right) && Math.max(left, right) <= 2 * Math.min(left, right);
}

function selectByCrps(candidates: { nu: number; score: DistributionScore }[]): { nu: number; score: DistributionScore } {
  return candidates.reduce((best, candidate) => {
    const candidateCrps = candidate.score.metrics.crps ?? Number.POSITIVE_INFINITY;
    const bestCrps = best.score.metrics.crps ?? Number.POSITIVE_INFINITY;
    return candidateCrps < bestCrps ? candidate : best;
  });
}

function blockBootstrapCrpsDifference(
  baselineCrps: number[],
  candidateCrps: number[],
  blockLength: number,
  seed: number
): BootstrapSummary {
  const improvements = baselineCrps
    .map((baseline, index) => baseline - candidateCrps[index])
    .filter((value, index) => Number.isFinite(value) && Number.isFinite(candidateCrps[index]));
  if (improvements.length === 0) {
    return { blockLength, iterations: DISTRIBUTION_BOOTSTRAP_ITERATIONS, observedMeanImprovement: null, rawPValue: 1, lower95: null, means: [] };
  }

  const rng = mulberry32(seed);
  const means: number[] = [];
  for (let iteration = 0; iteration < DISTRIBUTION_BOOTSTRAP_ITERATIONS; iteration++) {
    let total = 0;
    let count = 0;
    while (count < improvements.length) {
      const start = Math.floor(rng() * Math.max(1, improvements.length - blockLength + 1));
      for (let offset = 0; offset < blockLength && count < improvements.length; offset++, count++) total += improvements[start + offset];
    }
    means.push(total / improvements.length);
  }
  means.sort((left, right) => left - right);
  return {
    blockLength,
    iterations: DISTRIBUTION_BOOTSTRAP_ITERATIONS,
    observedMeanImprovement: mean(improvements),
    rawPValue: (1 + means.filter(value => value <= 0).length) / (means.length + 1),
    lower95: means[Math.floor((means.length - 1) * 0.05)] ?? null,
    means,
  };
}

function quantileRecord(metrics: BacktestMetricRow): Record<string, number | null> {
  return {
    crps: metrics.crps,
    winkler80: metrics.winkler80,
    winkler90: metrics.winkler90,
    winkler95: metrics.winkler95,
    coverage80: metrics.coverage.interval80,
    coverage90: metrics.coverage.interval90,
    coverage95: metrics.coverage.interval95,
    pitChiSquare: metrics.pitUniformity?.chiSquare ?? null,
    medianAbsLogError: metrics.medianAbsLogError,
  };
}

function buildReport(rows: OHLCVData[]): {
  metadata: Record<string, unknown>;
  protocol: Record<string, unknown>;
  horizons: HorizonEvaluation[];
  infinitySelfCheck: Record<string, unknown>;
  promotionGate: Record<string, unknown>;
} {
  const evaluations = DISTRIBUTION_GATE_HORIZONS.map(horizon => evaluateHorizon(rows, horizon));
  applyHolmCorrection(evaluations);
  const infinitySelfCheck = evaluateInfinitySelfCheck(rows);
  if (!infinitySelfCheck.passed) throw new Error('Infinity candidate did not score identically to the log-normal baseline');
  const promotionPassed = evaluations.every(evaluation => evaluation.passed);
  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      command: 'yarn backtest:distribution-family',
      gitCommit: gitCommit(),
      workingTreeDirty: workingTreeDirty(),
      sourceTreeDirty: sourceTreeDirty(),
      dataset: {
        firstDate: rows[0]?.date ?? '',
        lastDate: rows.at(-1)?.date ?? '',
        rowCount: rows.length,
        sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
      },
      modelConfig: {
        powerLaw: POWER_LAW_CONFIG,
        distribution: DISTRIBUTION_CONFIG,
      },
      scoring: CRPS_METHOD_METADATA,
    },
    protocol: {
      fitWindow: {
        start: INTERVAL_CALIBRATION_CONFIG.fitStartDate,
        end: INTERVAL_CALIBRATION_CONFIG.fitEndDate,
        targetMustEndBy: INTERVAL_CALIBRATION_CONFIG.fitEndDate,
      },
      validationWindow: { start: INTERVAL_CALIBRATION_CONFIG.validationStartDate, end: null },
      horizons: [...DISTRIBUTION_GATE_HORIZONS],
      nuGrid: DISTRIBUTION_NU_GRID.map(formatNu),
      selectionMetric: 'fit-window approximate CRPS; validation is scored after selection',
      bootstrap: {
        iterations: DISTRIBUTION_BOOTSTRAP_ITERATIONS,
        blockLength: 'forecast horizon days',
        difference: 'baseline CRPS minus selected-fit-nu CRPS; positive favours Student-t',
      },
      multipleTesting: 'Holm correction across the four gated horizons at alpha=0.05',
    },
    horizons: evaluations,
    infinitySelfCheck,
    promotionGate: {
      status: promotionPassed ? 'PASS' : 'FAIL',
      exactText: DISTRIBUTION_PROMOTION_GATE,
      defaultEnabledAtRun: DISTRIBUTION_CONFIG.defaultEnabled,
      checks: evaluations.map(evaluation => ({
        horizonDays: evaluation.horizonDays,
        passed: evaluation.passed,
        gates: evaluation.gates,
        fitSelectedNu: formatNu(evaluation.fitSelectedNu),
        validationSelectedNu: formatNu(evaluation.validationSelectedNu),
        validation: quantileRecord(evaluation.candidate),
        baseline: quantileRecord(evaluation.baseline),
        bootstrap: {
          blockLength: evaluation.bootstrap.blockLength,
          iterations: evaluation.bootstrap.iterations,
          observedMeanImprovement: evaluation.bootstrap.observedMeanImprovement,
          rawPValue: evaluation.bootstrap.rawPValue,
          lower95: evaluation.bootstrap.lower95,
          holmRank: evaluation.holmRank,
          holmAdjustedPValue: evaluation.holmAdjustedPValue,
          lowerBoundAfterHolm: evaluation.lowerBoundAfterHolm,
        },
      })),
      verdict: promotionPassed
        ? 'All five gates passed at every gated horizon; manual config promotion remains a separate action.'
        : 'Report-only: at least one pre-registered gate failed at one or more gated horizons; keep the Student-t candidate disabled and register the empirical-shape follow-up.',
    },
  };
}

function evaluateInfinitySelfCheck(rows: OHLCVData[]): { passed: boolean; horizons: Record<string, { samples: number; crpsDifference: number | null; exactMetricMatch: boolean }> } {
  const horizons: Record<string, { samples: number; crpsDifference: number | null; exactMetricMatch: boolean }> = {};
  let passed = true;
  for (const horizon of DISTRIBUTION_GATE_HORIZONS) {
    const observations = collectObservations(rows, horizon, INTERVAL_CALIBRATION_CONFIG.validationStartDate);
    const baseline = scoreLognormalBaseline(observations);
    const infinity = scoreDistribution(observations, Number.POSITIVE_INFINITY);
    const crpsDifference = baseline.metrics.crps === null || infinity.metrics.crps === null
      ? null
      : Math.abs(baseline.metrics.crps - infinity.metrics.crps);
    const exactMetricMatch = JSON.stringify(baseline.metrics) === JSON.stringify(infinity.metrics)
      && baseline.crpsValues.length === infinity.crpsValues.length
      && baseline.crpsValues.every((value, index) => value === infinity.crpsValues[index]);
    horizons[String(horizon)] = { samples: observations.length, crpsDifference, exactMetricMatch };
    passed = passed && exactMetricMatch && (crpsDifference === null || crpsDifference < 1e-9);
  }
  return { passed, horizons };
}

function writeReport(report: ReturnType<typeof buildReport>): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = String(report.metadata.generatedAt).replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `distribution-family-${stamp}.json`);
  const markdownPath = join(REPORT_DIR, `distribution-family-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, renderMarkdown(report));
  const gate = report.promotionGate as { status: string; verdict: string };
  console.log(`Distribution-family promotion gate: ${gate.status}`);
  console.log(gate.verdict);
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${markdownPath}`);
}

function renderMarkdown(report: ReturnType<typeof buildReport>): string {
  const lines = [
    '# Predictive Distribution Family Report',
    '',
    'Status: report-only; no runtime Student-t promotion is performed by this script.',
    '',
    '## Provenance',
    '',
    `- Generated: ${report.metadata.generatedAt}`,
    `- Git commit: \`${report.metadata.gitCommit}\``,
    `- Working tree dirty at generation start: ${report.metadata.workingTreeDirty ? 'yes' : 'no'}`,
    `- Source tree dirty at generation start: ${report.metadata.sourceTreeDirty ? 'yes' : 'no'}`,
    `- Dataset: ${String((report.metadata.dataset as { firstDate: string }).firstDate)} through ${String((report.metadata.dataset as { lastDate: string }).lastDate)} (${String((report.metadata.dataset as { rowCount: number }).rowCount)} rows)`,
    `- Dataset SHA-256: \`${String((report.metadata.dataset as { sha256: string }).sha256)}\``,
    '',
    '## Protocol',
    '',
    `- Fit window: ${INTERVAL_CALIBRATION_CONFIG.fitStartDate} through ${INTERVAL_CALIBRATION_CONFIG.fitEndDate}; target must end by fit end`,
    `- Validation window: ${INTERVAL_CALIBRATION_CONFIG.validationStartDate} onward`,
    `- Horizons: ${DISTRIBUTION_GATE_HORIZONS.join(', ')} days`,
    `- Exact nu grid: ${DISTRIBUTION_NU_GRID.map(formatNu).join(', ')}`,
    `- Selection: fit-window CRPS; validation scored after selection`,
    `- Bootstrap: ${DISTRIBUTION_BOOTSTRAP_ITERATIONS} moving-block iterations with block length equal to horizon`,
    '- Multiplicity: Holm correction across the four gated horizons at alpha=0.05',
    '',
    '## Infinity self-check',
    '',
    `- Passed: ${report.infinitySelfCheck.passed ? 'yes' : 'no'}`,
    '| Horizon | Samples | CRPS difference | Exact metric match |',
    '| ---: | ---: | ---: | --- |',
    ...Object.entries(report.infinitySelfCheck.horizons as Record<string, { samples: number; crpsDifference: number | null; exactMetricMatch: boolean }>).map(([horizon, check]) => `| ${horizon} | ${check.samples} | ${formatMetric(check.crpsDifference)} | ${check.exactMetricMatch ? 'yes' : 'no'} |`),
    '',
    '## Candidate grid CRPS',
    '',
    '| Horizon | nu | Fit CRPS | Validation CRPS |',
    '| ---: | ---: | ---: | ---: |',
    ...report.horizons.flatMap(evaluation => evaluation.grid.map(candidate => `| ${evaluation.horizonDays} | ${formatNu(candidate.nu)} | ${formatMetric(candidate.fitCrps)} | ${formatMetric(candidate.validationCrps)} |`)),
    '',
    '## Baseline versus selected Student-t on validation',
    '',
    '| Horizon | Fit nu | Validation-selected nu | CRPS baseline | CRPS candidate | Winkler 80/90/95 baseline | Winkler 80/90/95 candidate | PIT chi-square baseline/candidate | Coverage 80/90/95 baseline | Coverage 80/90/95 candidate | Median abs-log baseline/candidate |',
    '| ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- |',
    ...report.horizons.map(evaluation => [
      evaluation.horizonDays,
      formatNu(evaluation.fitSelectedNu),
      formatNu(evaluation.validationSelectedNu),
      formatMetric(evaluation.baseline.crps),
      formatMetric(evaluation.candidate.crps),
      [evaluation.baseline.winkler80, evaluation.baseline.winkler90, evaluation.baseline.winkler95].map(formatMetric).join(' / '),
      [evaluation.candidate.winkler80, evaluation.candidate.winkler90, evaluation.candidate.winkler95].map(formatMetric).join(' / '),
      `${formatMetric(evaluation.baseline.pitUniformity?.chiSquare ?? null)} / ${formatMetric(evaluation.candidate.pitUniformity?.chiSquare ?? null)}`,
      [evaluation.baseline.coverage.interval80, evaluation.baseline.coverage.interval90, evaluation.baseline.coverage.interval95].map(formatPercent).join(' / '),
      [evaluation.candidate.coverage.interval80, evaluation.candidate.coverage.interval90, evaluation.candidate.coverage.interval95].map(formatPercent).join(' / '),
      `${formatMetric(evaluation.baseline.medianAbsLogError)} / ${formatMetric(evaluation.candidate.medianAbsLogError)}`,
      '|',
    ].join(' | ')),
    '',
    'PIT histograms (counts; expected counts are uniform across the reported bins):',
    '',
    ...report.horizons.map(evaluation => `- ${evaluation.horizonDays}d baseline: ${formatPit(evaluation.baseline)}; selected candidate: ${formatPit(evaluation.candidate)}`),
    '',
    '## Promotion gate',
    '',
    `Status: **${(report.promotionGate as { status: string }).status}**`,
    '',
    ...report.horizons.map(evaluation => `- ${evaluation.horizonDays}d: ${evaluation.passed ? 'PASS' : 'FAIL'}; gates=${JSON.stringify(evaluation.gates)}; fit nu=${formatNu(evaluation.fitSelectedNu)}; validation-selected nu=${formatNu(evaluation.validationSelectedNu)}; Holm p=${formatMetric(evaluation.holmAdjustedPValue)}; corrected lower bound=${formatMetric(evaluation.lowerBoundAfterHolm)}; block length=${evaluation.bootstrap.blockLength}`),
    '',
    'Exact pre-registered gate:',
    '',
    DISTRIBUTION_PROMOTION_GATE,
    '',
    `Verdict: ${(report.promotionGate as { verdict: string }).verdict}`,
    '',
  ];
  return lines.join('\n');
}

function formatPit(metrics: BacktestMetricRow): string {
  if (!metrics.pitHistogram) return 'n/a';
  return `${metrics.pitHistogram.counts.join(',')} / expected ${metrics.pitHistogram.expectedCounts.map(value => value.toFixed(1)).join(',')}`;
}

function formatNu(nu: number): string {
  return nu === Number.POSITIVE_INFINITY ? 'Infinity' : String(nu);
}

function formatMetric(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : value.toFixed(8);
}

function formatPercent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function mulberry32(seed: number): () => number {
  return () => {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function isContiguous(data: OHLCVData[], start: number, horizon: number): boolean {
  for (let offset = 0; offset < horizon; offset++) {
    const current = parseDate(data[start + offset].date);
    const next = parseDate(data[start + offset + 1].date);
    if ((next.getTime() - current.getTime()) / 86_400_000 !== 1) return false;
  }
  return true;
}

function parseDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function gitCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function gitStatusEntries(): string[] {
  try {
    const output = execSync('git status --porcelain --untracked-files=all', { encoding: 'utf8' }).trim();
    return output ? output.split('\n') : [];
  } catch {
    return ['git status unavailable'];
  }
}

function workingTreeDirty(): boolean {
  return gitStatusEntries().length > 0;
}

function sourceTreeDirty(): boolean {
  return gitStatusEntries().some(entry => !entry.slice(3).startsWith('docs/reports/results/'));
}

function main(): void {
  const report = buildReport(btcHistory as OHLCVData[]);
  writeReport(report);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
