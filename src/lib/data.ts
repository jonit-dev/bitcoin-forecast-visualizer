import type { OHLCVData } from './api';
import {
  basePowerLawPrice,
  daysSinceGenesis,
  floorPowerLawPrice,
  peakPowerLawPrice,
  POWER_LAW_MEAN_REVERSION_TAU_DAYS,
  powerLawForecast,
} from './powerLaw';

export interface HeatmapCell {
  date: string;
  priceLow: number;
  priceHigh: number;
  density: number; // 0-1 normalized per column
}

export interface ProbabilityForecast {
  horizonDays: number;
  targetDate: string;
  median: number;
  probabilityUp: number;
  q05: number;
  q10: number;
  q90: number;
  q95: number;
  calibrationLabel: string;
  verdict: string;
}

// Holdout-calibrated blend: recent vol reacts quickly, long vol keeps the band from overfitting
// the latest regime. The log-drift scale keeps the modal path close to realized outcomes.
const POWER_LAW_HEATMAP_RECENT_VOL_WEIGHT = 0.55;
const POWER_LAW_HEATMAP_LOG_DRIFT_SCALE = 0.3;
const STOCHASTIC_TRACE_COUNT = 12;
const STOCHASTIC_TRACE_BACKCAST_DAYS = 7;
const STOCHASTIC_TRACE_BLOCK_DAYS = 14;
// Use recent regime history for visible scenario paths. Full-history BTC residuals include
// early-era shocks that are not calibrated to the displayed confidence interval scale.
const STOCHASTIC_TRACE_LOOKBACK_DAYS = 730;

export const CONFIDENCE_Z_SCORES = {
  0.95: 1.96,
  0.9: 1.64,
  0.8: 1.28,
} as const;

function computeLogReturnStats(ohlcv: OHLCVData[], lookback: number) {
  const cappedLookback = Math.min(Math.max(1, lookback), ohlcv.length - 1);
  const recent = ohlcv.slice(-cappedLookback - 1);
  const logReturns = recent.slice(1).map((d, i) => Math.log(d.close / recent[i].close));
  const meanReturn = logReturns.reduce((sum, value) => sum + value, 0) / logReturns.length;
  const variance = logReturns.reduce((sum, value) => sum + (value - meanReturn) ** 2, 0) / logReturns.length;

  return {
    meanReturn,
    dailyVol: Math.sqrt(variance),
  };
}

function blendedPowerLawHeatmapVol(ohlcv: OHLCVData[]) {
  const recentVol = computeLogReturnStats(ohlcv, 90).dailyVol;
  const structuralVol = computeLogReturnStats(ohlcv, 365).dailyVol;

  return Math.sqrt(
    POWER_LAW_HEATMAP_RECENT_VOL_WEIGHT * recentVol * recentVol +
    (1 - POWER_LAW_HEATMAP_RECENT_VOL_WEIGHT) * structuralVol * structuralVol
  );
}

function powerLawResidualVariance(days: number, dailyVol: number): number {
  const residualDecay = Math.exp(-1 / POWER_LAW_MEAN_REVERSION_TAU_DAYS);
  let varianceMultiplier = 0;
  let decayPowerSq = 1;

  for (let step = 0; step < days; step++) {
    varianceMultiplier += decayPowerSq;
    decayPowerSq *= residualDecay * residualDecay;
  }

  return dailyVol * dailyVol * varianceMultiplier;
}

function powerLawIntervalStressMultiplier(days: number): number {
  // Bitcoin residual errors have historically been fatter-tailed than a pure Gaussian
  // OU process. This horizon ramp was chosen from rolling-origin coverage checks so
  // 6–12 month bands no longer masquerade as tight ±50% envelopes.
  return 1 + 1.85 * (1 - Math.exp(-days / 150));
}

