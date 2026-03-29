import btcHistory from '../data/btc-history.json';
import mvrvHistory from '../data/mvrv-history.json';

export interface OHLCVData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketData {
  ohlcv: OHLCVData[];
  currentPrice: number;
  priceChange24h: number;
  marketCap: number;
  volume24h: number;
  fetchedAt: number;
}

export interface MVRVPoint {
  date: string;
  mvrv: number;
  marketCap: number;
}

export interface MVRVStats {
  currentMVRV: number | null;
  zScore: number | null;
  signal: string;
  signalColor: string;
}

export function computeMVRVStats(): MVRVStats {
  const data = mvrvHistory as MVRVPoint[];
  if (data.length < 30) return { currentMVRV: null, zScore: null, signal: '—', signalColor: 'text-zinc-400' };

  const diffs = data
    .filter(d => d.mvrv > 0 && d.marketCap > 0)
    .map(d => d.marketCap - d.marketCap / d.mvrv); // marketCap - realizedCap

  const mean = diffs.reduce((s, v) => s + v, 0) / diffs.length;
  const variance = diffs.reduce((s, v) => s + (v - mean) ** 2, 0) / diffs.length;
  const stddev = Math.sqrt(variance);

  const last = data[data.length - 1];
  const currentDiff = last.marketCap - last.marketCap / last.mvrv;
  const zScore = stddev > 0 ? (currentDiff - mean) / stddev : 0;

  let signal: string;
  let signalColor: string;
  if (zScore < 0)        { signal = 'Deep Value'; signalColor = 'text-emerald-400'; }
  else if (zScore < 2)   { signal = 'Undervalued'; signalColor = 'text-emerald-400'; }
  else if (zScore < 3.5) { signal = 'Fair Value'; signalColor = 'text-zinc-300'; }
  else if (zScore < 7)   { signal = 'Overvalued'; signalColor = 'text-amber-400'; }
  else                   { signal = 'Extreme'; signalColor = 'text-red-400'; }

  return { currentMVRV: last.mvrv, zScore, signal, signalColor };
}

export function loadBTCData(): MarketData {
  const ohlcv: OHLCVData[] = btcHistory as OHLCVData[];
  const last = ohlcv[ohlcv.length - 1];
  const prev = ohlcv[ohlcv.length - 2];
  const priceChange24h = prev ? ((last.close - prev.close) / prev.close) * 100 : 0;

  // Estimate market cap from price (approx 19.8M BTC in circulation)
  const circulatingSupply = 19_800_000;
  const marketCap = last.close * circulatingSupply;

  return {
    ohlcv,
    currentPrice: last.close,
    priceChange24h,
    marketCap,
    volume24h: last.volume,
    fetchedAt: Date.now(),
  };
}
