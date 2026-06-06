import type { OHLCVData } from './api';
import { BACKTEST_CONFIG, POWER_LAW_CONFIG } from './modelConfig';
import { daysSinceGenesis, powerLawForecast } from './powerLaw';

export type StabilityVerdict = 'stable' | 'watch' | 'unstable';

export interface PowerLawFitCoefficients {
  coefficient: number;
  exponent: number;
  sinAmplitude: number;
  cosAmplitude: number;
  cycleDays: number;
}

export interface PowerLawFitWindow {
  originDate: string;
  firstTrainingDate: string;
  lastTrainingDate: string;
  trainingRows: number;
  mode: 'expanding' | 'rolling';
  coefficients: PowerLawFitCoefficients;
  residual: {
    mean: number;
    standardDeviation: number;
    p05: number;
    p50: number;
    p95: number;
  };
}

export interface CoefficientDistributionSummary {
  mean: number;
  median: number;
  standardDeviation: number;
  p05: number;
  p25: number;
  p75: number;
  p95: number;
  currentValue: number;
  relativeDriftFromCurrent: number;
  maxWindowToWindowDrift: number;
}

export interface PowerLawCoefficientSummary {
  coefficient: CoefficientDistributionSummary;
  exponent: CoefficientDistributionSummary;
  sinAmplitude: CoefficientDistributionSummary;
  cosAmplitude: CoefficientDistributionSummary;
}

export interface StabilityThresholds {
  watchRelativeDrift: number;
  unstableRelativeDrift: number;
  watchWindowJump: number;
  unstableWindowJump: number;
}

export interface StabilityAssessment {
  verdict: StabilityVerdict;
  reasons: string[];
  thresholds: StabilityThresholds;
}

export interface ForecastImpactSummary {
  horizonDays: number;
  currentForecast: number;
  candidateMedianForecast: number;
  candidateP05Forecast: number;
  candidateP95Forecast: number;
  medianRelativeDifference: number;
  p05RelativeDifference: number;
  p95RelativeDifference: number;
}

export interface PowerLawRefitSummary {
  fitWindows: PowerLawFitWindow[];
  coefficientSummary: PowerLawCoefficientSummary;
  stabilityVerdict: StabilityAssessment;
  suggestedConfig: PowerLawFitCoefficients;
}

const DEFAULT_THRESHOLDS: StabilityThresholds = {
  watchRelativeDrift: 0.12,
  unstableRelativeDrift: 0.25,
  watchWindowJump: 0.08,
  unstableWindowJump: 0.18,
};

const MIN_TRAINING_DAYS = 1460;
const ROLLING_WINDOW_DAYS = 1460 * 3;
const SAMPLE_SPACING_DAYS = 30;

export function buildPowerLawRefitSummary(
  ohlcv: OHLCVData[],
  thresholds: StabilityThresholds = DEFAULT_THRESHOLDS
): PowerLawRefitSummary {
  const fitWindows = buildFitWindows(ohlcv);
  const coefficientSummary = summarizeCoefficientDistributions(fitWindows);
  const stabilityVerdict = assessCoefficientStability(coefficientSummary, thresholds);
  const suggestedConfig = buildCandidateConfig(coefficientSummary);
  return { fitWindows, coefficientSummary, stabilityVerdict, suggestedConfig };
}

export function buildFitWindows(ohlcv: OHLCVData[]): PowerLawFitWindow[] {
  const holdoutIndex = ohlcv.findIndex(row => row.date >= BACKTEST_CONFIG.holdoutStartDate);
  if (holdoutIndex < 0) return [];

  const windows: PowerLawFitWindow[] = [];
  for (let originIndex = holdoutIndex; originIndex < ohlcv.length - 1; originIndex += SAMPLE_SPACING_DAYS) {
    const expanding = fitWindow(ohlcv.slice(0, originIndex), ohlcv[originIndex].date, 'expanding');
    if (expanding) windows.push(expanding);

    const rollingStart = Math.max(0, originIndex - ROLLING_WINDOW_DAYS);
    const rollingTraining = ohlcv.slice(rollingStart, originIndex);
    const rolling = fitWindow(rollingTraining, ohlcv[originIndex].date, 'rolling');
    if (rolling) windows.push(rolling);
  }
  return windows;
}

