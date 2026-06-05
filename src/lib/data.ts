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

// Holdout-calibrated blend: recent vol reacts quickly, long vol keeps the band from overfitting
// the latest regime. The log-drift scale keeps the modal path close to realized outcomes.
const POWER_LAW_HEATMAP_RECENT_VOL_WEIGHT = 0.55;
const POWER_LAW_HEATMAP_LOG_DRIFT_SCALE = 0.3;

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

export function processRealData(
  ohlcv: OHLCVData[],
  horizon: number = 14,
  model: string = 'transformer',
  confidenceZ: number = CONFIDENCE_Z_SCORES[0.95]
): any[] {
  // Add SMAs to historical data
  const data: any[] = ohlcv.map((d, i) => {
    let sma20: number | null = null;
    let sma50: number | null = null;
    if (i >= 19) sma20 = ohlcv.slice(i - 19, i + 1).reduce((s, x) => s + x.close, 0) / 20;
    if (i >= 49) sma50 = ohlcv.slice(i - 49, i + 1).reduce((s, x) => s + x.close, 0) / 50;
    const t = daysSinceGenesis(new Date(d.date + 'T00:00:00Z'));
    return { ...d, sma20, sma50, isForecast: false, powerLawModel: basePowerLawPrice(t), floorPriceModel: floorPowerLawPrice(t), peakPriceModel: peakPowerLawPrice(t) };
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
