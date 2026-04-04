import btcHistory from '../src/data/btc-history.json';
import type { OHLCVData } from '../src/lib/api';
import { daysSinceGenesis, POWER_LAW_MEAN_REVERSION_TAU_DAYS, powerLawForecast } from '../src/lib/powerLaw';

interface ModelConfig {
  name: string;
  recentVolWeight: number;
  driftScale: number;
  recursive: boolean;
}

const HOLDOUT_START = '2022-01-01';
const HORIZONS = [14, 30, 60, 90] as const;
const RECENT_LOOKBACK = 90;
const STRUCTURAL_LOOKBACK = 365;

const MODELS: ModelConfig[] = [
  {
    name: 'baseline-fixed-90d',
    recentVolWeight: 1,
    driftScale: 0.5,
    recursive: false,
  },
  {
    name: 'calibrated-recursive',
    recentVolWeight: 0.55,
    driftScale: 0.3,
    recursive: true,
  },
];

function contiguousDays(data: OHLCVData[], start: number, horizon: number): boolean {
  for (let step = 0; step < horizon; step++) {
    const current = new Date(data[start + step].date + 'T00:00:00Z');
    const next = new Date(data[start + step + 1].date + 'T00:00:00Z');
    if ((next.getTime() - current.getTime()) / 86400000 !== 1) return false;
  }
  return true;
}

function computeLogReturnVol(ohlcv: OHLCVData[], endIndex: number, lookback: number) {
  const start = Math.max(0, endIndex - lookback);
  const recent = ohlcv.slice(start, endIndex + 1);
  const logReturns = recent.slice(1).map((point, index) => Math.log(point.close / recent[index].close));
  const mean = logReturns.reduce((sum, value) => sum + value, 0) / logReturns.length;
  const variance = logReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / logReturns.length;
  return Math.sqrt(variance);
}

function blendedVol(ohlcv: OHLCVData[], endIndex: number, recentWeight: number) {
  const recentVol = computeLogReturnVol(ohlcv, endIndex, RECENT_LOOKBACK);
  const structuralVol = computeLogReturnVol(ohlcv, endIndex, STRUCTURAL_LOOKBACK);
  return Math.sqrt(
    recentWeight * recentVol * recentVol +
    (1 - recentWeight) * structuralVol * structuralVol
  );
}

function sumPowers(base: number, count: number, square = false) {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += Math.pow(base, square ? 2 * i : i);
  return sum;
}

function normalNll(value: number, mean: number, variance: number) {
  return 0.5 * Math.log(2 * Math.PI * variance) + ((value - mean) ** 2) / (2 * variance);
}

function evaluateModel(ohlcv: OHLCVData[], config: ModelConfig) {
  const residualDecay = Math.exp(-1 / POWER_LAW_MEAN_REVERSION_TAU_DAYS);

  console.log(`\nModel: ${config.name}`);

  for (const horizon of HORIZONS) {
    const decayMean = config.recursive ? sumPowers(residualDecay, horizon) : horizon;
    const decayVariance = config.recursive ? sumPowers(residualDecay, horizon, true) : horizon;

    const nlls: number[] = [];
    const modeErrors: number[] = [];

    for (let start = STRUCTURAL_LOOKBACK; start + horizon < ohlcv.length; start++) {
      const current = ohlcv[start];
      if (current.date < HOLDOUT_START || !contiguousDays(ohlcv, start, horizon)) continue;

      const sigma = blendedVol(ohlcv, start, config.recentVolWeight);
      const target = ohlcv[start + horizon];
      const currentDate = new Date(current.date + 'T00:00:00Z');
      const targetDate = new Date(target.date + 'T00:00:00Z');
      const forecast = powerLawForecast(targetDate, current.close, currentDate);

      const mean = -config.driftScale * sigma * sigma * decayMean;
      const variance = sigma * sigma * decayVariance;
      const realizedError = Math.log(target.close / forecast);

      nlls.push(normalNll(realizedError, mean, variance));

      const mode = forecast * Math.exp(mean - variance);
      modeErrors.push(Math.abs(Math.log(mode / target.close)));
    }

    const avgNll = nlls.reduce((sum, value) => sum + value, 0) / nlls.length;
    const avgModeError = modeErrors.reduce((sum, value) => sum + value, 0) / modeErrors.length;

    console.log(
      [
        `${String(horizon).padStart(3)}d`,
        `avgNLL=${avgNll.toFixed(4)}`,
        `modeMAE=${avgModeError.toFixed(4)}`,
      ].join('  ')
    );
  }
}

function printContext(ohlcv: OHLCVData[]) {
  const last = ohlcv[ohlcv.length - 1];
  const t = daysSinceGenesis(new Date(last.date + 'T00:00:00Z'));

  console.log('Heatmap holdout benchmark');
  console.log(
    [
      `samples=${ohlcv.length}`,
      `holdoutStart=${HOLDOUT_START}`,
      `lastDate=${last.date}`,
      `daysSinceGenesis=${t}`,
    ].join('  ')
  );
}

function main() {
  const ohlcv = btcHistory as OHLCVData[];
  printContext(ohlcv);
  for (const model of MODELS) evaluateModel(ohlcv, model);
}

main();
