import type { OHLCVData } from './api';
import {
  basePowerLawPrice,
  daysSinceGenesis,
  floorPowerLawPrice,
  peakPowerLawPrice,
  POWER_LAW_MEAN_REVERSION_TAU_DAYS,
  powerLawForecast,
} from './powerLaw';
import {
  blendedPowerLawHeatmapVol,
  computePowerLawInterval,
  CONFIDENCE_Z_SCORES,
} from './forecastInterval';
import { INTERVAL_CONFIG } from './modelConfig';

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

export type CoefficientStabilityVerdict = 'stable' | 'watch' | 'unstable';

const STOCHASTIC_TRACE_COUNT = 12;
const STOCHASTIC_TRACE_BACKCAST_DAYS = 7;
const STOCHASTIC_TRACE_BLOCK_DAYS = 14;
// Use recent regime history for visible scenario paths. Full-history BTC residuals include
// early-era shocks that are not calibrated to the displayed confidence interval scale.
const STOCHASTIC_TRACE_LOOKBACK_DAYS = 730;

export { CONFIDENCE_Z_SCORES };

export function coefficientAwareCalibrationLabel(
  horizonDays: number,
  baseLabel: string,
  stabilityVerdict?: CoefficientStabilityVerdict
): string {
  if (horizonDays < 180) return baseLabel;
  if (stabilityVerdict === 'unstable') return 'Directional only';
  return 'Scenario range';
}

export function coefficientStabilityTrustCopy(
  horizonDays: number,
  stabilityVerdict?: CoefficientStabilityVerdict
): string {
  if (horizonDays < 180) return 'Amber path = median path. Dotted bands show calibrated risk range. Scenario sketches stay hidden unless enabled.';
  if (stabilityVerdict === 'stable') return 'Long-horizon output is a scenario range backed by the latest coefficient stability check.';
  if (stabilityVerdict === 'unstable') return 'Long-horizon coefficient refits are unstable, so 180+ day output is directional only rather than exact-confidence guidance.';
  return 'Fixed structural coefficients are under review at 180-365 day horizons; treat the output as a scenario range.';
}

function probabilityVerdict(horizonDays: number, probabilityUp: number): string {
  if (horizonDays <= 14) return probabilityUp >= 0.53 ? 'Slight upside tilt' : probabilityUp <= 0.47 ? 'Slight downside tilt' : 'Coin flip';
  if (probabilityUp < 0.4) return 'Downside-biased median';
  if (probabilityUp < 0.47) return 'Range-bound / soft bias';
  if (probabilityUp > 0.6) return 'Upside-biased median';
  return 'Balanced distribution';
}

