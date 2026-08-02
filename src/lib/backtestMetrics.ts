import { crpsFromQuantiles, pitHistogram, pitUniformityStatistic, pitValue, winklerScore, type PitHistogram, type PitUniformityStatistic } from './properScoring';
import type { PredictiveDistribution } from './predictiveDistribution';

export interface ForecastDistribution {
  median: number;
  sigma?: number | null;
  distribution?: PredictiveDistribution;
  quantiles?: Partial<Record<'q025' | 'q05' | 'q10' | 'q50' | 'q90' | 'q95' | 'q975', number>>;
}

export interface MetricInput {
  actual: number;
  forecast: ForecastDistribution;
}

export interface BacktestMetricRow {
  pinballScale: 'absolute';
  samples: number;
  medianAbsLogError: number | null;
  approximateMultiplicativeError: number | null;
  meanAbsLogError: number | null;
  biasLogError: number | null;
  nll: number | null;
  pinballLoss: {
    q05: number | null;
    q10: number | null;
    q50: number | null;
    q90: number | null;
    q95: number | null;
  };
  coverage: {
    interval80: number | null;
    interval90: number | null;
    interval95: number | null;
  };
  intervalWidthRatio: {
    interval80: number | null;
    interval90: number | null;
    interval95: number | null;
  };
  crps: number | null;
  winkler80: number | null;
  winkler90: number | null;
  winkler95: number | null;
  pitHistogram: PitHistogram | null;
  pitUniformity: PitUniformityStatistic | null;
  excludedFromPit: number;
}

const QUANTILES = [
  ['q05', 0.05],
  ['q10', 0.10],
  ['q50', 0.50],
  ['q90', 0.90],
  ['q95', 0.95],
] as const;

export function pinballLoss(actual: number, predicted: number, quantile: number): number {
  const error = actual - predicted;
  return Math.max(quantile * error, (quantile - 1) * error);
}

export function pinballLosses(actual: number, predictions: Record<number, number>): Record<number, number> {
  return Object.fromEntries(
    Object.entries(predictions).map(([quantile, predicted]) => {
      const q = Number(quantile);
      return [q, pinballLoss(actual, predicted, q)];
    })
  );
}

