#!/usr/bin/env node
/**
 * Patches src/data/btc-history.json with recent OHLC and volume from CoinGecko.
 * Patches src/data/mvrv-history.json with missing days from CoinMetrics.
 * Runs automatically as a predev hook before `yarn dev`.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '../src/data/btc-history.json');
const MVRV_DATA_PATH = join(__dirname, '../src/data/mvrv-history.json');
const MS_PER_DAY = 86400000;
const BTC_REPAIR_LOOKBACK_DAYS = 180;
const BTC_HOURLY_CHUNK_DAYS = 90;

function parseUtcDate(date) {
  return new Date(`${date}T00:00:00Z`);
}

function toUtcDateString(value) {
  return new Date(value).toISOString().split('T')[0];
}

function addUtcDays(date, days) {
  const next = parseUtcDate(date);
  next.setUTCDate(next.getUTCDate() + days);
  return toUtcDateString(next);
}

function diffUtcDays(fromDate, toDate) {
  return Math.round((parseUtcDate(toDate).getTime() - parseUtcDate(fromDate).getTime()) / MS_PER_DAY);
}

function maxDate(...dates) {
  return dates.filter(Boolean).sort().at(-1);
}

function buildRangeChunks(fromDateInclusive, toDateExclusive, chunkDays) {
  const chunks = [];
  let cursor = fromDateInclusive;

  while (cursor < toDateExclusive) {
    const endExclusive = [addUtcDays(cursor, chunkDays), toDateExclusive].sort()[0];
    chunks.push({ from: cursor, to: endExclusive });
    cursor = endExclusive;
  }

  return chunks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      return res.json();
    }

    if (res.status === 429 && attempt < retries) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * (attempt + 1);
      console.warn(`[BTC data] API rate limit hit, retrying in ${delayMs}ms…`);
      await sleep(delayMs);
      continue;
    }

    throw new Error(`${res.status} ${res.statusText} for ${url}`);
  }
}

async function fetchRecentDailyCandles(fromDateInclusive, toDateInclusive) {
  const toDateExclusive = addUtcDays(toDateInclusive, 1);
  const priceByDate = new Map();
  const volumeByDate = new Map();

  for (const { from, to } of buildRangeChunks(fromDateInclusive, toDateExclusive, BTC_HOURLY_CHUNK_DAYS)) {
    const fromTs = Math.floor(parseUtcDate(from).getTime() / 1000);
    const toTs = Math.floor(parseUtcDate(to).getTime() / 1000);
    const chart = await fetchJson(
      `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart/range?vs_currency=usd&from=${fromTs}&to=${toTs}&interval=hourly`
    );

    for (const [ts, price] of chart.prices || []) {
      const date = toUtcDateString(ts);
      if (date < fromDateInclusive || date > toDateInclusive) continue;

      const candle = priceByDate.get(date);
      if (!candle) {
        priceByDate.set(date, {
          open: price,
          high: price,
          low: price,
          close: price,
        });
        continue;
      }

      candle.high = Math.max(candle.high, price);
      candle.low = Math.min(candle.low, price);
      candle.close = price;
    }

    for (const [ts, volume] of chart.total_volumes || []) {
      const date = toUtcDateString(ts);
      if (date < fromDateInclusive || date > toDateInclusive) continue;
      volumeByDate.set(date, Math.max(volumeByDate.get(date) || 0, Math.round(volume || 0)));
    }
  }

  const candles = [];
  for (let date = fromDateInclusive; date <= toDateInclusive; date = addUtcDays(date, 1)) {
    const price = priceByDate.get(date);
    if (!price) continue;

    candles.push({
      date,
      open: +price.open.toFixed(2),
      high: +price.high.toFixed(2),
      low: +price.low.toFixed(2),
      close: +price.close.toFixed(2),
      volume: volumeByDate.get(date) ?? 0,
    });
  }

  return candles;
}

async function updateBTCData() {
  const existing = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
  const lastDate = existing[existing.length - 1].date;
  const todayUtc = toUtcDateString(Date.now());
  const lastCompletedUtcDate = addUtcDays(todayUtc, -1);
  const daysSince = Math.max(0, diffUtcDays(lastDate, lastCompletedUtcDate));
  const repairStart = maxDate(existing[0].date, addUtcDays(lastCompletedUtcDate, -(BTC_REPAIR_LOOKBACK_DAYS - 1)));

  console.log(`[BTC data] Rebuilding daily candles from ${repairStart} to ${lastCompletedUtcDate} (last saved ${lastDate})`);

  try {
    const rebuiltTail = await fetchRecentDailyCandles(repairStart, lastCompletedUtcDate);
    if (rebuiltTail.length === 0) {
      console.log('[BTC data] No rebuilt candles available yet (CoinGecko may still be caching the last UTC close).');
      return;
    }

    const preserved = existing.filter((row) => row.date < repairStart);
    const updated = [...preserved, ...rebuiltTail];
    writeFileSync(DATA_PATH, JSON.stringify(updated));

    const repairedDays = rebuiltTail.length;
    const latest = updated[updated.length - 1].date;
    console.log(
      `[BTC data] Rebuilt ${repairedDays} day(s) from market_chart hourly data. Latest: ${latest}. Missing-days delta vs previous tail: ${daysSince}`
    );
  } catch (err) {
    console.warn('[BTC data] Update skipped (continuing with cached data):', err.message);
  }
}

async function updateMVRVData() {
  let existing = [];
  try {
    existing = JSON.parse(readFileSync(MVRV_DATA_PATH, 'utf8'));
  } catch {
    // File missing or malformed — start fresh
  }

  const lastDate = existing.length > 0 ? existing[existing.length - 1].date : '2010-07-17';
  const lastTime = new Date(lastDate + 'T00:00:00Z').getTime();
  const daysSince = Math.ceil((Date.now() - lastTime) / MS_PER_DAY);

  if (daysSince < 1) {
    console.log(`[MVRV data] Up to date (${lastDate})`);
    return;
  }

  console.log(`[MVRV data] ${daysSince} day(s) missing since ${lastDate}, fetching from CoinMetrics…`);

  try {
    const startDate = new Date(lastDate + 'T00:00:00Z');
    startDate.setUTCDate(startDate.getUTCDate() + 1);
    const startTime = startDate.toISOString().split('T')[0];

    const toAdd = [];
    let url = `https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=CapMVRVCur,CapMrktCurUSD&frequency=1d&start_time=${startTime}&page_size=10000`;

    while (url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`CoinMetrics request failed: ${res.status}`);
      const json = await res.json();
      for (const row of json.data || []) {
        if (!row.CapMVRVCur || !row.CapMrktCurUSD) continue;
        const date = row.time.split('T')[0];
        if (date <= lastDate) continue;
        toAdd.push({
          date,
          mvrv: parseFloat(parseFloat(row.CapMVRVCur).toFixed(4)),
          marketCap: Math.round(parseFloat(row.CapMrktCurUSD)),
        });
      }
      url = json.next_page_url || null;
    }

    if (toAdd.length === 0) {
      console.log('[MVRV data] No new entries available yet (CoinMetrics may lag ~1-2 days).');
      return;
    }

    toAdd.sort((a, b) => a.date.localeCompare(b.date));
    const updated = [...existing, ...toAdd];
    writeFileSync(MVRV_DATA_PATH, JSON.stringify(updated));
    console.log(`[MVRV data] Added ${toAdd.length} entries. Latest: ${updated[updated.length - 1].date}`);
  } catch (err) {
    console.warn('[MVRV data] Update skipped (continuing with cached data):', err.message);
  }
}

await Promise.all([updateBTCData(), updateMVRVData()]);
