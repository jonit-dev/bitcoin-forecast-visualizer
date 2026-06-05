import btcHistory from '../src/data/btc-history.json';
import type { OHLCVData } from '../src/lib/api';
import {
  blendedPowerLawHeatmapVol,
  normalQuantile,
  powerLawResidualVariance,
} from '../src/lib/forecastInterval';
import { BACKTEST_CONFIG } from '../src/lib/modelConfig';
import { powerLawForecast } from '../src/lib/powerLaw';

const FIT_HORIZONS = [14, 30, 60, 90, 180, 365] as const;
const TARGETS = {
  interval80: 0.80,
  interval90: 0.90,
  interval95: 0.95,
} as const;

interface CandidateCoverage {
  multiplier: number;
  samples: number;
  skippedWindows: number;
  interval80: number;
  interval90: number;
  interval95: number;
  score: number;
}

interface CalibrationPoint {
  actual: number;
  median: number;
  baseSigma: number;
}

function main(): void {
  const ohlcv = btcHistory as OHLCVData[];
  console.log('Power-law interval calibration');
  console.log(`Dataset: ${ohlcv[0].date} to ${ohlcv[ohlcv.length - 1].date} (${ohlcv.length} rows)`);
  console.log(`Holdout start: ${BACKTEST_CONFIG.holdoutStartDate}`);
  console.log('');
  console.log('| Horizon | Multiplier | Samples | Skipped | 80% cov | 90% cov | 95% cov | Score |');
  console.log('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');

  const bestRows = FIT_HORIZONS.map(horizon => fitHorizon(ohlcv, horizon));
  for (const row of bestRows) {
    console.log([
      `| ${row.horizonDays}d`,
      row.multiplier.toFixed(2),
      row.samples,
      row.skippedWindows,
      formatPercent(row.interval80),
      formatPercent(row.interval90),
      formatPercent(row.interval95),
      row.score.toFixed(4),
      '|',
    ].join(' | '));
  }

  console.log('');
  console.log('Suggested fittedMultipliers config:');
  console.log('[');
  for (const row of bestRows) {
    const status = row.horizonDays >= 180 ? 'scenario' : row.interval90 > 0.95 || row.interval95 > 0.98 ? 'conservative' : 'calibrated';
    const label = status === 'scenario' ? 'Scenario range' : status === 'conservative' ? 'Conservative' : 'Calibrated';
    console.log(`  { horizonDays: ${row.horizonDays}, multiplier: ${row.multiplier.toFixed(2)}, coverageStatus: '${status}', label: '${label}' },`);
  }
  console.log(']');
}

function fitHorizon(ohlcv: OHLCVData[], horizonDays: number): CandidateCoverage & { horizonDays: number } {
  const { points, skippedWindows } = buildCalibrationPoints(ohlcv, horizonDays);
  let best: CandidateCoverage | null = null;
  for (let multiplier = 0.2; multiplier <= 4; multiplier += 0.01) {
    const coverage = evaluateCoverage(points, skippedWindows, Number(multiplier.toFixed(2)));
    if (!best || coverage.score < best.score) best = coverage;
  }
  if (!best) throw new Error(`No candidate coverage for ${horizonDays}d`);
  return { horizonDays, ...best };
}

function buildCalibrationPoints(ohlcv: OHLCVData[], horizonDays: number): { points: CalibrationPoint[]; skippedWindows: number } {
  const points: CalibrationPoint[] = [];
  let skippedWindows = 0;

  for (
    let originIndex = BACKTEST_CONFIG.minimumLookbackDays;
    originIndex + horizonDays < ohlcv.length;
    originIndex += BACKTEST_CONFIG.rollingOriginSpacingDays
  ) {
    const origin = ohlcv[originIndex];
    if (origin.date < BACKTEST_CONFIG.holdoutStartDate) continue;
    if (!isContiguous(ohlcv, originIndex, horizonDays)) {
      skippedWindows++;
      continue;
    }

    const target = ohlcv[originIndex + horizonDays];
    const median = powerLawForecast(parseDate(target.date), origin.close, parseDate(origin.date));
    const historyAtOrigin = ohlcv.slice(0, originIndex + 1);
    const baseSigma = Math.sqrt(powerLawResidualVariance(horizonDays, blendedPowerLawHeatmapVol(historyAtOrigin)));
    points.push({ actual: target.close, median, baseSigma });
  }

  return { points, skippedWindows };
}

function evaluateCoverage(points: CalibrationPoint[], skippedWindows: number, multiplier: number): CandidateCoverage {
  let covered80 = 0;
  let covered90 = 0;
  let covered95 = 0;

  for (const point of points) {
    const sigma = multiplier * point.baseSigma;
    const q10 = point.median * Math.exp(sigma * normalQuantile(0.10));
    const q90 = point.median * Math.exp(sigma * normalQuantile(0.90));
    const q05 = point.median * Math.exp(sigma * normalQuantile(0.05));
    const q95 = point.median * Math.exp(sigma * normalQuantile(0.95));
    const q025 = point.median * Math.exp(sigma * normalQuantile(0.025));
    const q975 = point.median * Math.exp(sigma * normalQuantile(0.975));

    if (point.actual >= q10 && point.actual <= q90) covered80++;
    if (point.actual >= q05 && point.actual <= q95) covered90++;
    if (point.actual >= q025 && point.actual <= q975) covered95++;
  }

  const samples = points.length;
  const interval80 = covered80 / samples;
  const interval90 = covered90 / samples;
  const interval95 = covered95 / samples;
  const score =
    Math.abs(interval80 - TARGETS.interval80) +
    Math.abs(interval90 - TARGETS.interval90) +
    Math.abs(interval95 - TARGETS.interval95);

  return {
    multiplier,
    samples,
    skippedWindows,
    interval80,
    interval90,
    interval95,
    score,
  };
}

function isContiguous(data: OHLCVData[], start: number, horizon: number): boolean {
  for (let step = 0; step < horizon; step++) {
    const current = parseDate(data[start + step].date);
    const next = parseDate(data[start + step + 1].date);
    if ((next.getTime() - current.getTime()) / 86400000 !== 1) return false;
  }
  return true;
}

function parseDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

main();
