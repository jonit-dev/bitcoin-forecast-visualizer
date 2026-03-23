import btcHistory from '../data/btc-history.json';

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