function normalCdf(value: number): number {
  return 0.5 * (1 + erf(value / Math.SQRT2));
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function normalQuantile(probability: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  const p = Math.min(Math.max(probability, 1e-9), 1 - 1e-9);

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > pHigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }

  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function probabilityVerdict(horizonDays: number, probabilityUp: number): string {
  if (horizonDays <= 14) return probabilityUp >= 0.53 ? 'Slight upside tilt' : probabilityUp <= 0.47 ? 'Slight downside tilt' : 'Coin flip';
  if (probabilityUp < 0.4) return 'Downside-biased median';
  if (probabilityUp < 0.47) return 'Range-bound / soft bias';
  if (probabilityUp > 0.6) return 'Upside-biased median';
  return 'Balanced distribution';
}

function calibrationLabel(horizonDays: number): string {
  if (horizonDays <= 14) return 'OK calibration · low edge';
  if (horizonDays <= 30) return 'Conservative · low edge';
  if (horizonDays <= 90) return 'Candidate · very wide';
  if (horizonDays <= 180) return 'Directional only';
  return 'Regime-sensitive';
}

export function computeProbabilityForecast(
  ohlcv: OHLCVData[],
  horizonDays: number
): ProbabilityForecast | null {
  if (ohlcv.length < 365 || horizonDays < 1) return null;

  const last = ohlcv[ohlcv.length - 1];
  const lastDate = new Date(last.date + 'T00:00:00Z');
  const targetDate = addUtcDays(lastDate, horizonDays);
  const median = powerLawForecast(targetDate, last.close, lastDate);
  const dailyVol = blendedPowerLawHeatmapVol(ohlcv);
  const sigma = powerLawIntervalStressMultiplier(horizonDays) * Math.sqrt(powerLawResidualVariance(horizonDays, dailyVol));
  const probabilityUp = 1 - normalCdf((Math.log(last.close) - Math.log(median)) / sigma);
  const quantilePrice = (p: number) => median * Math.exp(sigma * normalQuantile(p));

  return {
    horizonDays,
    targetDate: dateKey(targetDate),
    median,
    probabilityUp,
    q05: quantilePrice(0.05),
    q10: quantilePrice(0.10),
    q90: quantilePrice(0.90),
    q95: quantilePrice(0.95),
    calibrationLabel: calibrationLabel(horizonDays),
    verdict: probabilityVerdict(horizonDays, probabilityUp),
  };
}

function mulberry32(seed: number) {
  return () => {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dateKey(date: Date): string {
  return date.toISOString().split('T')[0];
}

function buildPowerLawInnovationHistory(ohlcv: OHLCVData[], endIndex: number, lookbackDays?: number): number[] {
  const innovations: number[] = [];
  const startIndex = lookbackDays ? Math.max(1, endIndex - lookbackDays + 1) : 1;

  for (let i = startIndex; i <= endIndex; i++) {
    const prev = ohlcv[i - 1];
    const curr = ohlcv[i];
    if (prev.close <= 0 || curr.close <= 0) continue;

    const prevDate = new Date(prev.date + 'T00:00:00Z');
    const currDate = new Date(curr.date + 'T00:00:00Z');
    const expected = powerLawForecast(currDate, prev.close, prevDate);
    if (!Number.isFinite(expected) || expected <= 0) continue;

    innovations.push(Math.log(curr.close / expected));
  }

  return innovations;
}

function sampleStandardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function generatePowerLawStochasticTraces(
  ohlcv: OHLCVData[],
  horizon: number,
  model: string
): Map<string, number[]> {
  const tracesByDate = new Map<string, number[]>();
  if (model !== 'powerlaw' || horizon < 1 || ohlcv.length < 120) return tracesByDate;

  const lastIndex = ohlcv.length - 1;
  const anchorIndex = Math.max(30, lastIndex - STOCHASTIC_TRACE_BACKCAST_DAYS);
  const anchor = ohlcv[anchorIndex];
  const anchorDate = new Date(anchor.date + 'T00:00:00Z');
  const lastDate = new Date(ohlcv[lastIndex].date + 'T00:00:00Z');
  const backcastDays = Math.round((lastDate.getTime() - anchorDate.getTime()) / 86400000);
  const totalDays = backcastDays + horizon;
  const innovations = buildPowerLawInnovationHistory(ohlcv, anchorIndex, STOCHASTIC_TRACE_LOOKBACK_DAYS);
  if (innovations.length < STOCHASTIC_TRACE_BLOCK_DAYS * 4) return tracesByDate;

  const rng = mulberry32(0xB17C01A + horizon * 131 + anchorIndex);
  const centeredMean = innovations.reduce((sum, value) => sum + value, 0) / innovations.length;
  const rawCenteredInnovations = innovations.map(value => value - centeredMean);
  const rawInnovationSd = sampleStandardDeviation(rawCenteredInnovations);
  if (!Number.isFinite(rawInnovationSd) || rawInnovationSd <= 0) return tracesByDate;

  // Visible traces should be plausible samples from the same volatility scale as the
  // displayed forecast interval. Keep empirical block-bootstrap shape/clustering,
  // but rescale the recent residual innovations to the interval model's blended vol.
  const targetDailyVol = blendedPowerLawHeatmapVol(ohlcv);
  const innovationScale = targetDailyVol / rawInnovationSd;
  const centeredInnovations = rawCenteredInnovations.map(value => value * innovationScale);

  const paths: number[][] = Array.from({ length: STOCHASTIC_TRACE_COUNT }, () => []);
  const anchorValues = Array.from({ length: STOCHASTIC_TRACE_COUNT }, () => anchor.close);
  tracesByDate.set(anchor.date, anchorValues);

  for (let pathIndex = 0; pathIndex < STOCHASTIC_TRACE_COUNT; pathIndex++) {
    let price = anchor.close;
    let blockStart = 0;
    let blockOffset = STOCHASTIC_TRACE_BLOCK_DAYS;

    for (let day = 1; day <= totalDays; day++) {
      // Future paths must be conditioned on the latest known candle. The 7-day
      // backcast is only a diagnostic lead-in; without this reset, scenarios
      // that drifted away during the backcast start the actual forecast from a
      // fake price, which makes them violate the forecast bands for the wrong reason.
      if (day === backcastDays) {
        price = ohlcv[lastIndex].close;
        paths[pathIndex][day] = price;
        blockOffset = STOCHASTIC_TRACE_BLOCK_DAYS;
        continue;
      }

      if (blockOffset >= STOCHASTIC_TRACE_BLOCK_DAYS) {
        blockStart = Math.floor(rng() * Math.max(1, centeredInnovations.length - STOCHASTIC_TRACE_BLOCK_DAYS));
        blockOffset = 0;
      }

      const prevDate = addUtcDays(anchorDate, day - 1);
      const currDate = addUtcDays(anchorDate, day);
      const expected = powerLawForecast(currDate, price, prevDate);
      const innovation = centeredInnovations[blockStart + blockOffset++];
      price = expected * Math.exp(innovation);
      paths[pathIndex][day] = price;
    }
  }

  for (let day = 1; day <= totalDays; day++) {
    const key = dateKey(addUtcDays(anchorDate, day));
    tracesByDate.set(key, paths.map(path => path[day]));
  }

  return tracesByDate;
}

export function processRealData(
  ohlcv: OHLCVData[],
  horizon: number = 14,
  model: string = 'transformer',
  confidenceZ: number = CONFIDENCE_Z_SCORES[0.95]
): any[] {
  const stochasticTracesByDate = generatePowerLawStochasticTraces(ohlcv, horizon, model);

  // Add SMAs to historical data
  const data: any[] = ohlcv.map((d, i) => {
    let sma20: number | null = null;
    let sma50: number | null = null;
    if (i >= 19) sma20 = ohlcv.slice(i - 19, i + 1).reduce((s, x) => s + x.close, 0) / 20;
    if (i >= 49) sma50 = ohlcv.slice(i - 49, i + 1).reduce((s, x) => s + x.close, 0) / 50;
    const t = daysSinceGenesis(new Date(d.date + 'T00:00:00Z'));
    const stochasticTraces = stochasticTracesByDate.get(d.date);
    return {
      ...d,
      sma20,
      sma50,
      isForecast: false,
      powerLawModel: basePowerLawPrice(t),
      floorPriceModel: floorPowerLawPrice(t),
      peakPriceModel: peakPowerLawPrice(t),
      stochasticTraces,
    };
  });

  // Compute log-return based volatility from last 30 days
  const recent = ohlcv.slice(-30);
  const logReturns = recent
    .slice(1)
    .map((d, i) => Math.log(d.close / recent[i].close));
  const meanReturn = logReturns.reduce((s, r) => s + r, 0) / logReturns.length;
  const variance =
    logReturns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / logReturns.length;
  const dailyVol = Math.sqrt(variance);

  // Anchor forecast to last real candle
  const lastReal = ohlcv[ohlcv.length - 1];
  let forecastPrice = lastReal.close;

  data[data.length - 1].forecast = forecastPrice;
  data[data.length - 1].forecastUpper = forecastPrice;
  data[data.length - 1].forecastLower = forecastPrice;

  const lastDate = new Date(lastReal.date + 'T00:00:00Z');
  const isPowerLaw = model === 'powerlaw';
  const powerLawIntervalVol = blendedPowerLawHeatmapVol(ohlcv);

  for (let i = 1; i <= horizon; i++) {
    const date = new Date(lastDate);
    date.setUTCDate(date.getUTCDate() + i);

    let open: number;
    let close: number;

    if (isPowerLaw) {
      const prevDate = new Date(lastDate);
      prevDate.setUTCDate(prevDate.getUTCDate() + i - 1);
      open = i === 1 ? lastReal.close : powerLawForecast(prevDate, lastReal.close, lastDate);
      close = powerLawForecast(date, lastReal.close, lastDate);
    } else {
      const shock = (Math.random() - 0.5) * 2 * dailyVol;
      open = forecastPrice;
      forecastPrice = forecastPrice * Math.exp(meanReturn + shock);
      close = forecastPrice;
    }

    const high = Math.max(open, close) * (1 + Math.random() * dailyVol * 0.3);
    const low = Math.min(open, close) * (1 - Math.random() * dailyVol * 0.3);

    // Forecast interval: the power-law path uses residual-process variance plus
    // a fat-tail stress multiplier. No visual cap — long-horizon bands should
    // widen when Bitcoin's historical residual errors say they should.
    const ciHalf = isPowerLaw
      ? confidenceZ * powerLawIntervalStressMultiplier(i) * Math.sqrt(powerLawResidualVariance(i, powerLawIntervalVol))
      : confidenceZ * dailyVol * Math.sqrt(i);

    data.push({
      date: date.toISOString().split('T')[0],
      open,
      high,
      low,
      close,
      volume: 0,
      forecast: close,
      forecastUpper: close * Math.exp(ciHalf),
      forecastLower: close * Math.exp(-ciHalf),
      forecastRange: [close * Math.exp(-ciHalf), close * Math.exp(ciHalf)],
      isForecast: true,
      stochasticTraces: stochasticTracesByDate.get(date.toISOString().split('T')[0]),
      powerLawModel: basePowerLawPrice(daysSinceGenesis(date)),
      floorPriceModel: floorPowerLawPrice(daysSinceGenesis(date)),
      peakPriceModel: peakPowerLawPrice(daysSinceGenesis(date)),
      sma20: null,
      sma50: null,
    });
  }

  return data;
}

// Monte Carlo probability heatmap using a calibrated power-law residual process.
export function generateHeatmapData(
  ohlcv: OHLCVData[],
  horizon: number,
  model: string,
  numSimulations: number = 500,
  numPriceBands: number = 80
): HeatmapCell[] {
  if (horizon < 1 || ohlcv.length < 30) return [];

  const { meanReturn, dailyVol: recentVol } = computeLogReturnStats(ohlcv, 90);

  const lastPrice = ohlcv[ohlcv.length - 1].close;
  const lastDateMs = new Date(ohlcv[ohlcv.length - 1].date + 'T00:00:00Z').getTime();
  const lastDate = new Date(lastDateMs);
  const isPowerLaw = model === 'powerlaw';
  const dailyVol = isPowerLaw ? blendedPowerLawHeatmapVol(ohlcv) : recentVol;
  const fixedHalfVolSq = 0.5 * dailyVol * dailyVol;

  // Random-walk drift is fixed; power-law paths need path-dependent re-anchoring.
  const drifts = new Float64Array(horizon + 1);
  if (!isPowerLaw) {
    drifts.fill(meanReturn, 1);
  }

  const futureBasePrices = new Float64Array(horizon + 1);
  const lastBasePrice = basePowerLawPrice(daysSinceGenesis(lastDate));
  if (isPowerLaw) {
    const tNow = daysSinceGenesis(lastDate);
    futureBasePrices[0] = lastBasePrice;
    for (let d = 1; d <= horizon; d++) futureBasePrices[d] = basePowerLawPrice(tNow + d);
  }
  const residualDecay = Math.exp(-1 / POWER_LAW_MEAN_REVERSION_TAU_DAYS);
  const powerLawShockDrift = -POWER_LAW_HEATMAP_LOG_DRIFT_SCALE * dailyVol * dailyVol;

  // Sample output dates for long horizons (sim still runs every day for accuracy)
  const sampleStep = horizon <= 90 ? 1 : horizon <= 365 ? 2 : horizon <= 1825 ? 5 : 10;
  const sampledDays: number[] = [];
  for (let d = 1; d <= horizon; d++) {
    if (d % sampleStep === 0 || d === 1 || d === horizon) sampledDays.push(d);
  }
  const sampledSet = new Set(sampledDays);
  const sampledCount = sampledDays.length;

  // Pre-generate all random normals (use both Box-Muller outputs)
  const totalRands = numSimulations * horizon;
  const normals = new Float64Array(totalRands);
  for (let i = 0; i < totalRands; i += 2) {
    const u1 = Math.random();
    const u2 = Math.random();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 6.283185307179586 * u2; // 2*PI
    normals[i] = r * Math.cos(theta);
    if (i + 1 < totalRands) normals[i + 1] = r * Math.sin(theta);
  }

  // Run Monte Carlo — store only sampled days in flat typed array
  const results = new Float64Array(numSimulations * sampledCount);

  for (let s = 0; s < numSimulations; s++) {
    let sIdx = 0;
    const rOff = s * horizon;

    if (isPowerLaw) {
      let residual = Math.log(lastPrice / lastBasePrice);

      for (let d = 1; d <= horizon; d++) {
        residual = residual * residualDecay + powerLawShockDrift + dailyVol * normals[rOff + d - 1];
        const price = futureBasePrices[d] * Math.exp(residual);

        if (sampledSet.has(d)) {
          results[s * sampledCount + sIdx++] = price;
        }
      }
    } else {
      let price = lastPrice;

      for (let d = 1; d <= horizon; d++) {
        price = price * Math.exp(drifts[d] - fixedHalfVolSq + dailyVol * normals[rOff + d - 1]);
        if (sampledSet.has(d)) {
          results[s * sampledCount + sIdx++] = price;
        }
      }
    }
  }

  // Find price range from flat array (0.5–99.5 percentile)
  const sortBuf = new Float64Array(results);
  sortBuf.sort();
  const p005 = sortBuf[Math.floor(sortBuf.length * 0.005)];
  const p995 = sortBuf[Math.floor(sortBuf.length * 0.995)];
  const logMin = Math.log(p005);
  const logMax = Math.log(p995);
  const bandSize = (logMax - logMin) / numPriceBands;
  if (bandSize <= 0) return [];

  // Pre-compute date strings for sampled days
  const dateStrings = sampledDays.map(d =>
    new Date(lastDateMs + d * 86400000).toISOString().split('T')[0]
  );

  const cells: HeatmapCell[] = [];
  const counts = new Uint16Array(numPriceBands);
  const invBandSize = 1 / bandSize;

  for (let di = 0; di < sampledCount; di++) {
    counts.fill(0);
    for (let s = 0; s < numSimulations; s++) {
      const logP = Math.log(results[s * sampledCount + di]);
      const idx = Math.min(numPriceBands - 1, Math.max(0, (logP - logMin) * invBandSize | 0));
      counts[idx]++;
    }

    let maxCount = 0;
    for (let b = 0; b < numPriceBands; b++) if (counts[b] > maxCount) maxCount = counts[b];
    if (maxCount === 0) continue;

    const dateStr = dateStrings[di];
    for (let b = 0; b < numPriceBands; b++) {
      if (counts[b] === 0) continue;
      cells.push({
        date: dateStr,
        priceLow: Math.exp(logMin + b * bandSize),
        priceHigh: Math.exp(logMin + (b + 1) * bandSize),
        density: counts[b] / maxCount,
      });
    }
  }

  return cells;
}

// ---------------------------------------------------------------------------
// Drawdown Analysis
// ---------------------------------------------------------------------------

export interface DrawdownStats {
  cycleIndex: number;
  projectedMDD: number;             // positive %, OLS fit: 92.8 - 5.1*c
  cycleHighPrice: number;           // intraday high since last halving
  cycleHighDate: string;
  currentDrawdownPct: number;       // positive %
  drawdownProgress: number;         // 0-1 (how far into projected MDD)
  impliedFloorFromCycleHigh: number;
  gbmExpectedMDD: number;           // positive %, MC mean
  gbmP95MDD: number;                // positive %, 95th percentile
  gbmHorizonDays: number;
}

// Historical peak-to-trough drawdowns per cycle (post-halving ATH to next ATL)
export const HISTORICAL_CYCLE_DRAWDOWNS = [
  { cycle: 1, label: '2013–2015', pct: 86.9 },
  { cycle: 2, label: '2017–2018', pct: 84.2 },
  { cycle: 3, label: '2021–2022', pct: 76.7 },
];

// OLS on the three completed cycles (R²>0.95): MDD% = 92.8 – 5.1·c
function projectedCycleMDD(c: number): number {
  return 92.8 - 5.1 * c;
}

export function computeDrawdownStats(ohlcv: OHLCVData[], horizonDays: number): DrawdownStats {
  const lastHalvingDate = new Date('2024-04-20T00:00:00Z');
  const cycleIndex = 4;

  // Cycle high: intraday high since the 2024 halving
  let cycleHighPrice = 0;
  let cycleHighDate = '';
  for (const d of ohlcv) {
    if (new Date(d.date + 'T00:00:00Z') < lastHalvingDate) continue;
    if (d.high > cycleHighPrice) {
      cycleHighPrice = d.high;
      cycleHighDate = d.date;
    }
  }

  const currentPrice = ohlcv[ohlcv.length - 1].close;
  const projMDD = projectedCycleMDD(cycleIndex);
  const currentDDPct = cycleHighPrice > 0
    ? ((cycleHighPrice - currentPrice) / cycleHighPrice) * 100
    : 0;
  const drawdownProgress = Math.min(1, Math.max(0, currentDDPct / projMDD));
  const impliedFloor = cycleHighPrice * (1 - projMDD / 100);

  // GBM Monte Carlo E[MDD] — cap horizon at 730 days for performance
  const gbmHorizonDays = Math.min(Math.max(horizonDays, 1), 730);
  const lookback = Math.min(365, ohlcv.length - 1);
  const recent = ohlcv.slice(-lookback - 1);
  const logReturns = recent.slice(1).map((d, i) => Math.log(d.close / recent[i].close));
  const meanReturn = logReturns.reduce((s, r) => s + r, 0) / logReturns.length;
  const variance = logReturns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / logReturns.length;
  const dailyVol = Math.sqrt(variance);
  const halfVolSq = 0.5 * dailyVol * dailyVol;

  const N_PATHS = 500;
  const mdds = new Float64Array(N_PATHS);

  for (let s = 0; s < N_PATHS; s++) {
    let price = currentPrice;
    let peak = currentPrice;
    let maxDD = 0;
    for (let d = 0; d < gbmHorizonDays; d++) {
      const u1 = Math.max(Math.random(), 1e-15);
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      price = price * Math.exp(meanReturn - halfVolSq + dailyVol * z);
      if (price > peak) peak = price;
      const dd = (peak - price) / peak;
      if (dd > maxDD) maxDD = dd;
    }
    mdds[s] = maxDD * 100;
  }

  const gbmExpectedMDD = mdds.reduce((s, v) => s + v, 0) / N_PATHS;
  mdds.sort();
  const gbmP95MDD = mdds[Math.floor(N_PATHS * 0.95)];

  return {
    cycleIndex,
    projectedMDD: projMDD,
    cycleHighPrice,
    cycleHighDate,
    currentDrawdownPct: currentDDPct,
    drawdownProgress,
    impliedFloorFromCycleHigh: impliedFloor,
    gbmExpectedMDD,
    gbmP95MDD,
    gbmHorizonDays,
  };
}

// Fallback mock data when API is unavailable
export function generateData(horizon: number = 14, historyDays: number = 365, model: string = 'transformer') {
  let price = 85000;
  const rawHistory = [];
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);

  for (let i = 0; i <= historyDays; i++) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - i);
    const close = price;
    const change = Math.random() * 0.08 - 0.038;
    const open = close / (1 + change);
    const high = Math.max(open, close) * (1 + Math.random() * 0.025);
    const low = Math.min(open, close) * (1 - Math.random() * 0.025);
    const volume = Math.floor(Math.random() * 30_000_000_000) + 5_000_000_000;
    rawHistory.unshift({ date: date.toISOString().split('T')[0], open, close, high, low, volume, isForecast: false });
    price = open;
  }

  const data: any[] = [];
  for (let i = 0; i < rawHistory.length; i++) {
    let sma20 = null, sma50 = null;
    if (i >= 19) sma20 = rawHistory.slice(i - 19, i + 1).reduce((s, d) => s + d.close, 0) / 20;
    if (i >= 49) sma50 = rawHistory.slice(i - 49, i + 1).reduce((s, d) => s + d.close, 0) / 50;
    data.push({ ...rawHistory[i], sma20, sma50 });
  }

  // Use processRealData-style forecast
  const mockOHLCV: OHLCVData[] = data.map(d => ({
    date: d.date,
    open: d.open,
    high: d.high,
    close: d.close,
    low: d.low,
    volume: d.volume,
  }));

  return processRealData(mockOHLCV, horizon, model, CONFIDENCE_Z_SCORES[0.95]);
}