export function computeProbabilityForecast(
  ohlcv: OHLCVData[],
  horizonDays: number
): ProbabilityForecast | null {
  if (ohlcv.length < 365 || horizonDays < 1) return null;

  const last = ohlcv[ohlcv.length - 1];
  const lastDate = new Date(last.date + 'T00:00:00Z');
  const targetDate = addUtcDays(lastDate, horizonDays);
  const median = channelGuardedPowerLawForecast(targetDate, last.close, lastDate);
  const interval = computePowerLawInterval({ ohlcv, horizonDays, median, currentPrice: last.close });
  if (!interval) return null;

  return {
    horizonDays,
    targetDate: dateKey(targetDate),
    median,
    probabilityUp: interval.probabilityUp,
    q05: interval.q05,
    q10: interval.q10,
    q90: interval.q90,
    q95: interval.q95,
    calibrationLabel: interval.calibrationLabel,
    verdict: probabilityVerdict(horizonDays, interval.probabilityUp),
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

function hashStringSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalFromRng(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dateKey(date: Date): string {
  return date.toISOString().split('T')[0];
}

function powerLawChannelGuard(price: number, date: Date): number {
  const t = daysSinceGenesis(date);
  const floorPrice = floorPowerLawPrice(t);
  const peakPrice = peakPowerLawPrice(t);
  if (!Number.isFinite(price) || price <= 0) return floorPrice;

  // Treat the floor/peak curves as historically validated support/resistance
  // priors, not as decorative chart lines. Reflect excursions back into the
  // channel instead of hard-clamping, so the visible stochastic path keeps
  // probabilistic texture without casually implying a structural regime break.
  if (price < floorPrice) {
    const breach = Math.log(floorPrice / price);
    return floorPrice * Math.exp(Math.min(breach * 0.18, 0.035));
  }
  if (price > peakPrice) {
    const breach = Math.log(price / peakPrice);
    return peakPrice * Math.exp(-Math.min(breach * 0.18, 0.035));
  }
  return price;
}

function channelGuardedPowerLawForecast(dateFuture: Date, currentPrice: number, currentDate: Date): number {
  const rawForecast = powerLawForecast(dateFuture, currentPrice, currentDate);
  return powerLawChannelGuard(rawForecast, dateFuture);
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
    const expected = channelGuardedPowerLawForecast(currDate, prev.close, prevDate);
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
  horizon: number
): Map<string, number[]> {
  const tracesByDate = new Map<string, number[]>();
  if (horizon < 1 || ohlcv.length < 120) return tracesByDate;

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
      const expected = channelGuardedPowerLawForecast(currDate, price, prevDate);
      const innovation = centeredInnovations[blockStart + blockOffset++];
      price = powerLawChannelGuard(expected * Math.exp(innovation), currDate);
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
  confidenceZ: number = CONFIDENCE_Z_SCORES[0.95]
): any[] {
  const stochasticTracesByDate = generatePowerLawStochasticTraces(ohlcv, horizon);
  const lastReal = ohlcv[ohlcv.length - 1];
  const rng = mulberry32(hashStringSeed(`btc-forecast-candles:${lastReal?.date ?? 'unknown'}:${horizon}`));

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
  let forecastPrice = lastReal.close;

  data[data.length - 1].forecast = forecastPrice;
  data[data.length - 1].forecastUpper = forecastPrice;
  data[data.length - 1].forecastLower = forecastPrice;

  const lastDate = new Date(lastReal.date + 'T00:00:00Z');
  for (let i = 1; i <= horizon; i++) {
    const date = new Date(lastDate);
    date.setUTCDate(date.getUTCDate() + i);

    const prevDate = new Date(lastDate);
    prevDate.setUTCDate(prevDate.getUTCDate() + i - 1);
    const open = i === 1 ? lastReal.close : channelGuardedPowerLawForecast(prevDate, lastReal.close, lastDate);
    const close = channelGuardedPowerLawForecast(date, lastReal.close, lastDate);

    const high = Math.max(open, close) * (1 + rng() * dailyVol * 0.3);
    const low = Math.min(open, close) * (1 - rng() * dailyVol * 0.3);

    // Forecast interval: the power-law path uses residual-process variance plus
    // a fat-tail stress multiplier. No visual cap — long-horizon bands should
    // widen when Bitcoin's historical residual errors say they should.
    const interval = computePowerLawInterval({ ohlcv, horizonDays: i, median: close, currentPrice: lastReal.close });
    const ciHalf = interval ? confidenceZ * interval.sigma : confidenceZ * dailyVol * Math.sqrt(i);

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
  numSimulations: number = 500,
  numPriceBands: number = 80
): HeatmapCell[] {
  if (horizon < 1 || ohlcv.length < 30) return [];

  const lastPrice = ohlcv[ohlcv.length - 1].close;
  const lastDateMs = new Date(ohlcv[ohlcv.length - 1].date + 'T00:00:00Z').getTime();
  const lastDate = new Date(lastDateMs);
  const rng = mulberry32(hashStringSeed(`btc-forecast-heatmap:${ohlcv[ohlcv.length - 1].date}:${horizon}:${numSimulations}:${numPriceBands}`));
  const dailyVol = blendedPowerLawHeatmapVol(ohlcv);

  const futureBasePrices = new Float64Array(horizon + 1);
  const lastBasePrice = basePowerLawPrice(daysSinceGenesis(lastDate));
  const tNow = daysSinceGenesis(lastDate);
  futureBasePrices[0] = lastBasePrice;
  for (let d = 1; d <= horizon; d++) futureBasePrices[d] = basePowerLawPrice(tNow + d);
  const residualDecay = Math.exp(-1 / POWER_LAW_MEAN_REVERSION_TAU_DAYS);
  const powerLawShockDrift = -INTERVAL_CONFIG.logDriftScale * dailyVol * dailyVol;

  // Sample output dates for long horizons (sim still runs every day for accuracy)
  const sampleStep = horizon <= 90 ? 1 : horizon <= 365 ? 2 : horizon <= 1825 ? 5 : 10;
  const sampledDays: number[] = [];
  for (let d = 1; d <= horizon; d++) {
    if (d % sampleStep === 0 || d === 1 || d === horizon) sampledDays.push(d);
  }
  const sampledSet = new Set(sampledDays);
  const sampledCount = sampledDays.length;

  // Pre-generate deterministic random normals so identical inputs produce identical forecasts.
  const totalRands = numSimulations * horizon;
  const normals = new Float64Array(totalRands);
  for (let i = 0; i < totalRands; i++) normals[i] = normalFromRng(rng);

  // Run Monte Carlo — store only sampled days in flat typed array
  const results = new Float64Array(numSimulations * sampledCount);

  for (let s = 0; s < numSimulations; s++) {
    let sIdx = 0;
    const rOff = s * horizon;
    let residual = Math.log(lastPrice / lastBasePrice);

    for (let d = 1; d <= horizon; d++) {
      residual = residual * residualDecay + powerLawShockDrift + dailyVol * normals[rOff + d - 1];
      const price = futureBasePrices[d] * Math.exp(residual);

      if (sampledSet.has(d)) {
        results[s * sampledCount + sIdx++] = price;
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
export function generateData(horizon: number = 14, historyDays: number = 365) {
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

  return processRealData(mockOHLCV, horizon, CONFIDENCE_Z_SCORES[0.95]);
}
