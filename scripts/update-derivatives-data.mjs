#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '../src/data/derivatives-history.json');
const BASE_URL = 'https://fapi.binance.com';
const SYMBOL = 'BTCUSDT';
const MS_PER_DAY = 86400000;
const FUNDING_LOOKBACK_DAYS = 35;
const OPEN_INTEREST_LOOKBACK_DAYS = 30;

function dateKey(value) {
  return new Date(value).toISOString().split('T')[0];
}

function startOfUtcDay(date) {
  return new Date(`${date}T00:00:00Z`).getTime();
}

function addUtcDays(date, days) {
  return dateKey(startOfUtcDay(date) + days * MS_PER_DAY);
}

function isoAtStartOfNextUtcDay(date) {
  return new Date(startOfUtcDay(addUtcDays(date, 1))).toISOString();
}

async function fetchJson(path, params) {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function main() {
  const fetchedAt = new Date().toISOString();
  const lastCompletedDate = addUtcDays(dateKey(Date.now()), -1);
  const fundingStart = startOfUtcDay(addUtcDays(lastCompletedDate, -(FUNDING_LOOKBACK_DAYS - 1)));
  const fundingEnd = startOfUtcDay(addUtcDays(lastCompletedDate, 1)) - 1;

  const [fundingRows, openInterestRows] = await Promise.all([
    fetchJson('/fapi/v1/fundingRate', {
      symbol: SYMBOL,
      startTime: fundingStart,
      endTime: fundingEnd,
      limit: 1000,
    }),
    fetchJson('/futures/data/openInterestHist', {
      symbol: SYMBOL,
      period: '1d',
      limit: OPEN_INTEREST_LOOKBACK_DAYS,
    }),
  ]);

  const fundingByDate = new Map();
  for (const row of fundingRows) {
    const rate = finiteNumber(row.fundingRate);
    if (rate === null) continue;
    const date = dateKey(row.fundingTime);
    if (date > lastCompletedDate) continue;
    if (!fundingByDate.has(date)) fundingByDate.set(date, []);
    fundingByDate.get(date).push({
      rate,
      fundingTime: Number(row.fundingTime),
    });
  }

  const oiByDate = new Map();
  for (const row of openInterestRows) {
    const date = dateKey(row.timestamp);
    if (date > lastCompletedDate) continue;
    const openInterestBTC = finiteNumber(row.sumOpenInterest);
    const openInterestUSD = finiteNumber(row.sumOpenInterestValue);
    const circulatingSupply = finiteNumber(row.CMCCirculatingSupply);
    if (openInterestBTC === null || openInterestUSD === null) continue;
    oiByDate.set(date, {
      openInterestBTC,
      openInterestUSD,
      circulatingSupply,
      sourceTimestamp: Number(row.timestamp),
    });
  }

  const dates = [...new Set([...fundingByDate.keys(), ...oiByDate.keys()])].sort();
  const rows = dates.map(date => {
    const fundingEvents = fundingByDate.get(date) ?? [];
    const fundingRates = fundingEvents.map(event => event.rate);
    const fundingRateDailySum = fundingRates.reduce((sum, value) => sum + value, 0);
    const fundingRateDailyAvg = fundingRates.length > 0 ? fundingRateDailySum / fundingRates.length : null;
    const oi = oiByDate.get(date);
    const metrics = {};
    const missingMetrics = [];

    if (fundingRates.length > 0) {
      metrics.fundingRateDailyAvg = fundingRateDailyAvg;
      metrics.fundingRateDailySum = fundingRateDailySum;
      metrics.fundingObservationCount = fundingRates.length;
    } else {
      missingMetrics.push('fundingRateDailyAvg', 'fundingRateDailySum', 'fundingObservationCount');
    }

    if (oi) {
      metrics.openInterestBTC = oi.openInterestBTC;
      metrics.openInterestUSD = oi.openInterestUSD;
      if (oi.circulatingSupply !== null) metrics.circulatingSupply = oi.circulatingSupply;
    } else {
      missingMetrics.push('openInterestBTC', 'openInterestUSD');
    }

    return {
      date,
      source: 'Binance USD-M Futures public REST',
      symbol: SYMBOL,
      fetchedAt,
      latestSourceDate: date,
      availableAfter: isoAtStartOfNextUtcDay(date),
      daysLag: Math.max(0, Math.round((startOfUtcDay(lastCompletedDate) - startOfUtcDay(date)) / MS_PER_DAY)),
      metrics,
      timing: {
        fundingEventTimes: fundingEvents
          .map(event => event.fundingTime)
          .filter(Number.isFinite)
          .sort((a, b) => a - b)
          .map(value => new Date(value).toISOString()),
        openInterestTimestamp: oi?.sourceTimestamp ? new Date(oi.sourceTimestamp).toISOString() : null,
        conservativeAvailableAfter: isoAtStartOfNextUtcDay(date),
      },
      missingMetrics,
    };
  });

  writeFileSync(OUT_PATH, `${JSON.stringify({
    metadata: {
      source: 'Binance USD-M Futures public REST',
      status: rows.length > 0 ? 'available' : 'unavailable',
      fetchedAt,
      symbol: SYMBOL,
      fields: ['fundingRateDailyAvg', 'fundingRateDailySum', 'fundingObservationCount', 'openInterestBTC', 'openInterestUSD'],
      cadence: 'daily',
      credentialRequired: false,
      limitations: [
        'Binance openInterestHist only exposes recent open-interest history, currently documented as latest 1 month.',
        'Funding is sampled every 8 hours for BTCUSDT perpetual futures and is aggregated by UTC date.',
        'Rows include raw Binance event timestamps and a conservative next-UTC-day availableAfter timestamp for point-in-time checks.',
        'This cache is context-only until enough history exists for walk-forward forecast validation.',
      ],
      docs: {
        fundingRate: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History',
        openInterest: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Open-Interest-Statistics',
      },
    },
    rows,
  }, null, 2)}\n`);

  console.log(
    [
      '[Derivatives data] updated',
      `rows=${rows.length}`,
      `first=${rows[0]?.date ?? 'n/a'}`,
      `last=${rows.at(-1)?.date ?? 'n/a'}`,
      `source=Binance USD-M Futures public REST`,
      `path=${OUT_PATH}`,
    ].join('  ')
  );
}

main().catch(err => {
  const fetchedAt = new Date().toISOString();
  writeFileSync(OUT_PATH, `${JSON.stringify({
    metadata: {
      source: 'Binance USD-M Futures public REST',
      status: 'unavailable',
      fetchedAt,
      fields: ['openInterestUSD', 'fundingRateDailyAvg'],
      cadence: 'daily',
      credentialRequired: false,
      note: `Fetch failed: ${err.message}`,
    },
    rows: [],
  }, null, 2)}\n`);
  console.error(`[Derivatives data] FAILED: ${err.message}`);
  process.exitCode = 1;
});
