import type { OHLCVData } from './api';
import { exponentialMovingAverage, simpleMovingAverage, strictCrosses, type CrossDirection } from './trendReversal';

export type TechnicalReversalId =
  | 'rsi14-extreme-exit'
  | 'bollinger20x2-reentry'
  | 'stochastic14x3-extreme-cross'
  | 'macd12x26x9-opposite-zero-cross';

export interface TechnicalReversalSignal {
  id: TechnicalReversalId;
  description: string;
  signal: CrossDirection[];
}

export function wilderRsi(closes: readonly number[], window = 14): Array<number | null> {
  if (!Number.isInteger(window) || window < 1) throw new Error('window must be a positive integer');
  const result: Array<number | null> = Array(closes.length).fill(null);
  if (closes.length <= window) return result;
  let averageGain = 0;
  let averageLoss = 0;
  for (let index = 1; index <= window; index++) {
    const change = closes[index] - closes[index - 1];
    averageGain += Math.max(change, 0) / window;
    averageLoss += Math.max(-change, 0) / window;
  }
  result[window] = rsiFromAverages(averageGain, averageLoss);
  for (let index = window + 1; index < closes.length; index++) {
    const change = closes[index] - closes[index - 1];
    averageGain = ((window - 1) * averageGain + Math.max(change, 0)) / window;
    averageLoss = ((window - 1) * averageLoss + Math.max(-change, 0)) / window;
    result[index] = rsiFromAverages(averageGain, averageLoss);
  }
  return result;
}

export function bollingerBands(closes: readonly number[], window = 20, multiplier = 2): {
  middle: Array<number | null>;
  lower: Array<number | null>;
  upper: Array<number | null>;
} {
  const middle = simpleMovingAverage(closes, window);
  const lower: Array<number | null> = Array(closes.length).fill(null);
  const upper: Array<number | null> = Array(closes.length).fill(null);
  for (let index = window - 1; index < closes.length; index++) {
    const mean = middle[index]!;
    let sumSquares = 0;
    for (let offset = 0; offset < window; offset++) sumSquares += (closes[index - offset] - mean) ** 2;
    const standardDeviation = Math.sqrt(sumSquares / window);
    lower[index] = mean - multiplier * standardDeviation;
    upper[index] = mean + multiplier * standardDeviation;
  }
  return { middle, lower, upper };
}

export function stochasticOscillator(rows: readonly OHLCVData[], window = 14, smooth = 3): {
  k: Array<number | null>;
  d: Array<number | null>;
} {
  const k: Array<number | null> = Array(rows.length).fill(null);
  for (let index = window - 1; index < rows.length; index++) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let offset = 0; offset < window; offset++) {
      highest = Math.max(highest, rows[index - offset].high);
      lowest = Math.min(lowest, rows[index - offset].low);
    }
    if (highest > lowest) k[index] = 100 * (rows[index].close - lowest) / (highest - lowest);
  }
  const d: Array<number | null> = Array(rows.length).fill(null);
  for (let index = window - 1 + smooth - 1; index < rows.length; index++) {
    const values = k.slice(index - smooth + 1, index + 1);
    if (values.every(value => value !== null)) d[index] = values.reduce<number>((sum, value) => sum + value!, 0) / smooth;
  }
  return { k, d };
}

export function macd(closes: readonly number[], fast = 12, slow = 26, signalWindow = 9): {
  line: number[];
  signal: number[];
  histogram: number[];
} {
  const fastEma = exponentialMovingAverage(closes, fast);
  const slowEma = exponentialMovingAverage(closes, slow);
  const line = closes.map((_, index) => fastEma[index] - slowEma[index]);
  const signal = exponentialMovingAverage(line, signalWindow);
  return { line, signal, histogram: line.map((value, index) => value - signal[index]) };
}

export function buildTechnicalReversalSignals(rows: readonly OHLCVData[]): TechnicalReversalSignal[] {
  const closes = rows.map(row => row.close);
  const rsi = wilderRsi(closes, 14);
  const rsiSignal = rsiExtremeExitSignals(rsi);

  const bands = bollingerBands(closes, 20, 2);
  const bollingerSignal = bollingerReentrySignals(closes, bands.lower, bands.upper);

  const stochastic = stochasticOscillator(rows, 14, 3);
  const stochasticSignal = stochasticExtremeCrossSignals(stochastic.k, stochastic.d);

  const macdValues = macd(closes, 12, 26, 9);
  const macdSignal = macdOppositeZeroSignals(macdValues.line, macdValues.histogram);

  return [
    { id: 'rsi14-extreme-exit', description: 'Wilder RSI(14) exits the canonical 30/70 extreme zone.', signal: rsiSignal },
    { id: 'bollinger20x2-reentry', description: 'Close re-enters canonical SMA20 +/- 2 population-standard-deviation bands.', signal: bollingerSignal },
    { id: 'stochastic14x3-extreme-cross', description: 'Stochastic K/D cross while both lines remain in the canonical 20/80 extreme zone.', signal: stochasticSignal },
    { id: 'macd12x26x9-opposite-zero-cross', description: 'MACD histogram crosses zero while the MACD line remains on the opposite side of zero.', signal: macdSignal },
  ];
}

export function rsiExtremeExitSignals(rsi: readonly (number | null)[]): CrossDirection[] {
  const signal: CrossDirection[] = Array(rsi.length).fill(0);
  for (let index = 1; index < rsi.length; index++) {
    if (rsi[index - 1] === null || rsi[index] === null) continue;
    if (rsi[index - 1]! <= 30 && rsi[index]! > 30) signal[index] = 1;
    else if (rsi[index - 1]! >= 70 && rsi[index]! < 70) signal[index] = -1;
  }
  return signal;
}

export function bollingerReentrySignals(closes: readonly number[], lower: readonly (number | null)[], upper: readonly (number | null)[]): CrossDirection[] {
  const signal: CrossDirection[] = Array(closes.length).fill(0);
  for (let index = 1; index < closes.length; index++) {
    if (lower[index - 1] === null || lower[index] === null || upper[index - 1] === null || upper[index] === null) continue;
    if (closes[index - 1] < lower[index - 1]! && closes[index] >= lower[index]!) signal[index] = 1;
    else if (closes[index - 1] > upper[index - 1]! && closes[index] <= upper[index]!) signal[index] = -1;
  }
  return signal;
}

export function stochasticExtremeCrossSignals(k: readonly (number | null)[], d: readonly (number | null)[]): CrossDirection[] {
  const crosses = strictCrosses(k, d);
  return crosses.map((direction, index): CrossDirection => {
    if (k[index] === null || d[index] === null) return 0;
    if (direction === 1 && k[index]! <= 20 && d[index]! <= 20) return 1;
    if (direction === -1 && k[index]! >= 80 && d[index]! >= 80) return -1;
    return 0;
  });
}

export function macdOppositeZeroSignals(line: readonly number[], histogram: readonly number[]): CrossDirection[] {
  const crosses = strictCrosses(histogram, Array(histogram.length).fill(0));
  return crosses.map((direction, index): CrossDirection => {
    if (direction === 1 && line[index] <= 0) return 1;
    if (direction === -1 && line[index] >= 0) return -1;
    return 0;
  });
}

function rsiFromAverages(averageGain: number, averageLoss: number): number {
  if (averageGain === 0 && averageLoss === 0) return 50;
  if (averageLoss === 0) return 100;
  if (averageGain === 0) return 0;
  return 100 - 100 / (1 + averageGain / averageLoss);
}
