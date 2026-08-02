import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import btcHistory from '../src/data/btc-history.json';
import { aggregateForecastMetrics, type BacktestMetricRow, type ForecastDistribution } from '../src/lib/backtestMetrics';
import type { OHLCVData } from '../src/lib/api';
import { blendedPowerLawHeatmapVol, powerLawResidualVariance } from '../src/lib/forecastInterval';
import { BACKTEST_CONFIG, INTERVAL_CALIBRATION_CONFIG } from '../src/lib/modelConfig';
import { quantileAt } from '../src/lib/predictiveDistribution';
import { CRPS_METHOD_METADATA } from '../src/lib/properScoring';
import { powerLawForecast } from '../src/lib/powerLaw';

const FIT_HORIZONS = [14, 30, 60, 90, 180, 365] as const;
const TARGETS = {
  interval80: 0.80,
  interval90: 0.90,
  interval95: 0.95,
} as const;
const REPORT_DIR = join(process.cwd(), 'docs', 'reports', 'results');

export type CalibrationRowStatus = 'VALIDATED' | 'DIVERGENT' | 'INSUFFICIENT_DATA';

export interface CalibrationPoint {
  originDate: string;
  actual: number;
  median: number;
  baseSigma: number;
}

export interface CalibrationRow {
  horizonDays: number;
  status: CalibrationRowStatus;
  multiplier: number | null;
  fitSamples: number;
  validationSamples: number;
  fitSkippedWindows: number;
  validationSkippedWindows: number;
  fitCoverage: typeof TARGETS | Record<keyof typeof TARGETS, number | null>;
  validationCoverage: typeof TARGETS | Record<keyof typeof TARGETS, number | null>;
  fitCrps: number | null;
  validationCrps: number | null;
  fitWinkler80: number | null;
  fitWinkler90: number | null;
  fitWinkler95: number | null;
  validationWinkler80: number | null;
  validationWinkler90: number | null;
  validationWinkler95: number | null;
  fitValidationDivergence: Record<keyof typeof TARGETS, number | null>;
  validationNominalDivergence: Record<keyof typeof TARGETS, number | null>;
  reasons: string[];
}

export interface CalibrationConfigRow {
  horizonDays: number;
  multiplier: number;
  coverageStatus: 'calibrated' | 'conservative' | 'scenario';
  label: 'Calibrated' | 'Conservative' | 'Scenario range';
}

/** Build origin-safe points for one explicitly bounded calibration window. */
export function buildCalibrationPoints(
  ohlcv: OHLCVData[],
  horizonDays: number,
  startDate: string,
  endDate?: string
): { points: CalibrationPoint[]; skippedWindows: number } {
  const points: CalibrationPoint[] = [];
  let skippedWindows = 0;

  for (
    let originIndex = BACKTEST_CONFIG.minimumLookbackDays;
    originIndex + horizonDays < ohlcv.length;
    originIndex += BACKTEST_CONFIG.rollingOriginSpacingDays
  ) {
    const origin = ohlcv[originIndex];
    if (origin.date < startDate || (endDate !== undefined && origin.date > endDate)) continue;
    if (!isContiguous(ohlcv, originIndex, horizonDays)) {
      skippedWindows++;
      continue;
    }

    const target = ohlcv[originIndex + horizonDays];
    const median = powerLawForecast(parseDate(target.date), origin.close, parseDate(origin.date));
    const historyAtOrigin = ohlcv.slice(0, originIndex + 1);
    const baseSigma = Math.sqrt(powerLawResidualVariance(horizonDays, blendedPowerLawHeatmapVol(historyAtOrigin)));
    if (Number.isFinite(median) && median > 0 && Number.isFinite(baseSigma) && baseSigma > 0 && Number.isFinite(target.close) && target.close > 0) {
      points.push({ originDate: origin.date, actual: target.close, median, baseSigma });
    }
  }

  return { points, skippedWindows };
}

/** Fit only on the configured fit window, then evaluate on the disjoint validation window. */
export function fitHorizon(
  ohlcv: OHLCVData[],
  horizonDays: number,
  config = INTERVAL_CALIBRATION_CONFIG
): CalibrationRow {
  const fit = buildCalibrationPoints(ohlcv, horizonDays, config.fitStartDate, config.fitEndDate);
  const validation = buildCalibrationPoints(ohlcv, horizonDays, config.validationStartDate);
  if (fit.points.length < config.minimumEligibleRows || validation.points.length < config.minimumEligibleRows) {
    return evaluateCalibrationRow({
      horizonDays,
      multiplier: null,
      fit,
      validation,
      config,
    });
  }

  let best: { multiplier: number; score: number } | null = null;
  for (let multiplier = 0.2; multiplier <= 4; multiplier += 0.01) {
    const roundedMultiplier = Number(multiplier.toFixed(2));
    const coverage = coverageForPoints(fit.points, roundedMultiplier);
    const score = Object.entries(TARGETS).reduce(
      (total, [key, target]) => total + Math.abs(coverage[key as keyof typeof TARGETS] - target),
      0
    );
    if (!best || score < best.score) best = { multiplier: roundedMultiplier, score };
  }

  return evaluateCalibrationRow({
    horizonDays,
    multiplier: best?.multiplier ?? null,
    fit,
    validation,
    config,
  });
}

