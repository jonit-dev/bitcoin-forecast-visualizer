#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '../src/data/derivatives-history.json');
const BASE_URL = 'https://fapi.binance.com';
const SYMBOL = 'BTCUSDT';
const MS_PER_DAY = 86400000;
const FUNDING_START = '2019-09-10';
const PREMIUM_START = '2019-12-24';
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

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchJson(path, params) {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function fetchFundingRows(startDate, endDate) {
  const rows = [];
  let cursor = startOfUtcDay(startDate);
  const end = startOfUtcDay(addUtcDays(endDate, 1)) - 1;
  while (cursor <= end) {
    const chunk = await fetchJson('/fapi/v1/fundingRate', {
      symbol: SYMBOL,
      startTime: cursor,
      endTime: end,
      limit: 1000,
    });
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    rows.push(...chunk);
    const last = Math.max(...chunk.map(row => Number(row.fundingTime)).filter(Number.isFinite));
    const next = last + 1;
    if (!Number.isFinite(last) || next <= cursor) break;
    cursor = next;
    await sleep(25);
  }
  return rows;
}

async function fetchPremiumRows(startDate, endDate) {
  const rows = [];
  let cursor = startOfUtcDay(startDate);
  const end = startOfUtcDay(addUtcDays(endDate, 1)) - 1;
  while (cursor <= end) {
    const chunk = await fetchJson('/fapi/v1/premiumIndexKlines', {
      symbol: SYMBOL,
      interval: '1d',
      startTime: cursor,
      endTime: end,
      limit: 1000,
    });
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    rows.push(...chunk);
    const last = Math.max(...chunk.map(row => Number(row[0])).filter(Number.isFinite));
    const next = last + MS_PER_DAY;
    if (!Number.isFinite(last) || next <= cursor) break;
    cursor = next;
    await sleep(25);
  }
  return rows;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function addRollingZ(rows, metricName, lookback, outputName) {
  const values = [];
  for (const row of rows) {
    const current = row.metrics[metricName];
    const prior = values.slice(-lookback);
    if (Number.isFinite(current) && prior.length >= Math.floor(lookback * 0.8)) {
      const mean = prior.reduce((sum, value) => sum + value, 0) / prior.length;
      const variance = prior.reduce((sum, value) => sum + (value - mean) ** 2, 0) / prior.length;
      const sd = Math.sqrt(variance);
      if (sd > 0) row.metrics[outputName] = (current - mean) / sd;
    }
    if (Number.isFinite(current)) values.push(current);
  }
}

function addRollingSum(rows, metricName, lookback, outputName) {
  const values = [];
  for (const row of rows) {
    const current = row.metrics[metricName];
    if (Number.isFinite(current)) values.push(current);
    else values.push(null);
    const prior = values.slice(-lookback).filter(Number.isFinite);
    if (prior.length >= Math.floor(lookback * 0.8)) {
      row.metrics[outputName] = prior.reduce((sum, value) => sum + value, 0);
    }
  }
}

async function main() {
  const fetchedAt = new Date().toISOString();
  const lastCompletedDate = addUtcDays(dateKey(Date.now()), -1);

  const [fundingRows, premiumRows, openInterestRows] = await Promise.all([
    fetchFundingRows(FUNDING_START, lastCompletedDate),
    fetchPremiumRows(PREMIUM_START, lastCompletedDate),
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
    fundingByDate.get(date).push({ rate, fundingTime: Number(row.fundingTime) });
  }

  const premiumByDate = new Map();
  for (const row of premiumRows) {
    const date = dateKey(Number(row[0]));
    if (date > lastCompletedDate) continue;
    const open = finiteNumber(row[1]);
    const high = finiteNumber(row[2]);
    const low = finiteNumber(row[3]);
    const close = finiteNumber(row[4]);
    premiumByDate.set(date, {
      premiumOpen: open,
      premiumHigh: high,
      premiumLow: low,
      premiumClose: close,
      premiumRange: high !== null && low !== null ? high - low : null,
      sourceTimestamp: Number(row[0]),
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

  const dates = [...new Set([...fundingByDate.keys(), ...premiumByDate.keys(), ...oiByDate.keys()])].sort();
  const rows = dates.map(date => {
    const fundingEvents = fundingByDate.get(date) ?? [];
    const fundingRates = fundingEvents.map(event => event.rate);
    const fundingRateDailySum = fundingRates.reduce((sum, value) => sum + value, 0);
    const fundingRateDailyAvg = fundingRates.length > 0 ? fundingRateDailySum / fundingRates.length : null;
    const premium = premiumByDate.get(date);
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

    if (premium) {
      for (const key of ['premiumOpen', 'premiumHigh', 'premiumLow', 'premiumClose', 'premiumRange']) {
        if (Number.isFinite(premium[key])) metrics[key] = premium[key];
      }
    } else {
      missingMetrics.push('premiumClose', 'premiumRange');
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
        premiumTimestamp: premium?.sourceTimestamp ? new Date(premium.sourceTimestamp).toISOString() : null,
        openInterestTimestamp: oi?.sourceTimestamp ? new Date(oi.sourceTimestamp).toISOString() : null,
        conservativeAvailableAfter: isoAtStartOfNextUtcDay(date),
      },
      missingMetrics,
    };
  });

  addRollingZ(rows, 'fundingRateDailySum', 90, 'fundingRateSumZ90d');
  addRollingZ(rows, 'fundingRateDailyAvg', 90, 'fundingRateAvgZ90d');
  addRollingSum(rows, 'fundingRateDailySum', 7, 'fundingRateSum7d');
  addRollingSum(rows, 'fundingRateDailySum', 30, 'fundingRateSum30d');
  addRollingZ(rows, 'premiumClose', 90, 'premiumCloseZ90d');

  writeFileSync(OUT_PATH, `${JSON.stringify({
    metadata: {
      source: 'Binance USD-M Futures public REST',
      status: rows.length > 0 ? 'available' : 'unavailable',
      fetchedAt,
      symbol: SYMBOL,
      fields: [
        'fundingRateDailyAvg',
        'fundingRateDailySum',
        'fundingRateSum7d',
        'fundingRateSum30d',
        'fundingRateSumZ90d',
        'fundingRateAvgZ90d',
        'premiumClose',
        'premiumCloseZ90d',
        'premiumRange',
        'openInterestBTC',
        'openInterestUSD',
      ],
      cadence: 'daily',
      credentialRequired: false,
      limitations: [
        'Binance openInterestHist only exposes recent open-interest history, currently documented as latest 1 month.',
        'Funding is sampled every 8 hours for BTCUSDT perpetual futures and is aggregated by UTC date; history starts around 2019-09-10.',
        'Premium index klines are daily and start around 2019-12-24 for BTCUSDT.',
        'Rows include raw Binance event timestamps and a conservative next-UTC-day availableAfter timestamp for point-in-time checks.',
        'Median forecast influence remains disabled until walk-forward ablations prove value.',
      ],
      docs: {
        fundingRate: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History',
        premiumIndexKlines: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Premium-Index-Kline-Data',
        openInterest: 'https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Open-Interest-Statistics',
      },
    },
    rows,
  }, null, 2)}\n`);

  console.log([
    '[Derivatives data] updated',
    `rows=${rows.length}`,
    `first=${rows[0]?.date ?? 'n/a'}`,
    `last=${rows.at(-1)?.date ?? 'n/a'}`,
    `fundingEvents=${fundingRows.length}`,
    `premiumRows=${premiumRows.length}`,
    `source=Binance USD-M Futures public REST`,
    `path=${OUT_PATH}`,
  ].join('  '));
}

main().catch(err => {
  const fetchedAt = new Date().toISOString();
  writeFileSync(OUT_PATH, `${JSON.stringify({
    metadata: {
      source: 'Binance USD-M Futures public REST',
      status: 'unavailable',
      fetchedAt,
      fields: ['openInterestUSD', 'fundingRateDailyAvg', 'premiumClose'],
      cadence: 'daily',
      credentialRequired: false,
      note: `Fetch failed: ${err.message}`,
    },
    rows: [],
  }, null, 2)}\n`);
  console.error(`[Derivatives data] FAILED: ${err.message}`);
  process.exitCode = 1;
});
