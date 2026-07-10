import type { AssetConfig, MarketAssetId } from './assets';

export interface CanonicalCandle {
  assetId: MarketAssetId;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: string;
  sourceTimestamp: string | null;
  ingestedAt: string;
}

export class CandleValidationError extends Error {
  name = 'CandleValidationError';
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const utcDate = (value: number | string | Date) => new Date(value).toISOString().slice(0, 10);

export function validateCandle(row: CanonicalCandle): CanonicalCandle {
  if (!DATE_PATTERN.test(row.date)) throw new CandleValidationError(`Invalid candle date: ${row.date}`);
  const values = [row.open, row.high, row.low, row.close, row.volume];
  if (!values.every(Number.isFinite)) throw new CandleValidationError(`Non-finite OHLCV for ${row.assetId}/${row.date}`);
  if (row.open <= 0 || row.high <= 0 || row.low <= 0 || row.close <= 0 || row.volume < 0) {
    throw new CandleValidationError(`Invalid positive OHLCV constraint for ${row.assetId}/${row.date}`);
  }
  if (row.high < Math.max(row.open, row.close, row.low) || row.low > Math.min(row.open, row.close, row.high)) {
    throw new CandleValidationError(`Malformed OHLC for ${row.assetId}/${row.date}`);
  }
  return row;
}

function ensureUniqueSorted(rows: CanonicalCandle[]) {
  rows.sort((a, b) => a.date.localeCompare(b.date));
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index - 1].date === rows[index].date) {
      throw new CandleValidationError(`Duplicate candle date: ${rows[index].date}`);
    }
  }
  return rows;
}

export function normalizeCoinGecko(
  asset: AssetConfig,
  hourly: unknown,
  daily: unknown,
  now = new Date(),
): CanonicalCandle[] {
  const prices = (hourly as { prices?: unknown })?.prices;
  const volumes = (daily as { total_volumes?: unknown })?.total_volumes;
  if (!Array.isArray(prices) || !Array.isArray(volumes)) throw new CandleValidationError('Unexpected CoinGecko response');
  const completedBefore = utcDate(now);
  const grouped = new Map<string, { open: number; high: number; low: number; close: number; ts: number }>();
  for (const point of prices) {
    if (!Array.isArray(point) || point.length < 2 || !point.every(Number.isFinite)) throw new CandleValidationError('Unexpected CoinGecko price point');
    const [timestamp, price] = point as [number, number];
    const date = utcDate(timestamp);
    if (date >= completedBefore) continue;
    const existing = grouped.get(date);
    if (!existing) grouped.set(date, { open: price, high: price, low: price, close: price, ts: timestamp });
    else {
      existing.high = Math.max(existing.high, price);
      existing.low = Math.min(existing.low, price);
      existing.close = price;
      existing.ts = timestamp;
    }
  }
  const volumeByDate = new Map<string, number>();
  for (const point of volumes) {
    if (!Array.isArray(point) || point.length < 2 || !point.every(Number.isFinite)) throw new CandleValidationError('Unexpected CoinGecko volume point');
    volumeByDate.set(utcDate(point[0] as number), point[1] as number);
  }
  const ingestedAt = now.toISOString();
  return ensureUniqueSorted([...grouped].map(([date, value]) => validateCandle({
    assetId: asset.id, date,
    open: +value.open.toFixed(2), high: +value.high.toFixed(2), low: +value.low.toFixed(2), close: +value.close.toFixed(2),
    volume: Math.round(volumeByDate.get(date) ?? 0), source: 'coingecko',
    sourceTimestamp: new Date(value.ts).toISOString(), ingestedAt,
  })));
}

export function normalizeYahoo(asset: AssetConfig, payload: unknown, now = new Date()): CanonicalCandle[] {
  const result = (payload as any)?.chart?.result?.[0];
  const timestamps = result?.timestamp;
  const quote = result?.indicators?.quote?.[0];
  const adjusted = result?.indicators?.adjclose?.[0]?.adjclose;
  if (!Array.isArray(timestamps) || !quote || !Array.isArray(adjusted)) throw new CandleValidationError('Unexpected Yahoo response');
  const ingestedAt = now.toISOString();
  const rows: CanonicalCandle[] = [];
  const today = utcDate(now);
  const currentSessionComplete = now.getUTCHours() >= 21;
  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = timestamps[index];
    const [open, high, low, close, volume, adjustedClose] = [quote.open?.[index], quote.high?.[index], quote.low?.[index], quote.close?.[index], quote.volume?.[index], adjusted[index]];
    if ([open, high, low, close, volume, adjustedClose].some((value) => value == null)) continue;
    if (![timestamp, open, high, low, close, volume, adjustedClose].every(Number.isFinite)) throw new CandleValidationError('Non-finite Yahoo candle');
    const date = utcDate(timestamp * 1000);
    if (date > today || (date === today && !currentSessionComplete)) continue;
    const ratio = adjustedClose > 0 ? adjustedClose / close : 1;
    rows.push(validateCandle({
      assetId: asset.id, date, open: +(open * ratio).toFixed(4),
      high: +(high * ratio).toFixed(4), low: +(low * ratio).toFixed(4), close: +adjustedClose.toFixed(4),
      volume: Math.round(volume), source: 'yahoo', sourceTimestamp: new Date(timestamp * 1000).toISOString(), ingestedAt,
    }));
  }
  return ensureUniqueSorted(rows);
}
