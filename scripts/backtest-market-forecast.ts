import vooHistory from '../src/data/voo-history.json';
import gldHistory from '../src/data/gld-history.json';
import type { OHLCVData } from '../src/lib/api';
import {
  computeGoldChannelBounds,
  computeGoldModelInputs,
  computeSP500ChannelBounds,
  computeSP500ModelInputs,
  GOLD_CHANNEL_CONFIG,
  GOLD_MOMENTUM_CONFIG,
  SP500_CHANNEL_CONFIG,
} from '../src/lib/marketForecast';

const HORIZONS = [30, 90, 180];
const MIN_TRAINING_ROWS = 1000;
const STEP_ROWS = 5;
const SIGNIFICANCE_ALPHA = 0.05;

interface HorizonResult {
  horizon: number;
  samples: number;
  hitRate: number;
  directionPValue: number;
  meanAbsoluteLogError: number;
  baselineMeanAbsoluteLogError: number;
  maeImprovementPct: number;
  pairedT: number;
  pairedPValue: number;
  coverage90: number;
  pass: boolean;
}

interface ChannelResult {
  samples: number;
  coverage: number;
  belowRate: number;
  aboveRate: number;
  meanLogWidth: number;
  pass: boolean;
}

interface ModelInputs {
  drift: number;
  dailyVol: number;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStandardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const abs = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * abs);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-abs * abs);
  return sign * y;
}

function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function logCombination(n: number, k: number): number {
  let value = 0;
  for (let i = 1; i <= k; i++) value += Math.log((n - i + 1) / i);
  return value;
}

function binomialTwoSidedPValue(successes: number, trials: number): number {
  const observed = Math.max(successes, trials - successes);
  let tail = 0;
  for (let k = observed; k <= trials; k++) {
    tail += Math.exp(logCombination(trials, k) - trials * Math.log(2));
  }
  return Math.min(1, tail * 2);
}

function backtestHorizon(
  rows: OHLCVData[],
  horizon: number,
  computeInputs: (rows: OHLCVData[]) => ModelInputs
): HorizonResult {
  const logErrorDiffs: number[] = [];
  let hits = 0;
  let modelAbsLogError = 0;
  let baselineAbsLogError = 0;
  let coverage90 = 0;
  let samples = 0;

  for (let index = MIN_TRAINING_ROWS; index + horizon < rows.length; index += STEP_ROWS) {
    const trainingRows = rows.slice(0, index + 1);
    const { drift, dailyVol } = computeInputs(trainingRows);
    const current = rows[index].close;
    const actual = rows[index + horizon].close;
    const forecast = current * Math.exp(drift * horizon);
    const actualLogReturn = Math.log(actual / current);
    const forecastLogReturn = Math.log(forecast / current);
    const modelError = Math.abs(Math.log(actual / forecast));
    const baselineError = Math.abs(actualLogReturn);
    const sigma = dailyVol * Math.sqrt(horizon);
    const lower90 = forecast * Math.exp(-1.6448536269514722 * sigma);
    const upper90 = forecast * Math.exp(1.6448536269514722 * sigma);

    if (forecastLogReturn * actualLogReturn > 0) hits++;
    if (actual >= lower90 && actual <= upper90) coverage90++;
    modelAbsLogError += modelError;
    baselineAbsLogError += baselineError;
    logErrorDiffs.push(baselineError - modelError);
    samples++;
  }

  const improvementMean = mean(logErrorDiffs);
  const improvementSd = sampleStandardDeviation(logErrorDiffs);
  const pairedT = improvementSd > 0 ? improvementMean / (improvementSd / Math.sqrt(samples)) : 0;
  const pairedPValue = 2 * (1 - normalCdf(Math.abs(pairedT)));
  const meanAbsoluteLogError = modelAbsLogError / samples;
  const baselineMeanAbsoluteLogError = baselineAbsLogError / samples;
  const directionPValue = binomialTwoSidedPValue(hits, samples);
  const maeImprovementPct = ((baselineMeanAbsoluteLogError - meanAbsoluteLogError) / baselineMeanAbsoluteLogError) * 100;

  return {
    horizon,
    samples,
    hitRate: hits / samples,
    directionPValue,
    meanAbsoluteLogError,
    baselineMeanAbsoluteLogError,
    maeImprovementPct,
    pairedT,
    pairedPValue,
    coverage90: coverage90 / samples,
    pass: maeImprovementPct > 0 && pairedPValue < SIGNIFICANCE_ALPHA && directionPValue < SIGNIFICANCE_ALPHA,
  };
}