/** Apply the declared divergence gate to a fixed multiplier, useful for synthetic guard tests. */
export function evaluateCalibrationRow(input: {
  horizonDays: number;
  multiplier: number | null;
  fit: { points: CalibrationPoint[]; skippedWindows: number };
  validation: { points: CalibrationPoint[]; skippedWindows: number };
  config?: typeof INTERVAL_CALIBRATION_CONFIG;
}): CalibrationRow {
  const config = input.config ?? INTERVAL_CALIBRATION_CONFIG;
  const fitMetric = input.multiplier === null ? null : metricsForPoints(input.fit.points, input.multiplier);
  const validationMetric = input.multiplier === null ? null : metricsForPoints(input.validation.points, input.multiplier);
  const fitCoverage = coverageFromMetric(fitMetric);
  const validationCoverage = coverageFromMetric(validationMetric);
  const fitValidationDivergence = divergenceByLevel(fitCoverage, validationCoverage);
  const validationNominalDivergence = divergenceFromNominal(validationCoverage);
  const reasons: string[] = [];

  if (input.fit.points.length < config.minimumEligibleRows) {
    reasons.push(`fit sample count ${input.fit.points.length} < minimum ${config.minimumEligibleRows}`);
  }
  if (input.validation.points.length < config.minimumEligibleRows) {
    reasons.push(`validation sample count ${input.validation.points.length} < minimum ${config.minimumEligibleRows}`);
  }
  for (const level of Object.keys(TARGETS) as (keyof typeof TARGETS)[]) {
    const fitValidation = fitValidationDivergence[level];
    const nominal = validationNominalDivergence[level];
    if (fitValidation !== null && fitValidation > config.divergenceTolerance) {
      reasons.push(`${level} fit/validation divergence ${fitValidation.toFixed(4)} > ${config.divergenceTolerance.toFixed(4)}`);
    }
    if (nominal !== null && nominal > config.divergenceTolerance) {
      reasons.push(`${level} validation/nominal divergence ${nominal.toFixed(4)} > ${config.divergenceTolerance.toFixed(4)}`);
    }
  }

  const status: CalibrationRowStatus = reasons.some(reason => reason.includes('sample count'))
    ? 'INSUFFICIENT_DATA'
    : reasons.length > 0
      ? 'DIVERGENT'
      : 'VALIDATED';
  return {
    horizonDays: input.horizonDays,
    status,
    multiplier: input.multiplier,
    fitSamples: input.fit.points.length,
    validationSamples: input.validation.points.length,
    fitSkippedWindows: input.fit.skippedWindows,
    validationSkippedWindows: input.validation.skippedWindows,
    fitCoverage,
    validationCoverage,
    fitCrps: fitMetric?.crps ?? null,
    validationCrps: validationMetric?.crps ?? null,
    fitWinkler80: fitMetric?.winkler80 ?? null,
    fitWinkler90: fitMetric?.winkler90 ?? null,
    fitWinkler95: fitMetric?.winkler95 ?? null,
    validationWinkler80: validationMetric?.winkler80 ?? null,
    validationWinkler90: validationMetric?.winkler90 ?? null,
    validationWinkler95: validationMetric?.winkler95 ?? null,
    fitValidationDivergence,
    validationNominalDivergence,
    reasons,
  };
}

export function suggestedConfig(rows: readonly CalibrationRow[]): CalibrationConfigRow[] | null {
  if (rows.some(row => row.status !== 'VALIDATED' || row.multiplier === null)) return null;
  return rows.map(row => {
    const coverage90 = row.validationCoverage.interval90 ?? 0;
    const coverage95 = row.validationCoverage.interval95 ?? 0;
    const status = row.horizonDays >= 180
      ? 'scenario'
      : coverage90 > 0.95 || coverage95 > 0.98
        ? 'conservative'
        : 'calibrated';
    return {
      horizonDays: row.horizonDays,
      multiplier: row.multiplier!,
      coverageStatus: status,
      label: status === 'scenario' ? 'Scenario range' : status === 'conservative' ? 'Conservative' : 'Calibrated',
    };
  });
}

