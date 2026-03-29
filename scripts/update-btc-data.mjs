#!/usr/bin/env node
/**
 * Patches src/data/btc-history.json with missing days from CoinGecko.
 * Patches src/data/mvrv-history.json with missing days from CoinMetrics.
 * Runs automatically as a predev hook before `yarn dev`.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '../src/data/btc-history.json');
const MVRV_DATA_PATH = join(__dirname, '../src/data/mvrv-history.json');

async function updateBTCData() {
  const existing = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
  const lastDate = existing[existing.length - 1].date;
  const lastTime = new Date(lastDate + 'T00:00:00Z').getTime();
  const daysSince = Math.ceil((Date.now() - lastTime) / 86400000);

  if (daysSince < 1) {
    console.log(`[BTC data] Up to date (${lastDate})`);
    return;
  }

  console.log(`[BTC data] ${daysSince} day(s) missing since ${lastDate}, fetching…`);

  try {
    // Request at least 90 days so CoinGecko returns daily OHLC granularity
    const days = Math.max(90, daysSince + 5);

    const [ohlcRes, chartRes] = await Promise.all([
      fetch(`https://api.coingecko.com/api/v3/coins/bitcoin/ohlc?vs_currency=usd&days=${days}`),
      fetch(`https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}&interval=daily`),
    ]);

    if (!ohlcRes.ok) throw new Error(`OHLC request failed: ${ohlcRes.status}`);

    const ohlcRaw = await ohlcRes.json(); // [[ts_ms, o, h, l, c], ...]
    const chartData = chartRes.ok ? await chartRes.json() : null;

    // Build volume lookup: date -> volume (USD)
    const volumeByDate = new Map();
    if (chartData?.total_volumes) {
      for (const [ts, vol] of chartData.total_volumes) {
        volumeByDate.set(new Date(ts).toISOString().split('T')[0], vol);
      }
    }

    const existingDates = new Set(existing.map(d => d.date));
    const toAdd = [];

    for (const [ts, open, high, low, close] of ohlcRaw) {
      const date = new Date(ts).toISOString().split('T')[0];
      if (date > lastDate && !existingDates.has(date)) {
        toAdd.push({
          date,
          open: +open.toFixed(2),
          high: +high.toFixed(2),
          low: +low.toFixed(2),
          close: +close.toFixed(2),
          volume: volumeByDate.has(date) ? Math.round(volumeByDate.get(date)) : 0,
        });
      }
    }

    if (toAdd.length === 0) {
      console.log('[BTC data] No new entries available yet (CoinGecko may lag ~1 day).');
      return;
    }

    toAdd.sort((a, b) => a.date.localeCompare(b.date));
    const updated = [...existing, ...toAdd];
    writeFileSync(DATA_PATH, JSON.stringify(updated));
    console.log(`[BTC data] Added ${toAdd.length} entries. Latest: ${updated[updated.length - 1].date}`);
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
  const daysSince = Math.ceil((Date.now() - lastTime) / 86400000);

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