function backtestChannel(
  rows: OHLCVData[],
  computeBounds: (rows: OHLCVData[]) => { lower: number | null; upper: number | null }[]
): ChannelResult {
  const bounds = computeBounds(rows);
  let samples = 0;
  let inBand = 0;
  let below = 0;
  let above = 0;
  let logWidth = 0;

  for (let index = MIN_TRAINING_ROWS; index < rows.length; index += STEP_ROWS) {
    const channel = bounds[index];
    if (!channel.lower || !channel.upper || channel.lower <= 0 || channel.upper <= channel.lower) continue;

    const close = rows[index].close;
    if (close >= channel.lower && close <= channel.upper) inBand++;
    else if (close < channel.lower) below++;
    else above++;
    logWidth += Math.log(channel.upper / channel.lower);
    samples++;
  }

  const coverage = inBand / samples;
  const belowRate = below / samples;
  const aboveRate = above / samples;

  return {
    samples,
    coverage,
    belowRate,
    aboveRate,
    meanLogWidth: logWidth / samples,
    pass: (
      coverage >= 0.94 &&
      coverage <= 0.98 &&
      belowRate >= 0.015 &&
      belowRate <= 0.04 &&
      aboveRate <= 0.03
    ),
  };
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function printHorizonResult(label: string, result: HorizonResult): void {
  console.log(
    `[${label} backtest] h=${result.horizon}d samples=${result.samples} hit=${(result.hitRate * 100).toFixed(1)}% p_dir=${result.directionPValue.toExponential(3)} mae=${result.meanAbsoluteLogError.toFixed(5)} baseline=${result.baselineMeanAbsoluteLogError.toFixed(5)} improvement=${result.maeImprovementPct.toFixed(2)}% t=${result.pairedT.toFixed(2)} p_mae=${result.pairedPValue.toExponential(3)} cov90=${(result.coverage90 * 100).toFixed(1)}% ${result.pass ? 'PASS' : 'FAIL'}`
  );
}

function runAssetBacktest({
  label,
  rows,
  computeInputs,
  computeBounds,
  channelConfigLabel,
}: {
  label: string;
  rows: OHLCVData[];
  computeInputs: (rows: OHLCVData[]) => ModelInputs;
  computeBounds: (rows: OHLCVData[]) => { lower: number | null; upper: number | null }[];
  channelConfigLabel: string;
}): boolean {
  const results = HORIZONS.map((horizon) => backtestHorizon(rows, horizon, computeInputs));
  const channel = backtestChannel(rows, computeBounds);
  const latest = rows.at(-1)?.date ?? 'unknown';

  console.log(`[${label} backtest] rows=${rows.length} latest=${latest}`);
  console.log(
    `[${label} channel] ${channelConfigLabel} samples=${channel.samples} coverage=${formatPct(channel.coverage)} below=${formatPct(channel.belowRate)} above=${formatPct(channel.aboveRate)} meanWidth=${formatPct(Math.exp(channel.meanLogWidth) - 1)} ${channel.pass ? 'PASS' : 'FAIL'}`
  );
  for (const result of results) {
    printHorizonResult(label, result);
  }

  if (!channel.pass) {
    console.error(`[${label} backtest] FAIL: statistical channel did not satisfy the walk-forward coverage gate.`);
    return false;
  }

  if (results.some((result) => !result.pass)) {
    console.error(`[${label} backtest] FAIL: model did not prove statistically significant relevance at every configured horizon.`);
    return false;
  }

  console.log(`[${label} backtest] PASS: median-error improvement and directional relevance are statistically significant at every configured horizon.`);
  return true;
}

function main(): void {
  const sp500Rows = vooHistory as OHLCVData[];
  const goldRows = gldHistory as OHLCVData[];
  const sp500Pass = runAssetBacktest({
    label: 'S&P 500',
    rows: sp500Rows,
    computeInputs: computeSP500ModelInputs,
    computeBounds: computeSP500ChannelBounds,
    channelConfigLabel: `trend=${SP500_CHANNEL_CONFIG.trendWindowDays}d residuals=${SP500_CHANNEL_CONFIG.residualLookbackDays}d q=${SP500_CHANNEL_CONFIG.lowerResidualQuantile}-${SP500_CHANNEL_CONFIG.upperResidualQuantile}`,
  });
  const goldPass = runAssetBacktest({
    label: 'Gold',
    rows: goldRows,
    computeInputs: computeGoldModelInputs,
    computeBounds: computeGoldChannelBounds,
    channelConfigLabel: `momentum=${GOLD_MOMENTUM_CONFIG.shortMomentumDays}/${GOLD_MOMENTUM_CONFIG.longMomentumDays}d trend=${GOLD_CHANNEL_CONFIG.trendWindowDays}d residuals=${GOLD_CHANNEL_CONFIG.residualLookbackDays}d q=${GOLD_CHANNEL_CONFIG.lowerResidualQuantile}-${GOLD_CHANNEL_CONFIG.upperResidualQuantile}`,
  });

  if (!sp500Pass || !goldPass) {
    process.exitCode = 1;
  }
}

const channelMode = process.argv.includes('--channel-path-baseline')
  ? 'baseline'
  : process.argv.includes('--channel-path-candidates') ? 'candidates' : null;

if (channelMode) {
  const { runMarketChannelPathBacktest } = await import('./backtest-market-channel-path');
  runMarketChannelPathBacktest(channelMode);
} else {
  main();
}