function main(): void {
  const ohlcv = btcHistory as OHLCVData[];
  const rows = FIT_HORIZONS.map(horizon => fitHorizon(ohlcv, horizon));
  const config = suggestedConfig(rows);
  const generatedAt = new Date().toISOString();
  const report = {
    metadata: {
      generatedAt,
      command: 'yarn calibrate:intervals',
      gitCommit: gitCommit(),
      workingTreeDirty: workingTreeDirty(),
      sourceTreeDirty: sourceTreeDirty(),
      dataset: { firstDate: ohlcv[0]?.date ?? '', lastDate: ohlcv.at(-1)?.date ?? '', rowCount: ohlcv.length, sha256: createHash('sha256').update(JSON.stringify(ohlcv)).digest('hex') },
      calibration: INTERVAL_CALIBRATION_CONFIG,
      horizons: FIT_HORIZONS,
      crps: CRPS_METHOD_METADATA,
    },
    status: config ? 'VALIDATED' : rows.some(row => row.status === 'DIVERGENT') ? 'DIVERGENT' : 'INSUFFICIENT_DATA',
    suggestedConfig: config,
    rows,
    note: 'Validation coverage is scored on a disjoint window. DIVERGENT rows never contribute a suggested shipped multiplier. Approximate CRPS uses the sparse quantile grid and endpoint-constant tails described in metadata; Winkler is an absolute price-scale score. PIT is not used for multiplier fitting.',
  };

  console.log('Power-law interval calibration');
  console.log(`Dataset: ${ohlcv[0].date} to ${ohlcv.at(-1)!.date} (${ohlcv.length} rows)`);
  console.log(`Fit window: ${INTERVAL_CALIBRATION_CONFIG.fitStartDate} to ${INTERVAL_CALIBRATION_CONFIG.fitEndDate}`);
  console.log(`Validation window: ${INTERVAL_CALIBRATION_CONFIG.validationStartDate} onward`);
  console.log(`Divergence tolerance: ${INTERVAL_CALIBRATION_CONFIG.divergenceTolerance}`);
  console.log('');
  console.log('| Horizon | Status | Multiplier | Fit n | Validation n | Fit 80/90/95 | Validation 80/90/95 | Fit Approx CRPS | Validation Approx CRPS | Fit Winkler 80/90/95 | Validation Winkler 80/90/95 |');
  console.log('| ---: | --- | ---: | ---: | ---: | --- | --- | ---: | ---: | --- | --- |');
  for (const row of rows) console.log(renderRow(row));
  console.log('');
  if (config) {
    console.log('Suggested fittedMultipliers config:');
    console.log(JSON.stringify(config, null, 2));
  } else {
    console.log('Suggested fittedMultipliers config: REFUSED; at least one horizon is DIVERGENT or INSUFFICIENT_DATA.');
  }

  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `interval-calibration-${stamp}.json`);
  const markdownPath = join(REPORT_DIR, `interval-calibration-${stamp}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, renderMarkdown(report));
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${markdownPath}`);
}

function metricsForPoints(points: CalibrationPoint[], multiplier: number): BacktestMetricRow {
  return aggregateForecastMetrics(points.map(point => ({ actual: point.actual, forecast: forecastForPoint(point, multiplier) })));
}

function forecastForPoint(point: CalibrationPoint, multiplier: number): ForecastDistribution {
  const sigma = multiplier * point.baseSigma;
  const distribution = { kind: 'lognormal' as const };
  const quantilePrice = (probability: number) => quantileAt(distribution, point.median, sigma, probability);
  return {
    median: point.median,
    sigma,
    distribution,
    quantiles: {
      q025: quantilePrice(0.025),
      q05: quantilePrice(0.05),
      q10: quantilePrice(0.10),
      q50: point.median,
      q90: quantilePrice(0.90),
      q95: quantilePrice(0.95),
      q975: quantilePrice(0.975),
    },
  };
}

function coverageForPoints(points: CalibrationPoint[], multiplier: number): Record<keyof typeof TARGETS, number> {
  return coverageFromMetric(metricsForPoints(points, multiplier)) as Record<keyof typeof TARGETS, number>;
}

function coverageFromMetric(metric: BacktestMetricRow | null): Record<keyof typeof TARGETS, number | null> {
  return {
    interval80: metric?.coverage.interval80 ?? null,
    interval90: metric?.coverage.interval90 ?? null,
    interval95: metric?.coverage.interval95 ?? null,
  };
}

function divergenceByLevel(
  fit: Record<keyof typeof TARGETS, number | null>,
  validation: Record<keyof typeof TARGETS, number | null>
): Record<keyof typeof TARGETS, number | null> {
  return {
    interval80: absoluteDifference(fit.interval80, validation.interval80),
    interval90: absoluteDifference(fit.interval90, validation.interval90),
    interval95: absoluteDifference(fit.interval95, validation.interval95),
  };
}