export function fitPowerLawCoefficients(trainingRows: OHLCVData[]): PowerLawFitCoefficients | null {
  const rows = trainingRows.filter(row => row.close > 0 && daysSinceGenesis(parseDate(row.date)) > 0);
  if (rows.length < MIN_TRAINING_DAYS) return null;

  const omega = (2 * Math.PI) / POWER_LAW_CONFIG.base.cycleDays;
  const x = rows.map(row => {
    const t = daysSinceGenesis(parseDate(row.date));
    return [1, Math.log(t), Math.sin(omega * t), Math.cos(omega * t)];
  });
  const y = rows.map(row => Math.log(row.close));
  const beta = solveLeastSquares(x, y);
  if (!beta) return null;

  return {
    coefficient: Math.exp(beta[0]),
    exponent: beta[1],
    sinAmplitude: beta[2],
    cosAmplitude: beta[3],
    cycleDays: POWER_LAW_CONFIG.base.cycleDays,
  };
}

export function forecastWithPowerLawCoefficients(
  coefficients: PowerLawFitCoefficients,
  dateFuture: Date,
  currentPrice: number,
  currentDate: Date
): number {
  const tNow = daysSinceGenesis(currentDate);
  const tFut = daysSinceGenesis(dateFuture);
  const hDays = Math.round((dateFuture.getTime() - currentDate.getTime()) / 86400000);
  const currentBase = fittedBasePowerLawPrice(coefficients, tNow);
  const futureBase = fittedBasePowerLawPrice(coefficients, tFut);
  const residual = Math.log(currentPrice) - Math.log(currentBase);
  return futureBase * Math.exp(residual * Math.exp(-hDays / POWER_LAW_CONFIG.meanReversionTauDays));
}

export function buildForecastImpactSummary(
  ohlcv: OHLCVData[],
  fitWindows: PowerLawFitWindow[],
  horizons: number[] = [180, 365]
): ForecastImpactSummary[] {
  const last = ohlcv[ohlcv.length - 1];
  const currentDate = parseDate(last.date);
  const expandingFits = fitWindows
    .filter(window => window.mode === 'expanding')
    .map(window => window.coefficients);

  return horizons.map(horizonDays => {
    const targetDate = addUtcDays(currentDate, horizonDays);
    const currentForecast = powerLawForecast(targetDate, last.close, currentDate);
    const candidateForecasts = expandingFits
      .map(coefficients => forecastWithPowerLawCoefficients(coefficients, targetDate, last.close, currentDate))
      .filter(value => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);
    const candidateMedianForecast = percentile(candidateForecasts, 0.5);
    const candidateP05Forecast = percentile(candidateForecasts, 0.05);
    const candidateP95Forecast = percentile(candidateForecasts, 0.95);
    return {
      horizonDays,
      currentForecast,
      candidateMedianForecast,
      candidateP05Forecast,
      candidateP95Forecast,
      medianRelativeDifference: relativeDifference(candidateMedianForecast, currentForecast),
      p05RelativeDifference: relativeDifference(candidateP05Forecast, currentForecast),
      p95RelativeDifference: relativeDifference(candidateP95Forecast, currentForecast),
    };
  });
}

export function summarizeCoefficientDistributions(fitWindows: PowerLawFitWindow[]): PowerLawCoefficientSummary {
  return {
    coefficient: summarizeSeries(
      fitWindows.map(window => window.coefficients.coefficient),
      POWER_LAW_CONFIG.base.coefficient
    ),
    exponent: summarizeSeries(
      fitWindows.map(window => window.coefficients.exponent),
      POWER_LAW_CONFIG.base.exponent
    ),
    sinAmplitude: summarizeSeries(
      fitWindows.map(window => window.coefficients.sinAmplitude),
      POWER_LAW_CONFIG.base.sinAmplitude
    ),
    cosAmplitude: summarizeSeries(
      fitWindows.map(window => window.coefficients.cosAmplitude),
      POWER_LAW_CONFIG.base.cosAmplitude
    ),
  };
}

export function assessCoefficientStability(
  summary: PowerLawCoefficientSummary,
  thresholds: StabilityThresholds = DEFAULT_THRESHOLDS
): StabilityAssessment {
  const reasons: string[] = [];
  let verdict: StabilityVerdict = 'stable';

  for (const [name, stats] of Object.entries(summary) as [keyof PowerLawCoefficientSummary, CoefficientDistributionSummary][]) {
    const drift = Math.abs(stats.relativeDriftFromCurrent);
    const jump = Math.abs(stats.maxWindowToWindowDrift);
    if (drift > thresholds.unstableRelativeDrift || jump > thresholds.unstableWindowJump) {
      verdict = 'unstable';
      reasons.push(`${name} exceeded unstable threshold: drift ${formatRatio(drift)}, max jump ${formatRatio(jump)}`);
    } else if (drift > thresholds.watchRelativeDrift || jump > thresholds.watchWindowJump) {
      if (verdict !== 'unstable') verdict = 'watch';
      reasons.push(`${name} entered watch range: drift ${formatRatio(drift)}, max jump ${formatRatio(jump)}`);
    }
  }

  if (reasons.length === 0) {
    reasons.push('All fitted base coefficients stayed within configured drift and jump thresholds.');
  }
  return { verdict, reasons, thresholds };
}

