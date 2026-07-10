import { REPAIR_LOOKBACK_DAYS, type AssetConfig } from './assets';
import { normalizeCoinGecko, normalizeYahoo, type CanonicalCandle } from './normalize';

const DAY_MS = 86_400_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchJson(url: string, fetcher: typeof fetch = fetch, attempts = 3): Promise<unknown> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetcher(url, { signal: controller.signal, headers: { Accept: 'application/json', 'User-Agent': 'bitcoin-forecast-visualizer/1.0' } });
      if (response.ok) return await response.json();
      const error = new Error(`${response.status} ${response.statusText}`);
      if (response.status < 500 && response.status !== 429) throw error;
      lastError = error;
      if (response.status === 429 && attempt < attempts - 1) {
        const retryAfterSeconds = Number(response.headers.get('retry-after'));
        const retryDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? Math.min(30_000, retryAfterSeconds * 1_000)
          : 1_500 * (attempt + 1);
        await sleep(retryDelay + Math.floor(Math.random() * 250));
        continue;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError.message.match(/^4\d\d /) && !lastError.message.startsWith('429 ')) throw lastError;
    } finally { clearTimeout(timeout); }
    if (attempt < attempts - 1) await sleep(150 * 2 ** attempt + Math.floor(Math.random() * 100));
  }
  throw lastError ?? new Error('Source request failed');
}

export async function fetchAssetCandles(asset: AssetConfig, now = new Date(), fetcher: typeof fetch = fetch): Promise<CanonicalCandle[]> {
  const from = Math.floor((now.getTime() - REPAIR_LOOKBACK_DAYS * DAY_MS) / 1000);
  const to = Math.floor(now.getTime() / 1000);
  if (asset.source === 'coingecko') {
    const base = `https://api.coingecko.com/api/v3/coins/${asset.symbol}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
    const hourly = await fetchJson(`${base}&interval=hourly`, fetcher);
    return normalizeCoinGecko(asset, hourly, hourly, now);
  }
  const payload = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${asset.symbol}?period1=${from}&period2=${to}&interval=1d&events=history&includeAdjustedClose=true`, fetcher);
  return normalizeYahoo(asset, payload, now);
}