export function intervalCoverage(actual: number, low: number, high: number): boolean {
  return actual >= low && actual <= high;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalNll(actualLogPrice: number, medianLogPrice: number, sigma: number | null): number | null {
  if (!Number.isFinite(sigma) || sigma <= 0) return null;
  const variance = sigma * sigma;
  return 0.5 * Math.log(2 * Math.PI * variance) + ((actualLogPrice - medianLogPrice) ** 2) / (2 * variance);
}

export function aggregateForecastMetrics(inputs: MetricInput[]): BacktestMetricRow {
  const logErrors = inputs
    .filter(({ actual, forecast }) => Number.isFinite(actual) && actual > 0 && Number.isFinite(forecast.median) && forecast.median > 0)
    .map(({ actual, forecast }) => Math.log(forecast.median / actual))
    .filter(Number.isFinite);
  const absLogErrors = logErrors.map(Math.abs);
  const medianAbs = median(absLogErrors);
  const nlls = inputs
    .map(({ actual, forecast }) => Number.isFinite(actual) && actual > 0 && Number.isFinite(forecast.median) && forecast.median > 0
      ? normalNll(Math.log(actual), Math.log(forecast.median), forecast.sigma ?? null)
      : null)
    .filter((value): value is number => value !== null && Number.isFinite(value));

  const pinball = Object.fromEntries(
    QUANTILES.map(([key, quantile]) => {
      const losses = inputs
        .map(({ actual, forecast }) => {
          const predicted = key === 'q50' ? forecast.median : forecast.quantiles?.[key];
          return Number.isFinite(predicted) ? pinballLoss(actual, predicted, quantile) : null;
        })
        .filter((value): value is number => value !== null && Number.isFinite(value));
      return [key, mean(losses)];
    })
  ) as BacktestMetricRow['pinballLoss'];

  const coverage = {
    interval80: coverageRate(inputs, 'q10', 'q90'),
    interval90: coverageRate(inputs, 'q05', 'q95'),
    interval95: coverageRate(inputs, 'q025', 'q975'),
  };
  const intervalWidthRatio = {
    interval80: intervalWidthRatioMean(inputs, 'q10', 'q90'),
    interval90: intervalWidthRatioMean(inputs, 'q05', 'q95'),
    interval95: intervalWidthRatioMean(inputs, 'q025', 'q975'),
  };
  const crpsValues = inputs
    .map(({ actual, forecast }) => crpsFromQuantiles(actual, quantileSet(forecast)))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const winklerValues = {
    interval80: inputs.map(({ actual, forecast }) => winklerScore(actual, forecast.quantiles?.q10 ?? Number.NaN, forecast.quantiles?.q90 ?? Number.NaN, 0.2)),
    interval90: inputs.map(({ actual, forecast }) => winklerScore(actual, forecast.quantiles?.q05 ?? Number.NaN, forecast.quantiles?.q95 ?? Number.NaN, 0.1)),
    interval95: inputs.map(({ actual, forecast }) => winklerScore(actual, forecast.quantiles?.q025 ?? Number.NaN, forecast.quantiles?.q975 ?? Number.NaN, 0.05)),
  };
  const pitValues = inputs
    .map(({ actual, forecast }) => pitValue(actual, forecast.median, forecast.sigma, forecast.distribution))
    .filter((value): value is number => value !== null && Number.isFinite(value));

  return {
    pinballScale: 'absolute',
    samples: inputs.length,
    medianAbsLogError: medianAbs,
    approximateMultiplicativeError: medianAbs === null ? null : Math.exp(medianAbs) - 1,
    meanAbsLogError: mean(absLogErrors),
    biasLogError: mean(logErrors),
    nll: mean(nlls),
    pinballLoss: pinball,
    coverage,
    intervalWidthRatio,
    crps: mean(crpsValues),
    winkler80: mean(winklerValues.interval80.filter((value): value is number => value !== null && Number.isFinite(value))),
    winkler90: mean(winklerValues.interval90.filter((value): value is number => value !== null && Number.isFinite(value))),
    winkler95: mean(winklerValues.interval95.filter((value): value is number => value !== null && Number.isFinite(value))),
    pitHistogram: pitHistogram(pitValues),
    pitUniformity: pitUniformityStatistic(pitValues),
    excludedFromPit: inputs.length - pitValues.length,
  };
}

function quantileSet(forecast: ForecastDistribution): Record<string, number | null | undefined> {
  const q50 = forecast.quantiles?.q50;
  return {
    q025: forecast.quantiles?.q025,
    q05: forecast.quantiles?.q05,
    q10: forecast.quantiles?.q10,
    q50: Number.isFinite(q50) ? q50 : forecast.median,
    q90: forecast.quantiles?.q90,
    q95: forecast.quantiles?.q95,
    q975: forecast.quantiles?.q975,
  };
}

function coverageRate(
  inputs: MetricInput[],
  lowKey: 'q025' | 'q05' | 'q10',
  highKey: 'q90' | 'q95' | 'q975'
): number | null {
  const covered = inputs
    .map(({ actual, forecast }) => {
      const low = forecast.quantiles?.[lowKey];
      const high = forecast.quantiles?.[highKey];
      return Number.isFinite(low) && Number.isFinite(high) ? intervalCoverage(actual, low, high) : null;
    })
    .filter((value): value is boolean => value !== null);

  if (covered.length === 0) return null;
  return covered.filter(Boolean).length / covered.length;
}

function intervalWidthRatioMean(
  inputs: MetricInput[],
  lowKey: 'q025' | 'q05' | 'q10',
  highKey: 'q90' | 'q95' | 'q975'
): number | null {
  const widths = inputs
    .map(({ forecast }) => {
      const low = forecast.quantiles?.[lowKey];
      const high = forecast.quantiles?.[highKey];
      return Number.isFinite(low) && Number.isFinite(high) && Number.isFinite(forecast.median) && forecast.median > 0
        ? (high - low) / forecast.median
        : null;
    })
    .filter((value): value is number => value !== null && Number.isFinite(value));

  return mean(widths);
}