export function buildCandidateConfig(summary: PowerLawCoefficientSummary): PowerLawFitCoefficients {
  return {
    coefficient: summary.coefficient.median,
    exponent: summary.exponent.median,
    sinAmplitude: summary.sinAmplitude.median,
    cosAmplitude: summary.cosAmplitude.median,
    cycleDays: POWER_LAW_CONFIG.base.cycleDays,
  };
}

export function fittedBasePowerLawPrice(coefficients: PowerLawFitCoefficients, t: number): number {
  const omega = (2 * Math.PI) / coefficients.cycleDays;
  const seasonal = 1 + coefficients.sinAmplitude * Math.sin(omega * t) + coefficients.cosAmplitude * Math.cos(omega * t);
  return coefficients.coefficient * Math.pow(t, coefficients.exponent) * Math.max(0.05, seasonal);
}

function fitWindow(trainingRows: OHLCVData[], originDate: string, mode: PowerLawFitWindow['mode']): PowerLawFitWindow | null {
  const coefficients = fitPowerLawCoefficients(trainingRows);
  if (!coefficients) return null;
  const residuals = trainingRows
    .map(row => {
      const t = daysSinceGenesis(parseDate(row.date));
      const fitted = fittedBasePowerLawPrice(coefficients, t);
      return fitted > 0 ? Math.log(row.close / fitted) : Number.NaN;
    })
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  return {
    originDate,
    firstTrainingDate: trainingRows[0]?.date ?? '',
    lastTrainingDate: trainingRows[trainingRows.length - 1]?.date ?? '',
    trainingRows: trainingRows.length,
    mode,
    coefficients,
    residual: {
      mean: mean(residuals),
      standardDeviation: standardDeviation(residuals),
      p05: percentile(residuals, 0.05),
      p50: percentile(residuals, 0.5),
      p95: percentile(residuals, 0.95),
    },
  };
}

function summarizeSeries(values: number[], currentValue: number): CoefficientDistributionSummary {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const median = percentile(sorted, 0.5);
  return {
    mean: mean(sorted),
    median,
    standardDeviation: standardDeviation(sorted),
    p05: percentile(sorted, 0.05),
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
    p95: percentile(sorted, 0.95),
    currentValue,
    relativeDriftFromCurrent: relativeDifference(median, currentValue),
    maxWindowToWindowDrift: maxWindowDrift(values),
  };
}

function solveLeastSquares(x: number[][], y: number[]): number[] | null {
  const cols = x[0]?.length ?? 0;
  if (cols === 0 || x.length !== y.length) return null;
  const xtx = Array.from({ length: cols }, () => Array.from({ length: cols }, () => 0));
  const xty = Array.from({ length: cols }, () => 0);

  for (let row = 0; row < x.length; row++) {
    for (let i = 0; i < cols; i++) {
      xty[i] += x[row][i] * y[row];
      for (let j = 0; j < cols; j++) xtx[i][j] += x[row][i] * x[row][j];
    }
  }
  return solveLinearSystem(xtx, xty);
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivot][col])) pivot = row;
    }
    if (Math.abs(augmented[pivot][col]) < 1e-12) return null;
    [augmented[col], augmented[pivot]] = [augmented[pivot], augmented[col]];

    const divisor = augmented[col][col];
    for (let j = col; j <= n; j++) augmented[col][j] /= divisor;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = augmented[row][col];
      for (let j = col; j <= n; j++) augmented[row][j] -= factor * augmented[col][j];
    }
  }

  return augmented.map(row => row[n]);
}

function maxWindowDrift(values: number[]): number {
  let maxDrift = 0;
  for (let i = 1; i < values.length; i++) {
    const previous = values[i - 1];
    const current = values[i];
    if (!Number.isFinite(previous) || !Number.isFinite(current)) continue;
    maxDrift = Math.max(maxDrift, Math.abs(relativeDifference(current, previous)));
  }
  return maxDrift;
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return Number.NaN;
  const index = (sortedValues.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (index - lower);
}

function mean(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1));
}

function relativeDifference(value: number, reference: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(reference) || reference === 0) return Number.NaN;
  return (value - reference) / Math.abs(reference);
}

function formatRatio(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function parseDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
