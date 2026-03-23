import type { OHLCVData } from './api';

export interface HeatmapCell {
  date: string;
  priceLow: number;
  priceHigh: number;
  density: number; // 0-1 normalized per column
}

// BTC Power Law model anchored to Genesis block (2009-01-03)
const GENESIS = new Date('2009-01-03T00:00:00Z');

function daysSinceGenesis(date: Date): number {
  return Math.floor((date.getTime() - GENESIS.getTime()) / 86400000);
}

function basePowerLawPrice(t: number): number {
  const a = 9.48e-10;
  const b = 3.6702;
  const c1 = 0.2323;
  const c2 = 0.4288;
  const omega = (2 * Math.PI) / 1460;
  return a * Math.pow(t, b) * (1 + c1 * Math.sin(omega * t) + c2 * Math.cos(omega * t));
}

function powerLawForecast(dateFuture: Date, currentPrice: number, currentDate: Date): number {
  const tNow = daysSinceGenesis(currentDate);
  const tFut = daysSinceGenesis(dateFuture);
  const hDays = Math.round((dateFuture.getTime() - currentDate.getTime()) / 86400000);
  if (hDays <= 90) {
    const rT = Math.log(currentPrice) - Math.log(basePowerLawPrice(tNow));
    const tau = 15;
    const corr = Math.exp(rT * Math.exp(-hDays / tau));
    return basePowerLawPrice(tFut) * corr;
  }
  return basePowerLawPrice(tFut);
}

export function processRealData(ohlcv: OHLCVData[], horizon: number = 14, model: string = 'transformer'): any[] {
  // Add SMAs to historical data
  const data: any[] = ohlcv.map((d, i) => {
    let sma20: number | null = null;
    let sma50: number | null = null;
    if (i >= 19) sma20 = ohlcv.slice(i - 19, i + 1).reduce((s, x) => s + x.close, 0) / 20;
    if (i >= 49) sma50 = ohlcv.slice(i - 49, i + 1).reduce((s, x) => s + x.close, 0) / 50;
    return { ...d, sma20, sma50, isForecast: false, powerLawModel: basePowerLawPrice(daysSinceGenesis(new Date(d.date + 'T00:00:00Z'))) };
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

    // CI: power law caps at ±50%; random walk uses standard sqrt(t)
    const ciHalf = isPowerLaw
      ? Math.min(dailyVol * Math.sqrt(i) * 1.96, 0.5)
      : dailyVol * Math.sqrt(i) * 1.96;

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
      sma20: null,
      sma50: null,
    });
  }

  return data;
}

// Monte Carlo probability heatmap using GBM with power-law drift
export function generateHeatmapData(
  ohlcv: OHLCVData[],
  horizon: number,
  model: string,
  numSimulations: number = 500,
  numPriceBands: number = 80
): HeatmapCell[] {
  if (horizon < 1 || ohlcv.length < 30) return [];

  const lookback = Math.min(90, ohlcv.length - 1);
  const recent = ohlcv.slice(-lookback - 1);
  const logReturns = recent.slice(1).map((d, i) => Math.log(d.close / recent[i].close));
  const meanReturn = logReturns.reduce((s, r) => s + r, 0) / logReturns.length;
  const variance = logReturns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / logReturns.length;
  const dailyVol = Math.sqrt(variance);
  const halfVolSq = 0.5 * dailyVol * dailyVol;

  const lastPrice = ohlcv[ohlcv.length - 1].close;
  const lastDateMs = new Date(ohlcv[ohlcv.length - 1].date + 'T00:00:00Z').getTime();
  const lastDate = new Date(lastDateMs);
  const isPowerLaw = model === 'powerlaw';

  // Pre-compute drift for each day ONCE (identical across all sims)
  const drifts = new Float64Array(horizon + 1);
  if (isPowerLaw) {
    let prevPl = lastPrice;
    for (let d = 1; d <= horizon; d++) {
      const plFut = powerLawForecast(new Date(lastDateMs + d * 86400000), lastPrice, lastDate);
      drifts[d] = Math.log(plFut / prevPl);
      prevPl = plFut;
    }
  } else {
    drifts.fill(meanReturn, 1);
  }

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
    let price = lastPrice;
    let sIdx = 0;
    const rOff = s * horizon;

    for (let d = 1; d <= horizon; d++) {
      price = price * Math.exp(drifts[d] - halfVolSq + dailyVol * normals[rOff + d - 1]);
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
    low: d.low,
    close: d.close,
    volume: d.volume,
  }));

  return processRealData(mockOHLCV, horizon, model);
}