function divergenceFromNominal(
  coverage: Record<keyof typeof TARGETS, number | null>
): Record<keyof typeof TARGETS, number | null> {
  return {
    interval80: absoluteDifference(coverage.interval80, TARGETS.interval80),
    interval90: absoluteDifference(coverage.interval90, TARGETS.interval90),
    interval95: absoluteDifference(coverage.interval95, TARGETS.interval95),
  };
}

function absoluteDifference(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : Math.abs(left - right);
}

function renderRow(row: CalibrationRow): string {
  return [
    `| ${row.horizonDays}d`,
    row.status,
    row.multiplier?.toFixed(2) ?? 'n/a',
    row.fitSamples,
    row.validationSamples,
    formatCoverage(row.fitCoverage),
    formatCoverage(row.validationCoverage),
    formatMetric(row.fitCrps),
    formatMetric(row.validationCrps),
    formatWinkler(row.fitWinkler80, row.fitWinkler90, row.fitWinkler95),
    formatWinkler(row.validationWinkler80, row.validationWinkler90, row.validationWinkler95),
    '|',
  ].join(' | ');
}

function renderMarkdown(report: {
  metadata: {
    generatedAt: string;
    gitCommit: string;
    workingTreeDirty: boolean;
    sourceTreeDirty: boolean;
    calibration: typeof INTERVAL_CALIBRATION_CONFIG;
    crps: typeof CRPS_METHOD_METADATA;
    dataset: { firstDate: string; lastDate: string; rowCount: number; sha256: string };
  };
  status: string;
  suggestedConfig: CalibrationConfigRow[] | null;
  rows: CalibrationRow[];
  note: string;
}): string {
  return [
    '# Disjoint Interval Calibration',
    '',
    `Generated: ${report.metadata.generatedAt}`,
    `Git commit: \`${report.metadata.gitCommit}\``,
    `Working tree dirty at generation start: ${report.metadata.workingTreeDirty ? 'yes' : 'no'}`,
    `Source tree dirty at generation start: ${report.metadata.sourceTreeDirty ? 'yes' : 'no'}`,
    `Dataset: ${report.metadata.dataset.firstDate} to ${report.metadata.dataset.lastDate} (${report.metadata.dataset.rowCount} rows)`,
    `Dataset SHA-256: \`${report.metadata.dataset.sha256}\``,
    `Fit window: ${report.metadata.calibration.fitStartDate} to ${report.metadata.calibration.fitEndDate}`,
    `Validation window: ${report.metadata.calibration.validationStartDate} onward`,
    `Divergence tolerance: ${report.metadata.calibration.divergenceTolerance}`,
    `Status: **${report.status}**`,
    '',
    report.note,
    `CRPS: ${report.metadata.crps.label}. Method: ${report.metadata.crps.method}. Grid: ${report.metadata.crps.quantileGrid.join(', ')}. Tail convention: ${report.metadata.crps.tailConvention}`,
    `CRPS approximation error: ${report.metadata.crps.approximationErrorBoundStatement}`,
    '',
    '| Horizon | Status | Multiplier | Fit n | Validation n | Fit 80/90/95 | Validation 80/90/95 | Fit Approx CRPS | Validation Approx CRPS | Fit Winkler 80/90/95 | Validation Winkler 80/90/95 |',
    '| ---: | --- | ---: | ---: | ---: | --- | --- | ---: | ---: | --- | --- |',
    ...report.rows.map(renderRow),
    '',
    report.suggestedConfig
      ? `Suggested config:\n\n\`\`\`json\n${JSON.stringify(report.suggestedConfig, null, 2)}\n\`\`\``
      : 'Suggested config: **REFUSED** because at least one horizon failed the disjoint validation gate.',
    '',
    ...report.rows.flatMap(row => row.reasons.length > 0 ? [`- ${row.horizonDays}d: ${row.reasons.join('; ')}`] : []),
    '',
    'Validation coverage is reported separately from fit coverage. No multiplier is suggested for a DIVERGENT horizon.',
    '',
  ].join('\n');
}

function formatCoverage(coverage: Record<keyof typeof TARGETS, number | null>): string {
  return [coverage.interval80, coverage.interval90, coverage.interval95].map(formatPercent).join(' / ');
}

function formatWinkler(interval80: number | null, interval90: number | null, interval95: number | null): string {
  return [interval80, interval90, interval95].map(formatMetric).join(' / ');
}

function formatMetric(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : value.toFixed(5);
}

function formatPercent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'n/a' : `${(value * 100).toFixed(1)}%`;
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

function isContiguous(data: OHLCVData[], start: number, horizon: number): boolean {
  for (let step = 0; step < horizon; step++) {
    const current = parseDate(data[start + step].date);
    const next = parseDate(data[start + step + 1].date);
    if ((next.getTime() - current.getTime()) / 86_400_000 !== 1) return false;
  }
  return true;
}

function parseDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
